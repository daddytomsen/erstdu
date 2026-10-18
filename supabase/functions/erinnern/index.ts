// ErstDu – Edge Function „erinnern“.
// Zwei Aufrufer:
//   pg_cron alle 15 Minuten (supabase/cron.sql), Rumpf {}   → Abend-Erinnerung an alle, die dran sind
//   Trigger bei neuem Eintrag (supabase/fotos.sql), {"eintrag": id} → Sofort-Mitteilung an die andere Person
// Bereitstellen mit „Verify JWT“ AUS – geschützt wird sie über das Cron-Geheimnis.
//
// Alle Schlüssel liegen im Supabase-Vault (Funktion erinnerung_konfig() in supabase/vault.sql):
//   lichtblick_cron_geheimnis, lichtblick_vapid_public, lichtblick_vapid_private, lichtblick_vapid_kontakt
// SUPABASE_URL und SUPABASE_SECRET_KEYS (ersatzweise SUPABASE_SERVICE_ROLE_KEY) stellt Supabase bereit.

import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2.117.2';

type Faellig = {
  endpoint: string;
  p256dh: string;
  auth: string;
  partner_name: string | null;
  partner_geschrieben: boolean;
};

type Konfig = {
  cron_geheimnis: string;
  vapid_public: string;
  vapid_private: string;
  vapid_kontakt: string;
};
const KONFIG_FELDER = ['cron_geheimnis', 'vapid_public', 'vapid_private', 'vapid_kontakt'] as const;

function env(name: string): string {
  const wert = Deno.env.get(name);
  if (!wert) throw new Error(`Umgebungsvariable ${name} fehlt`);
  return wert;
}

// Neuer Geheimschlüssel (sb_secret_…); der alte service_role-Schlüssel gilt nur bis Ende 2026.
function adminSchluessel(): string {
  const neu = Deno.env.get('SUPABASE_SECRET_KEYS');
  if (neu) {
    try {
      const k = JSON.parse(neu)['default'];
      if (k) return k;
    } catch { /* unten weiter */ }
  }
  return env('SUPABASE_SERVICE_ROLE_KEY');
}

function json(daten: unknown, status = 200): Response {
  return new Response(JSON.stringify(daten), { status, headers: { 'Content-Type': 'application/json' } });
}

type Partner = {
  endpoint: string;
  p256dh: string;
  auth: string;
  autor: string;
  mit_foto: boolean;
  partner_schon: boolean;
};

// Die Mitteilung verrät nie den Text – nur, dass es etwas Neues gibt.
export function partnerNachricht(z: Pick<Partner, 'autor' | 'mit_foto' | 'partner_schon'>) {
  const was = z.mit_foto ? 'einen Moment mit Foto' : 'einen Moment';
  return {
    title: `${z.autor} hat ${was} geteilt`,
    body: z.partner_schon ? 'Schau ihn dir an.' : 'Halte deinen fest, dann siehst du ihn.',
  };
}

type Abo = { endpoint: string; p256dh: string; auth: string };

// Schickt jedem Abo seine Nachricht; sammelt Erfolge, abgelaufene Abos und Fehler.
async function senden<T extends Abo>(liste: T[], text: (z: T) => { title: string; body: string }) {
  const gesendet: string[] = [];
  const abgelaufen: string[] = [];
  const fehler: string[] = [];
  await Promise.all(liste.map(async z => {
    try {
      await webpush.sendNotification(
        { endpoint: z.endpoint, keys: { p256dh: z.p256dh, auth: z.auth } },
        JSON.stringify({ ...text(z), url: './' }),
        { TTL: 3 * 3600, urgency: 'normal' },
      );
      gesendet.push(z.endpoint);
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      // 404/410: Gerät hat das Abo beendet (App gelöscht, Mitteilungen aus) → entfernen.
      if (status === 404 || status === 410) abgelaufen.push(z.endpoint);
      else fehler.push(`${status ?? '-'} ${(e as { body?: string }).body ?? (e as Error).message}`);
    }
  }));
  return { gesendet, abgelaufen, fehler };
}

export function nachricht(z: Pick<Faellig, 'partner_name' | 'partner_geschrieben'>) {
  if (z.partner_name && z.partner_geschrieben) {
    return { title: `${z.partner_name} hat schon geschrieben`, body: 'Was war dein schönster Moment heute?' };
  }
  return { title: 'ErstDu', body: 'Was war heute das Beste?' };
}

Deno.serve(async (req: Request) => {
  try {
    const sb = createClient(env('SUPABASE_URL'), adminSchluessel(), {
      auth: { persistSession: false },
    });

    const k = await sb.rpc('erinnerung_konfig');
    if (k.error) return json({ fehler: 'Konfiguration: ' + k.error.message }, 500);
    const konfig = (k.data ?? {}) as Partial<Konfig>;
    for (const feld of KONFIG_FELDER) {
      if (!konfig[feld]) return json({ fehler: `Vault-Eintrag lichtblick_${feld} fehlt` }, 500);
    }
    if (req.headers.get('x-lichtblick-geheim') !== konfig.cron_geheimnis) {
      return json({ fehler: 'nicht erlaubt' }, 401);
    }
    webpush.setVapidDetails(konfig.vapid_kontakt!, konfig.vapid_public!, konfig.vapid_private!);

    const rumpf = await req.json().catch(() => ({})) as { eintrag?: string };

    // Sofort-Mitteilung an die andere Person
    if (rumpf.eintrag) {
      const p = await sb.rpc('partner_mitteilung', { p_eintrag: rumpf.eintrag });
      if (p.error) return json({ fehler: p.error.message }, 500);
      const { gesendet, abgelaufen, fehler } = await senden((p.data ?? []) as Partner[], partnerNachricht);
      if (abgelaufen.length) {
        const r = await sb.rpc('push_abo_entfernen', { p_endpoints: abgelaufen });
        if (r.error) fehler.push('entfernen: ' + r.error.message);
      }
      return json({ art: 'partner', gesendet: gesendet.length, entfernt: abgelaufen.length, fehler });
    }

    // Abend-Erinnerung
    const { data, error } = await sb.rpc('faellige_erinnerungen');
    if (error) return json({ fehler: error.message }, 500);
    const faellig = (data ?? []) as Faellig[];
    const { gesendet, abgelaufen, fehler } = await senden(faellig, nachricht);

    if (gesendet.length) {
      const r = await sb.rpc('erinnerung_gesendet', { p_endpoints: gesendet });
      if (r.error) fehler.push('markieren: ' + r.error.message);
    }
    if (abgelaufen.length) {
      const r = await sb.rpc('push_abo_entfernen', { p_endpoints: abgelaufen });
      if (r.error) fehler.push('entfernen: ' + r.error.message);
    }
    return json({ faellig: faellig.length, gesendet: gesendet.length, entfernt: abgelaufen.length, fehler });
  } catch (e) {
    return json({ fehler: (e as Error).message }, 500);
  }
});
