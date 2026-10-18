// Lichtblick – Datenschicht.
// Zwei Varianten mit gleicher Schnittstelle:
//   supabaseApi – echter Betrieb (config.js ausgefüllt)
//   demoApi     – alles im Browser, mit erfundener zweiter Person (?demo oder ohne config)

import { heute } from './tag.js';
import { alsDataUrl } from './foto.js';

const zufall = () => Math.random().toString(36).slice(2, 10);

const SUPABASE_URL = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/+esm';

export async function ladeApi() {
  const cfg = window.LICHTBLICK_CONFIG || {};
  const demo = new URLSearchParams(location.search).has('demo') || !cfg.url || !cfg.key;
  return demo ? demoApi() : supabaseApi(cfg);
}

function fehlertext(e) {
  const m = (e && (e.message || e.error_description)) || String(e);
  if (/Token has expired or is invalid/i.test(m)) return 'Der Code stimmt nicht oder ist abgelaufen.';
  if (/rate limit/i.test(m)) return 'Zu viele Versuche. Bitte ein paar Minuten warten.';
  if (/Failed to fetch|NetworkError/i.test(m)) return 'Keine Verbindung. Bist du online?';
  return m;
}

function pruefe({ data, error }) {
  if (error) throw new Error(fehlertext(error));
  return data;
}

