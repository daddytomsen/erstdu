-- Lichtblick – Datenbankschema für Supabase
-- Einmal komplett im Supabase-Dashboard unter „SQL Editor“ ausführen.
-- Das Skript ist wiederholbar: Es löscht nichts, legt nur an oder ersetzt Funktionen.

-- Ein Tag beginnt um 4:00 Uhr deutscher Zeit, damit ein Eintrag kurz nach
-- Mitternacht noch zum Vortag zählt. Die App rechnet genauso.
create or replace function public.heute()
returns date
language sql stable set search_path = public
as $$ select ((now() at time zone 'Europe/Berlin') - interval '4 hours')::date $$;

-- Tabellen ------------------------------------------------------------------

create table if not exists public.profile (
  id   uuid primary key references auth.users on delete cascade,
  name text not null check (char_length(name) between 1 and 40)
);

create table if not exists public.paar (
  id         uuid primary key default gen_random_uuid(),
  code       text not null unique,
  erstellt   timestamptz not null default now()
);

create table if not exists public.mitglied (
  paar_id  uuid not null references public.paar on delete cascade,
  user_id  uuid not null references auth.users on delete cascade,
  seit     timestamptz not null default now(),
  primary key (paar_id, user_id),
  unique (user_id)                      -- jede Person ist in höchstens einem Paar
);

create table if not exists public.eintrag (
  id        uuid primary key default gen_random_uuid(),
  paar_id   uuid not null references public.paar on delete cascade,
  user_id   uuid not null references auth.users on delete cascade,
  tag       date not null,
  text      text not null check (char_length(text) between 1 and 500),
  erstellt  timestamptz not null default now(),
  geaendert timestamptz not null default now(),
  unique (paar_id, user_id, tag)
);
create index if not exists eintrag_paar_tag on public.eintrag (paar_id, tag desc);

-- Hilfsfunktionen (security definer, damit die Regeln sich nicht im Kreis prüfen)

create or replace function public.mein_paar()
returns uuid
language sql stable security definer set search_path = public
as $$ select paar_id from mitglied where user_id = auth.uid() $$;

create or replace function public.ist_mitglied(p uuid)
returns boolean
language sql stable security definer set search_path = public
as $$ select exists (select 1 from mitglied where paar_id = p and user_id = auth.uid()) $$;

create or replace function public.selbst_geschrieben(p uuid, t date)
returns boolean
language sql stable security definer set search_path = public
as $$ select exists (select 1 from eintrag
                     where paar_id = p and user_id = auth.uid() and tag = t) $$;

-- Zugriffsregeln (Row Level Security) -----------------------------------------

alter table public.profile  enable row level security;
alter table public.paar     enable row level security;
alter table public.mitglied enable row level security;
alter table public.eintrag  enable row level security;

drop policy if exists profil_lesen on public.profile;
create policy profil_lesen on public.profile for select
  using (id = auth.uid()
         or id in (select user_id from mitglied where paar_id = public.mein_paar()));

drop policy if exists profil_anlegen on public.profile;
create policy profil_anlegen on public.profile for insert
  with check (id = auth.uid());

drop policy if exists profil_aendern on public.profile;
create policy profil_aendern on public.profile for update
  using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists paar_lesen on public.paar;
create policy paar_lesen on public.paar for select
  using (public.ist_mitglied(id));

drop policy if exists mitglied_lesen on public.mitglied;
create policy mitglied_lesen on public.mitglied for select
  using (paar_id = public.mein_paar());

-- Eigene Einträge immer; die der anderen Person erst, wenn man an dem Tag
-- selbst geschrieben hat oder der Tag vorbei ist.
drop policy if exists eintrag_lesen on public.eintrag;
create policy eintrag_lesen on public.eintrag for select
  using (
    user_id = auth.uid()
    or (public.ist_mitglied(paar_id) and (
          tag < public.heute()
          or public.selbst_geschrieben(paar_id, tag)))
  );

-- Schreiben nur für heute und gestern (gestern = nachtragen), nur im eigenen Paar.
drop policy if exists eintrag_anlegen on public.eintrag;
create policy eintrag_anlegen on public.eintrag for insert
  with check (user_id = auth.uid()
              and public.ist_mitglied(paar_id)
              and tag between public.heute() - 1 and public.heute());

