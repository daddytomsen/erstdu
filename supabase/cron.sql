-- Lichtblick – alle 15 Minuten die Edge Function „erinnern“ aufrufen.
-- Das Geheimnis kommt zur Laufzeit aus dem Vault (siehe vault.sql), es steht nirgends im Klartext.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

select cron.unschedule(jobid) from cron.job where jobname = 'lichtblick-erinnern';

select cron.schedule('lichtblick-erinnern', '*/15 * * * *', $job$
  select net.http_post(
    url     := 'https://zrkhhzdamuadgpzxurep.supabase.co/functions/v1/erinnern',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-lichtblick-geheim',
      (select decrypted_secret from vault.decrypted_secrets where name = 'lichtblick_cron_geheimnis')),
    body    := '{}'::jsonb,
    timeout_milliseconds := 20000);
$job$);

-- Prüfen, was die letzten Aufrufe geantwortet haben:
--   select id, status_code, content::text, created from net._http_response order by id desc limit 5;
