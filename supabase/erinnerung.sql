-- Lichtblick 0.2 – Erinnerung am Abend (Web Push)
-- Nach schema.sql einmal im SQL Editor ausführen. Wiederholbar.

create table if not exists public.push_abo (
  endpoint  text primary key,                       -- Adresse beim Push-Dienst (Apple/Google/Mozilla)
  user_id   uuid not null default auth.uid() references auth.users on delete cascade,
  p256dh    text not null,                          -- öffentlicher Schlüssel des Geräts
  auth      text not null,                          -- Geheimnis des Geräts
  uhrzeit   time not null default '21:00'
            check (uhrzeit between '17:00' and '23:45'),
  aktiv     boolean not null default true,
  zuletzt   date,                                   -- Tag (heute()) der letzten Erinnerung
  erstellt  timestamptz not null default now()
);
create index if not exists push_abo_user on public.push_abo (user_id);

alter table public.push_abo enable row level security;

drop policy if exists push_eigene on public.push_abo;
create policy push_eigene on public.push_abo for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Wer ist jetzt dran? Aktiv, Uhrzeit erreicht, heute noch nicht erinnert,
-- heute noch nichts geschrieben. Dazu: Name der anderen Person und ob sie schon schrieb.
-- Die Uhrzeit liegt zwischen 17:00 und 23:45, deshalb passt sie immer zum Tag aus heute().
create or replace function public.faellige_erinnerungen()
returns table (endpoint text, p256dh text, auth text, partner_name text, partner_geschrieben boolean)
language sql stable security definer set search_path = public
as $$
  select a.endpoint, a.p256dh, a.auth,
         p.name,
         coalesce(exists (select 1 from eintrag e
                          where e.paar_id = m.paar_id and e.user_id = m2.user_id and e.tag = heute()), false)
  from push_abo a
  join mitglied m        on m.user_id = a.user_id
  left join mitglied m2  on m2.paar_id = m.paar_id and m2.user_id <> a.user_id
  left join profile p    on p.id = m2.user_id
  where a.aktiv
    and (now() at time zone 'Europe/Berlin')::time >= a.uhrzeit
    and coalesce(a.zuletzt, date '1900-01-01') < heute()
    and not exists (select 1 from eintrag e
                    where e.paar_id = m.paar_id and e.user_id = a.user_id and e.tag = heute())
$$;

create or replace function public.erinnerung_gesendet(p_endpoints text[])
returns void
language sql security definer set search_path = public
as $$ update push_abo set zuletzt = heute() where endpoint = any(p_endpoints) $$;

-- Abgelaufene Geräte (Push-Dienst meldet 404/410) entfernen.
create or replace function public.push_abo_entfernen(p_endpoints text[])
returns void
language sql security definer set search_path = public
as $$ delete from push_abo where endpoint = any(p_endpoints) $$;

-- Nur die Edge Function (service_role) darf diese drei Funktionen aufrufen.
revoke all on function public.faellige_erinnerungen() from public, anon, authenticated;
revoke all on function public.erinnerung_gesendet(text[]) from public, anon, authenticated;
revoke all on function public.push_abo_entfernen(text[]) from public, anon, authenticated;
grant execute on function public.faellige_erinnerungen() to service_role;
grant execute on function public.erinnerung_gesendet(text[]) to service_role;
grant execute on function public.push_abo_entfernen(text[]) to service_role;
