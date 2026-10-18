-- Lichtblick – Schlüssel der Erinnerung im Supabase-Vault (verschlüsselt in der Datenbank).
-- Die Edge Function „erinnern“ liest sie über erinnerung_konfig(); es braucht keine Edge-Function-Secrets.

create or replace function public.erinnerung_konfig()
returns jsonb
language sql stable security definer set search_path = public
as $$
  select jsonb_object_agg(replace(name, 'lichtblick_', ''), decrypted_secret)
  from vault.decrypted_secrets
  where name in ('lichtblick_cron_geheimnis', 'lichtblick_vapid_public',
                 'lichtblick_vapid_private', 'lichtblick_vapid_kontakt')
$$;

revoke all on function public.erinnerung_konfig() from public, anon, authenticated;
grant execute on function public.erinnerung_konfig() to service_role;

-- Einträge anlegen (einmalig, NICHT als Migration, damit nichts im Verlauf steht).
-- Das Cron-Geheimnis entsteht in der Datenbank und verlässt sie nie:
--   select vault.create_secret(encode(extensions.gen_random_bytes(24), 'hex'), 'lichtblick_cron_geheimnis');
-- VAPID-Schlüssel aus tools/vapid-erzeugen.mjs (Kopie in geheim.local.md):
--   select vault.create_secret('<VAPID_PUBLIC>',  'lichtblick_vapid_public');
--   select vault.create_secret('<VAPID_PRIVATE>', 'lichtblick_vapid_private');
--   select vault.create_secret('https://daddytomsen.github.io/erstdu/', 'lichtblick_vapid_kontakt');
-- Neue VAPID-Schlüssel? Dann vault.update_secret(...) UND vapidPublic in config.js ändern;
-- alle Geräte müssen die Erinnerung danach einmal aus- und wieder einschalten.