drop policy if exists eintrag_aendern on public.eintrag;
create policy eintrag_aendern on public.eintrag for update
  using (user_id = auth.uid() and tag between public.heute() - 1 and public.heute())
  with check (user_id = auth.uid() and public.ist_mitglied(paar_id)
              and tag between public.heute() - 1 and public.heute());

drop policy if exists eintrag_loeschen on public.eintrag;
create policy eintrag_loeschen on public.eintrag for delete
  using (user_id = auth.uid());

-- Funktionen, die die App aufruft ---------------------------------------------

-- Neues Paar mit 6-stelligem Code (ohne verwechselbare Zeichen 0/O/1/I/L).
create or replace function public.paar_gruenden()
returns public.paar
language plpgsql security definer set search_path = public
as $$
declare
  zeichen constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  neu paar;
  c text;
begin
  if auth.uid() is null then raise exception 'nicht angemeldet'; end if;
  if exists (select 1 from mitglied where user_id = auth.uid()) then
    raise exception 'schon in einem Paar';
  end if;
  loop
    c := '';
    for i in 1..6 loop
      c := c || substr(zeichen, 1 + floor(random() * length(zeichen))::int, 1);
    end loop;
    exit when not exists (select 1 from paar where code = c);
  end loop;
  insert into paar (code) values (c) returning * into neu;
  insert into mitglied (paar_id, user_id) values (neu.id, auth.uid());
  return neu;
end $$;

create or replace function public.paar_beitreten(p_code text)
returns public.paar
language plpgsql security definer set search_path = public
as $$
declare
  ziel paar;
begin
  if auth.uid() is null then raise exception 'nicht angemeldet'; end if;
  if exists (select 1 from mitglied where user_id = auth.uid()) then
    raise exception 'schon in einem Paar';
  end if;
  select * into ziel from paar where code = upper(trim(p_code)) for update;
  if not found then raise exception 'Code unbekannt'; end if;
  if (select count(*) from mitglied where paar_id = ziel.id) >= 2 then
    raise exception 'Paar ist schon vollständig';
  end if;
  insert into mitglied (paar_id, user_id) values (ziel.id, auth.uid());
  return ziel;
end $$;

-- Verlassen: Mitgliedschaft löschen. Ist danach niemand mehr im Paar,
-- verschwindet das Paar samt allen Einträgen.
create or replace function public.paar_verlassen()
returns void
language plpgsql security definer set search_path = public
as $$
declare
  p uuid := public.mein_paar();
begin
  if p is null then return; end if;
  delete from mitglied where user_id = auth.uid();
  if not exists (select 1 from mitglied where paar_id = p) then
    delete from paar where id = p;
  end if;
end $$;

-- Ob die andere Person an einem Tag schon geschrieben hat – ohne den Text zu verraten.
create or replace function public.partner_hat_geschrieben(p_tag date)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from eintrag
    where paar_id = public.mein_paar() and user_id <> auth.uid() and tag = p_tag)
$$;

revoke all on function public.mein_paar() from public, anon;
revoke all on function public.ist_mitglied(uuid) from public, anon;
revoke all on function public.selbst_geschrieben(uuid, date) from public, anon;
grant execute on function public.mein_paar() to authenticated;
grant execute on function public.ist_mitglied(uuid) to authenticated;
grant execute on function public.selbst_geschrieben(uuid, date) to authenticated;
revoke all on function public.paar_gruenden() from public, anon;
revoke all on function public.paar_beitreten(text) from public, anon;
revoke all on function public.paar_verlassen() from public, anon;
revoke all on function public.partner_hat_geschrieben(date) from public, anon;
grant execute on function public.paar_gruenden() to authenticated;
grant execute on function public.paar_beitreten(text) to authenticated;
grant execute on function public.paar_verlassen() to authenticated;
grant execute on function public.partner_hat_geschrieben(date) to authenticated;

-- Live-Aktualisierung: neue Einträge der anderen Person erscheinen sofort.
do $$ begin
  alter publication supabase_realtime add table public.eintrag;
exception when duplicate_object then null; end $$;
