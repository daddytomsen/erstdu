// Testgeschirr für supabase/functions/erinnern/index.ts:
// echtes web-push, Supabase gemockt, Push-Dienst = lokaler HTTPS-Server, Nutzlast wird entschlüsselt.
// Aufruf: NODE_TLS_REJECT_UNAUTHORIZED=0 node fn-test.mjs <pfad-zu-index.ts>
import { readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:https';
import { createECDH, randomBytes, generateKeyPairSync } from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const hier = new URL('.', import.meta.url).pathname;
const require = createRequire(import.meta.url);
const ece = require('http_ece');
let ok = 0, fail = 0;
const pruefe = (n, b) => { b ? ok++ : fail++; console.log(`${b ? '✓' : '✗'} ${n}`); };

// Gerät simulieren (wie es der Browser bei pushManager.subscribe macht)
const geraet = createECDH('prime256v1'); geraet.generateKeys();
const authSecret = randomBytes(16);
const p256dh = geraet.getPublicKey().toString('base64url');
const auth = authSecret.toString('base64url');

// VAPID-Testschlüssel im selben Format wie tools/vapid-erzeugen.mjs
const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const pj = publicKey.export({ format: 'jwk' });
const VAPID_PUBLIC = Buffer.concat([Buffer.from([4]), Buffer.from(pj.x, 'base64url'), Buffer.from(pj.y, 'base64url')]).toString('base64url');
const VAPID_PRIVATE = privateKey.export({ format: 'jwk' }).d;

// Schein-Push-Dienst
const empfangen = [];
const server = createServer({ key: readFileSync(hier + 'key.pem'), cert: readFileSync(hier + 'cert.pem') }, (req, res) => {
  const teile = [];
  req.on('data', d => teile.push(d));
  req.on('end', () => {
    empfangen.push({ pfad: req.url, headers: req.headers, body: Buffer.concat(teile) });
    res.statusCode = req.url === '/weg' ? 410 : req.url === '/kaputt' ? 500 : 201;
    res.end(req.url === '/kaputt' ? 'Serverfehler' : '');
  });
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const basis = `https://127.0.0.1:${server.address().port}`;

// Supabase-Mock
const rpcAufrufe = [];
globalThis.__mock = {
  createClient: (url, key) => ({
    rpc: async (name, args) => {
      rpcAufrufe.push({ name, args, url, key });
      if (name === 'erinnerung_konfig') return { data: { ...vault }, error: null };
      if (name === 'partner_mitteilung') {
        return { data: [
          { endpoint: basis + '/ok', p256dh, auth, autor: 'Ben', mit_foto: true, partner_schon: false },
          { endpoint: basis + '/weg', p256dh, auth, autor: 'Ben', mit_foto: true, partner_schon: false },
        ], error: null };
      }
      if (name === 'faellige_erinnerungen') {
        return { data: [
          { endpoint: basis + '/ok', p256dh, auth, partner_name: 'Ben', partner_geschrieben: true },
          { endpoint: basis + '/weg', p256dh, auth, partner_name: 'Ben', partner_geschrieben: false },
          { endpoint: basis + '/kaputt', p256dh, auth, partner_name: null, partner_geschrieben: false },
        ], error: null };
      }
      return { data: null, error: null };
    },
  }),
};

// Vault-Inhalt (wie erinnerung_konfig() ihn liefert) und Deno-Umgebung nachbauen
const vault = {
  cron_geheimnis: 'geheim123', vapid_public: VAPID_PUBLIC, vapid_private: VAPID_PRIVATE,
  vapid_kontakt: 'https://daddytomsen.github.io/lichtblick/',
};
const env = { SUPABASE_URL: 'https://projekt.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service-key' };
let handler;
globalThis.Deno = { env: { get: n => env[n] }, serve: h => { handler = h; } };

// Funktion laden: npm:-Importe auf lokale Module umbiegen
const quelle = readFileSync(process.argv[2], 'utf8');
const umgebogen = quelle
  .replace("import webpush from 'npm:web-push@3.6.7';", `import webpush from ${JSON.stringify(require.resolve('web-push'))};`)
  .replace("import { createClient } from 'npm:@supabase/supabase-js@2.117.2';", 'const { createClient } = globalThis.__mock;');
pruefe('beide npm-Importe gefunden', !umgebogen.includes("'npm:"));
const datei = hier + 'fn-geladen.mts';
writeFileSync(datei, umgebogen);
const modul = await import(pathToFileURL(datei).href);

// 1) Falsches Geheimnis
let r = await handler(new Request('http://x/', { method: 'POST', headers: { 'x-lichtblick-geheim': 'falsch' } }));
pruefe('falsches Geheimnis → 401', r.status === 401);
pruefe('… nur die Konfiguration gelesen, keine Erinnerungen', rpcAufrufe.map(a => a.name).join() === 'erinnerung_konfig');
rpcAufrufe.length = 0;

// 2) Richtiger Aufruf
r = await handler(new Request('http://x/', { method: 'POST', headers: { 'x-lichtblick-geheim': 'geheim123' } }));
const antwort = await r.json();
console.log('  Antwort:', JSON.stringify(antwort));
pruefe('Status 200', r.status === 200);
pruefe('3 fällig, 1 gesendet, 1 entfernt, 1 Fehler', antwort.faellig === 3 && antwort.gesendet === 1 && antwort.entfernt === 1 && antwort.fehler.length === 1);
pruefe('Fehlertext enthält Status 500', /^500 /.test(antwort.fehler[0] || ''));
pruefe('ohne SUPABASE_SECRET_KEYS: alter Service-Key', rpcAufrufe[0].key === 'service-key');
const markiert = rpcAufrufe.find(a => a.name === 'erinnerung_gesendet');
const entfernt = rpcAufrufe.find(a => a.name === 'push_abo_entfernen');
pruefe('nur erfolgreich Gesendete markiert', JSON.stringify(markiert?.args) === JSON.stringify({ p_endpoints: [basis + '/ok'] }));
pruefe('410 → Abo entfernt', JSON.stringify(entfernt?.args) === JSON.stringify({ p_endpoints: [basis + '/weg'] }));

// 3) Was beim Push-Dienst ankam
const ok1 = empfangen.find(e => e.pfad === '/ok');
pruefe('VAPID-Kopfzeile vorhanden', /^vapid t=.+, k=/.test(ok1.headers.authorization || ''));
pruefe('VAPID k = unser öffentlicher Schlüssel', (ok1.headers.authorization || '').endsWith('k=' + VAPID_PUBLIC));
pruefe('Verschlüsselung aes128gcm', ok1.headers['content-encoding'] === 'aes128gcm');
pruefe('TTL 3 Stunden', ok1.headers.ttl === '10800');
const jwt = JSON.parse(Buffer.from((ok1.headers.authorization.match(/t=([^,]+)/)[1]).split('.')[1], 'base64url'));
pruefe('JWT: aud = Push-Dienst, sub = Kontakt', jwt.aud === basis && jwt.sub === vault.vapid_kontakt);
const klartext = ece.decrypt(ok1.body, { version: 'aes128gcm', privateKey: geraet, authSecret });
const nutzlast = JSON.parse(klartext.toString());
console.log('  Entschlüsselt:', klartext.toString());
pruefe('Gerät kann Nachricht entschlüsseln', nutzlast.title === 'Ben hat schon geschrieben');
pruefe('Text und Ziel stimmen', nutzlast.body === 'Was war dein Lichtblick heute?' && nutzlast.url === './');
const weg = empfangen.find(e => e.pfad === '/weg');
const n2 = JSON.parse(ece.decrypt(weg.body, { version: 'aes128gcm', privateKey: geraet, authSecret }).toString());
pruefe('ohne Partner-Eintrag: Standardfrage', n2.title === 'Lichtblick' && n2.body === 'Was war heute das Beste?');

// 4) nachricht() direkt
pruefe('nachricht(): Partner ohne Eintrag → Standard', modul.nachricht({ partner_name: 'Ben', partner_geschrieben: false }).title === 'Lichtblick');

// 4a) Sofort-Mitteilung
empfangen.length = 0; rpcAufrufe.length = 0;
r = await handler(new Request('http://x/', { method: 'POST', headers: { 'x-lichtblick-geheim': 'geheim123', 'Content-Type': 'application/json' }, body: JSON.stringify({ eintrag: 'e-1' }) }));
const pa = await r.json();
console.log('  Partner-Antwort:', JSON.stringify(pa));
pruefe('Sofort-Mitteilung: 1 gesendet, 1 entfernt', pa.art === 'partner' && pa.gesendet === 1 && pa.entfernt === 1);
pruefe('… fragt partner_mitteilung mit der Eintrags-Nummer', JSON.stringify(rpcAufrufe.find(a => a.name === 'partner_mitteilung')?.args) === JSON.stringify({ p_eintrag: 'e-1' }));
pruefe('… markiert keine Abend-Erinnerung', !rpcAufrufe.some(a => a.name === 'erinnerung_gesendet' || a.name === 'faellige_erinnerungen'));
const pn = JSON.parse(ece.decrypt(empfangen.find(e => e.pfad === '/ok').body, { version: 'aes128gcm', privateKey: geraet, authSecret }).toString());
pruefe('… Text: „Ben hat einen Lichtblick mit Foto geteilt“, ohne Eintragstext', pn.title === 'Ben hat einen Lichtblick mit Foto geteilt' && pn.body === 'Halte deinen fest, dann siehst du ihn.');
pruefe('partnerNachricht(): ohne Foto, Partner schon geschrieben', JSON.stringify(modul.partnerNachricht({ autor: 'Ben', mit_foto: false, partner_schon: true })) === JSON.stringify({ title: 'Ben hat einen Lichtblick geteilt', body: 'Schau ihn dir an.' }));

// 4b) Neuer Geheimschlüssel hat Vorrang
env.SUPABASE_SECRET_KEYS = JSON.stringify({ default: 'sb_secret_test' });
rpcAufrufe.length = 0;
await handler(new Request('http://x/', { method: 'POST', headers: { 'x-lichtblick-geheim': 'geheim123' } }));
pruefe('SUPABASE_SECRET_KEYS.default wird benutzt', rpcAufrufe[0]?.key === 'sb_secret_test');

// 5) Fehlender Vault-Eintrag
delete vault.vapid_private;
r = await handler(new Request('http://x/', { method: 'POST', headers: { 'x-lichtblick-geheim': 'geheim123' } }));
pruefe('fehlender Vault-Eintrag → 500 mit Klartext', r.status === 500 && /lichtblick_vapid_private fehlt/.test((await r.json()).fehler));

server.close();
console.log(`\n${ok} bestanden, ${fail} fehlgeschlagen`);
process.exit(fail ? 1 : 0);