// ---------------------------------------------------------------------------
async function supabaseApi(cfg) {
  const { createClient } = await import(SUPABASE_URL);
  const sb = createClient(cfg.url, cfg.key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  });
  let userId = null;
  let paarId = null;
  let email = '';

  const api = {
    demo: false,
    get userId() { return userId; },
    get email() { return email; },

    async init() {
      const { data } = await sb.auth.getSession();
      userId = data.session?.user?.id ?? null;
      email = data.session?.user?.email ?? '';
      return userId;
    },
    async sendeCode(email) {
      pruefe(await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: true } }));
    },
    async pruefeCode(email, code) {
      const d = pruefe(await sb.auth.verifyOtp({ email, token: code, type: 'email' }));
      userId = d.user.id;
    },
    async abmelden() {
      await sb.auth.signOut();
      userId = null; paarId = null;
    },

    async profil() {
      return pruefe(await sb.from('profile').select('name').eq('id', userId).maybeSingle());
    },
    async setzeName(name) {
      pruefe(await sb.from('profile').upsert({ id: userId, name }));
    },

    async paar() {
      const m = pruefe(await sb.from('mitglied').select('paar_id').eq('user_id', userId).maybeSingle());
      if (!m) { paarId = null; return null; }
      paarId = m.paar_id;
      const p = pruefe(await sb.from('paar').select('id, code').eq('id', paarId).single());
      const ids = pruefe(await sb.from('mitglied').select('user_id, seit').eq('paar_id', paarId).order('seit'));
      const namen = pruefe(await sb.from('profile').select('id, name').in('id', ids.map(x => x.user_id)));
      const name = Object.fromEntries(namen.map(x => [x.id, x.name]));
      return { id: p.id, code: p.code, mitglieder: ids.map(x => ({ id: x.user_id, name: name[x.user_id] || '…' })) };
    },
    async paarGruenden() { pruefe(await sb.rpc('paar_gruenden')); },
    async paarBeitreten(code) { pruefe(await sb.rpc('paar_beitreten', { p_code: code })); },
    async paarVerlassen() { pruefe(await sb.rpc('paar_verlassen')); paarId = null; },

    async eintraege() {
      return pruefe(await sb.from('eintrag')
        .select('tag, user_id, text, foto, geaendert')
        .eq('paar_id', paarId)
        .order('tag', { ascending: false })
        .limit(5000));
    },
    // foto: Pfad im Speicher oder null (kein Foto)
    async speichere(tag, text, foto = null) {
      pruefe(await sb.from('eintrag').upsert(
        { paar_id: paarId, user_id: userId, tag, text, foto, geaendert: new Date().toISOString() },
        { onConflict: 'paar_id,user_id,tag' }));
    },

    // Fotos: privater Bucket „fotos“, Pfad <paar>/<person>/<tag>-<zufall>.jpg (Regeln in supabase/fotos.sql)
    async fotoHochladen(tag, blob) {
      const pfad = `${paarId}/${userId}/${tag}-${zufall()}.jpg`;
      pruefe(await sb.storage.from('fotos').upload(pfad, blob, { contentType: 'image/jpeg', upsert: false }));
      return pfad;
    },
    async fotoLoeschen(pfad) {
      await sb.storage.from('fotos').remove([pfad]);
    },
    // Zeitlich begrenzte Links (1 Stunde) für die Anzeige; liefert Map Pfad → URL.
    async fotoLinks(pfade) {
      const karte = new Map();
      if (!pfade.length) return karte;
      const d = pruefe(await sb.storage.from('fotos').createSignedUrls(pfade, 3600));
      for (const x of d) if (x.signedUrl) karte.set(x.path, x.signedUrl);
      return karte;
    },
    async loesche(tag) {
      pruefe(await sb.from('eintrag').delete().eq('paar_id', paarId).eq('user_id', userId).eq('tag', tag));
    },
    async partnerHatGeschrieben(tag) {
      return pruefe(await sb.rpc('partner_hat_geschrieben', { p_tag: tag }));
    },

    // Erinnerung (Web Push): ein Datensatz je Gerät, Schlüssel ist der Push-Endpunkt.
    async erinnerungLesen(endpoint) {
      return pruefe(await sb.from('push_abo').select('uhrzeit, aktiv').eq('endpoint', endpoint).maybeSingle());
    },
    async erinnerungSpeichern(abo, uhrzeit) {
      pruefe(await sb.from('push_abo').upsert({
        endpoint: abo.endpoint, user_id: userId,
        p256dh: abo.keys.p256dh, auth: abo.keys.auth,
        uhrzeit, aktiv: true,
      }, { onConflict: 'endpoint' }));
    },
    async erinnerungLoeschen(endpoint) {
      pruefe(await sb.from('push_abo').delete().eq('endpoint', endpoint));
    },

    // Meldet jede Änderung an Einträgen des Paars. Liefert eine Abmeldefunktion.
    abonniere(rueckruf) {
      if (!paarId) return () => {};
      const kanal = sb.channel('eintraege-' + paarId)
        .on('postgres_changes',
            { event: '*', schema: 'public', table: 'eintrag', filter: 'paar_id=eq.' + paarId },
            () => rueckruf())
        .subscribe();
      return () => sb.removeChannel(kanal);
    },
  };
  return api;
}

