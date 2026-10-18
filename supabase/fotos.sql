-- Lichtblick 0.3 – Fotos zum Lichtblick und Sofort-Mitteilung an die andere Person.
-- Nach schema.sql, erinnerung.sql, vault.sql ausführen. Wiederholbar.

-- Foto je Eintrag: Pfad im privaten Bucket „fotos“, Aufbau <paar_id>/<user_id>/<tag>-<zufall>.jpg
alter table public.eintrag add column if not exists foto text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fotos', 'fotos', false, 5242880, array['image/jpeg'])
on conflict (id) do update
  set public = false, file_size_limit = 5242880, allowed_mime_types = array['image/jpeg'];

-- Ein Foto ist sichtbar, wenn es im eigenen Ordner liegt oder zu einem Eintrag gehört,
-- den man lesen darf (gleiche Regel wie eintrag_lesen in schema.sql).
create or replace function public.foto_sichtbar(p_name text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select (storage.foldername(p_name))[2] = auth.uid()::text
      or exists (
        select 1 from eintrag e
        where e.foto = p_name
          and public.ist_mitglied(e.paar_id)
          and (e.tag < public.heute() or public.selbst_geschrieben(e.paar_id, e.tag)))
$$;
revoke all on function public.foto_sichtbar(text) from public, anon;
grant execute on function public.foto_sichtbar(text) to authenticated;

drop policy if exists lichtblick_foto_lesen on storage.objects;
create policy lichtblick_foto_lesen on storage.objects for select to authenticated
  using (bucket_id = 'fotos' and public.foto_sichtbar(name));

drop policy if exists lichtblick_foto_hochladen on storage.objects;
create policy lichtblick_foto_hochladen on storage.objects for insert to authenticated
  with check (bucket_id = 'fotos'
              and (storage.foldername(name))[1] = public.mein_paar()::text
              and (storage.foldername(name))[2] = auth.uid()::text);

drop policy if exists lichtblick_foto_loeschen on storage.objects;
create policy lichtblick_foto_loeschen on storage.objects for delete to authenticated
  using (bucket_id = 'fotos' and (storage.foldername(name))[2] = auth.uid()::text);

-- Sofort-Mitteilung: Wer bekommt sie für diesen Eintrag? (nur die andere Person, nur aktive Geräte)
create or replace function public.partner_mitteilung(p_eintrag uuid)
returns table (endpoint text, p256dh text, auth text, autor text, mit_foto boolean, partner_schon boolean)
language sql stable security definer set search_path = public
as $$
  select a.endpoint, a.p256dh, a.auth,
         coalesce(pr.name, 'Jemand'),
         e.foto is not null,
         exists (select 1 from eintrag x
                 where x.paar_id = e.paar_id and x.user_id = m.user_id and x.tag = e.tag)
  from eintrag e
  join mitglied m      on m.paar_id = e.paar_id and m.user_id <> e.user_id
  join push_abo a      on a.user_id = m.user_id and a.aktiv
  left join profile pr on pr.id = e.user_id
  where e.id = p_eintrag
$$;
revoke all on function public.partner_mitteilung(uuid) from public, anon, authenticated;
grant execute on function public.partner_mitteilung(uuid) to service_role;

-- Trigger: neuer Eintrag → Edge Function „erinnern“ mit {"eintrag": id}.
-- pg_net arbeitet im Hintergrund; ein Fehler hier darf das Speichern nie verhindern.
create or replace function public.eintrag_benachrichtigen()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  perform net.http_post(
    url     := 'https://zrkhhzdamuadgpzxurep.supabase.co/functions/v1/erinnern',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-lichtblick-geheim',
      (select decrypted_secret from vault.decrypted_secrets where name = 'lichtblick_cron_geheimnis')),
    body    := jsonb_build_object('eintrag', new.id),
    timeout_milliseconds := 20000);
  return new;
exception when others then
  return new;
end $$;
revoke all on function public.eintrag_benachrichtigen() from public, anon, authenticated;

drop trigger if exists eintrag_neu on public.eintrag;
create trigger eintrag_neu after insert on public.eintrag
  for each row execute function public.eintrag_benachrichtigen();