// ---------------------------------------------------------------------------
// Demo: speichert in localStorage unter „lichtblick-demo“. Die zweite Person
// „Sam“ hat heute schon geschrieben – sichtbar erst nach dem eigenen Eintrag.
function demoApi() {
  const SCHLUESSEL = 'lichtblick-demo';
  const ICH = 'demo-ich', SAM = 'demo-sam';

  function tagMinus(n) {
    const d = new Date(heute() + 'T12:00:00');
    d.setDate(d.getDate() - n);
    return d.toISOString().slice(0, 10);
  }
  function startdaten() {
    const sam = [
      'Kaffee auf dem Balkon, bevor alle wach waren.',
      'Die Nachricht von dir mittags.',
      'Endlich die Steuer abgegeben!',
      'Sonnenuntergang auf dem Heimweg.',
      'Pizza, Sofa, Film. Mehr braucht es nicht.',
    ];
    const ich = [
      null,
      'Lauf am Rhein, bei 12 Grad und Sonne.',
      'Die Kinder haben ohne Streit gefrühstückt.',
      null,
      'Unerwartet früh Feierabend.',
    ];
    const e = [{ tag: heute(), user_id: SAM, text: 'Der Bäcker hatte noch Zimtschnecken.', geaendert: new Date().toISOString() }];
    sam.forEach((t, i) => e.push({ tag: tagMinus(i + 1), user_id: SAM, text: t, geaendert: '' }));
    ich.forEach((t, i) => t && e.push({ tag: tagMinus(i + 1), user_id: ICH, text: t, geaendert: '' }));
    return { angemeldet: false, name: null, paar: null, eintraege: e };
  }
  function lies() {
    try { return JSON.parse(localStorage.getItem(SCHLUESSEL)) || startdaten(); }
    catch { return startdaten(); }
  }
  function schreib(s) {
    try { localStorage.setItem(SCHLUESSEL, JSON.stringify(s)); } catch { /* privates Fenster */ }
  }
  const warte = () => new Promise(r => setTimeout(r, 150));
  let s = lies();

  return {
    demo: true,
    get userId() { return s.angemeldet ? ICH : null; },
    async init() { return this.userId; },
    async sendeCode() { await warte(); },
    async pruefeCode(_email, code) {
      await warte();
      if (code !== '123456') throw new Error('Im Demo-Modus lautet der Code 123456.');
      s.angemeldet = true; schreib(s);
    },
    async abmelden() { localStorage.removeItem(SCHLUESSEL); s = startdaten(); },
    async profil() { return s.name ? { name: s.name } : null; },
    async setzeName(name) { s.name = name; schreib(s); },
    async paar() {
      if (!s.paar) return null;
      const m = [{ id: ICH, name: s.name }];
      if (s.paar.mitSam) m.unshift({ id: SAM, name: 'Sam' });
      return { id: 'demo', code: s.paar.code, mitglieder: m };
    },
    async paarGruenden() { await warte(); s.paar = { code: 'K7M3QX', mitSam: false }; schreib(s); },
    async paarBeitreten(code) {
      await warte();
      if (code.trim().toUpperCase() !== 'K7M3QX') throw new Error('Code unbekannt (Demo: K7M3QX).');
      s.paar = { code: 'K7M3QX', mitSam: true }; schreib(s);
    },
    async paarVerlassen() { s.paar = null; schreib(s); },
    async eintraege() {
      const mitSam = s.paar?.mitSam;
      const heut = heute();
      const selbstHeute = s.eintraege.some(e => e.user_id === ICH && e.tag === heut);
      return s.eintraege
        .filter(e => e.user_id === ICH || (mitSam && (e.tag < heut || selbstHeute)))
        .sort((a, b) => b.tag.localeCompare(a.tag));
    },
    async speichere(tag, text, foto = null) {
      s.eintraege = s.eintraege.filter(e => !(e.user_id === ICH && e.tag === tag));
      s.eintraege.push({ tag, user_id: ICH, text, foto, geaendert: new Date().toISOString() });
      schreib(s);
    },
    // Demo: Foto als data:-URL direkt im Eintrag (klein halten, localStorage hat nur ~5 MB)
    async fotoHochladen(_tag, blob) { return alsDataUrl(blob); },
    async fotoLoeschen() {},
    async fotoLinks(pfade) { return new Map(pfade.map(p => [p, p])); },
    async loesche(tag) {
      s.eintraege = s.eintraege.filter(e => !(e.user_id === ICH && e.tag === tag));
      schreib(s);
    },
    async partnerHatGeschrieben(tag) {
      return !!s.paar?.mitSam && s.eintraege.some(e => e.user_id === SAM && e.tag === tag);
    },
    async erinnerungLesen(endpoint) { return s.push?.[endpoint] ?? null; },
    async erinnerungSpeichern(abo, uhrzeit) {
      s.push = { ...(s.push || {}), [abo.endpoint]: { uhrzeit, aktiv: true } }; schreib(s);
    },
    async erinnerungLoeschen(endpoint) { if (s.push) delete s.push[endpoint]; schreib(s); },
    abonniere() { return () => {}; },
  };
}
