// Prüft schema.sql + erinnerung.sql in PGlite mit nachgebauter Supabase-Umgebung.
// Aufruf: node test.mjs <pfad-zum-supabase-ordner>
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

const ordner = process.argv[2];
const db = new PGlite();
let ok = 0, fail = 0;
const pruefe = (name, bed) => { bed ? ok++ : fail++; console.log(`${bed ? '✓' : '✗'} ${name}`); };

// --- Supabase nachbauen -----------------------------------------------------
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable
    as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
  create publication supabase_realtime;
  -- Attrappen für Storage, pg_net und Vault
  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean,
    file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
  alter table storage.objects enable row level security;
  create function storage.foldername(name text) returns text[] language sql immutable
    as $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
  grant usage on schema storage to anon, authenticated, service_role;
  grant all on storage.objects to anon, authenticated, service_role;
  grant execute on function storage.foldername(text) to anon, authenticated, service_role;
  create schema net;
  create table net.aufrufe (url text, headers jsonb, body jsonb);
  create function net.http_post(url text, headers jsonb, body jsonb, timeout_milliseconds int)
    returns bigint language plpgsql as $$
    begin insert into net.aufrufe values (url, headers, body); return 1; end $$;
  create schema vault;
  create table vault.decrypted_secrets (name text, decrypted_secret text);
  insert into vault.decrypted_secrets values ('lichtblick_cron_geheimnis', 'tresor-geheim');
`);
await db.exec(readFileSync(`${ordner}/schema.sql`, 'utf8'));
await db.exec(readFileSync(`${ordner}/schema.sql`, 'utf8'));          // wiederholbar?
await db.exec(readFileSync(`${ordner}/erinnerung.sql`, 'utf8'));
await db.exec(readFileSync(`${ordner}/erinnerung.sql`, 'utf8'));
await db.exec(readFileSync(`${ordner}/fotos.sql`, 'utf8'));
await db.exec(readFileSync(`${ordner}/fotos.sql`, 'utf8'));
pruefe('Skripte laufen zweimal ohne Fehler', true);

const A = '00000000-0000-0000-0000-00000000000a';
const B = '00000000-0000-0000-0000-00000000000b';
const C = '00000000-0000-0000-0000-00000000000c';
await db.exec(`insert into auth.users values ('${A}','a@x'),('${B}','b@x'),('${C}','c@x')`);

async function als(uid, sql, params) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid}', false); set role authenticated;`);
  try { return (await db.query(sql, params)).rows; }
  finally { await db.exec('reset role'); }
}
async function alsService(sql, params) {
  await db.exec(`select set_config('request.jwt.claim.sub', '', false); set role service_role;`);
  try { return (await db.query(sql, params)).rows; }
  finally { await db.exec('reset role'); }
}
async function fehler(fn) { try { await fn(); return null; } catch (e) { return e.message; } }

const heute = (await db.query('select heute()::text as t')).rows[0].t;
const gestern = (await db.query('select (heute() - 1)::text as t')).rows[0].t;
const vorgestern = (await db.query('select (heute() - 2)::text as t')).rows[0].t;

// --- Profile und Paar ---------------------------------------------------------
await als(A, `insert into profile values ($1, 'Anna')`, [A]);
await als(B, `insert into profile values ($1, 'Ben')`, [B]);
await als(C, `insert into profile values ($1, 'Cleo')`, [C]);
pruefe('fremdes Profil anlegen verboten', !!await fehler(() => als(A, `insert into profile values ($1, 'X')`, [C])));

const [paar] = await als(A, 'select * from paar_gruenden()');
pruefe('Code hat 6 Zeichen ohne 0/O/1/I/L', /^[A-HJKMNP-Z2-9]{6}$/.test(paar.code));
pruefe('zweites Paar gründen verboten', /schon in einem Paar/.test(await fehler(() => als(A, 'select paar_gruenden()'))));
pruefe('falscher Code', /Code unbekannt/.test(await fehler(() => als(B, `select paar_beitreten('ZZZZZZ')`))));
await als(B, 'select paar_beitreten($1)', [paar.code.toLowerCase() + ' ']);
pruefe('Beitritt mit klein geschriebenem Code', (await als(B, 'select mein_paar() as p'))[0].p === paar.id);
pruefe('drittes Mitglied verboten', /vollständig/.test(await fehler(() => als(C, 'select paar_beitreten($1)', [paar.code]))));
pruefe('direkt in mitglied schreiben verboten', !!await fehler(() => als(C, 'insert into mitglied values ($1, $2)', [paar.id, C])));

pruefe('A sieht Bens Namen', (await als(A, 'select name from profile order by name')).map(r => r.name).join() === 'Anna,Ben');
pruefe('C sieht nur sich', (await als(C, 'select name from profile')).map(r => r.name).join() === 'Cleo');
pruefe('C sieht das Paar nicht', (await als(C, 'select * from paar')).length === 0);

// --- Einträge -----------------------------------------------------------------
const ins = (uid, tag, text) => als(uid, 'insert into eintrag (paar_id, user_id, tag, text) values ($1,$2,$3,$4)', [paar.id, uid, tag, text]);
pruefe('für andere schreiben verboten', /row-level security/.test(await fehler(() =>
  als(A, 'insert into eintrag (paar_id,user_id,tag,text) values ($1,$2,$3,$4)', [paar.id, B, heute, 'gefälscht']))));
await ins(B, heute, 'Ben heute');
await ins(B, gestern, 'Ben gestern');
pruefe('vorgestern nachtragen verboten', !!await fehler(() => ins(A, vorgestern, 'zu spät')));

let sicht = await als(A, 'select text from eintrag order by tag');
pruefe('A sieht Bens gestern, aber nicht heute (vor eigenem Eintrag)', sicht.map(r => r.text).join() === 'Ben gestern');
pruefe('partner_hat_geschrieben verrät nur ja/nein', (await als(A, 'select partner_hat_geschrieben($1::date) as j', [heute]))[0].j === true);
await ins(A, heute, 'Anna heute');
sicht = await als(A, 'select text from eintrag order by tag, text');
pruefe('nach eigenem Eintrag sieht A Bens heute', sicht.map(r => r.text).join() === 'Ben gestern,Anna heute,Ben heute');
pruefe('C sieht keine Einträge', (await als(C, 'select * from eintrag')).length === 0);
pruefe('C kann nicht ins Paar schreiben', !!await fehler(() => als(C, 'insert into eintrag (paar_id,user_id,tag,text) values ($1,$2,$3,$4)', [paar.id, C, heute, 'x'])));
await als(A, `update eintrag set text = 'gehackt' where user_id = $1`, [B]);
pruefe('A kann Bens Eintrag nicht ändern', (await als(B, `select text from eintrag where tag = $1 and user_id = $2`, [heute, B]))[0].text === 'Ben heute');
pruefe('leerer Text verboten', /check constraint/.test(await fehler(() => ins(C, heute, ''))  || '') ||
  /check constraint/.test(await fehler(() => als(B, `update eintrag set text = '' where user_id = $1`, [B])) || ''));

// --- Erinnerung ---------------------------------------------------------------
await als(A, `insert into push_abo (endpoint, p256dh, auth, uhrzeit) values ('ep-a', 'k', 's', '21:00')`);
await als(B, `insert into push_abo (endpoint, p256dh, auth, uhrzeit) values ('ep-b', 'k', 's', '21:00')`);
pruefe('user_id wird automatisch gesetzt', (await als(A, 'select user_id from push_abo'))[0].user_id === A);
pruefe('A sieht nur das eigene Abo', (await als(A, 'select endpoint from push_abo')).length === 1);
pruefe('Uhrzeit 15:00 verboten', !!await fehler(() => als(C, `insert into push_abo (endpoint,p256dh,auth,uhrzeit) values ('ep-c','k','s','15:00')`)));
pruefe('fremdes Abo anlegen verboten', !!await fehler(() => als(C, `insert into push_abo (endpoint,user_id,p256dh,auth) values ('ep-x',$1,'k','s')`, [A])));
pruefe('faellige_erinnerungen für Nutzer gesperrt', /permission denied/.test(await fehler(() => als(A, 'select * from faellige_erinnerungen()'))));
pruefe('erinnerung_gesendet für Nutzer gesperrt', /permission denied/.test(await fehler(() => als(A, `select erinnerung_gesendet(array['ep-a'])`))));

// Uhrzeit-Bedingung testbar machen: Variante mit einstellbarer „jetzt“-Uhrzeit.
const quelle = readFileSync(`${ordner}/erinnerung.sql`, 'utf8');
const variante = quelle.match(/create or replace function public\.faellige_erinnerungen\(\)[\s\S]*?\$\$;/)[0]
  .replace("(now() at time zone 'Europe/Berlin')::time", "current_setting('test.jetzt')::time");
pruefe('Uhrzeit-Ausdruck in faellige_erinnerungen gefunden', variante.includes("current_setting('test.jetzt')"));
await db.exec(variante);
const faellig = async jetzt => {
  await db.exec(`select set_config('test.jetzt', '${jetzt}', false)`);
  return alsService('select * from faellige_erinnerungen() order by endpoint');
};

let f = await faellig('20:59');
pruefe('20:59: noch niemand dran', f.length === 0);
f = await faellig('21:00');
// A und B haben heute beide geschrieben → niemand
pruefe('21:00: wer heute schrieb, wird nicht erinnert', f.length === 0);
await als(A, 'delete from eintrag where user_id = $1 and tag = $2', [A, heute]);
f = await faellig('21:15');
pruefe('A ohne Eintrag ist dran, B nicht', f.length === 1 && f[0].endpoint === 'ep-a');
pruefe('… mit Bens Namen und „hat geschrieben“', f[0]?.partner_name === 'Ben' && f[0]?.partner_geschrieben === true);
await alsService(`select erinnerung_gesendet(array['ep-a'])`);
f = await faellig('22:00');
pruefe('nach dem Senden heute nicht noch einmal', f.length === 0);
await als(A, `update push_abo set zuletzt = null`);
await als(B, 'delete from eintrag where user_id = $1 and tag = $2', [B, heute]);
f = await faellig('21:30');
pruefe('beide ohne Eintrag → beide dran, partner_geschrieben falsch',
  f.length === 2 && f.every(r => r.partner_geschrieben === false));
await als(A, `update push_abo set aktiv = false`);
f = await faellig('21:30');
pruefe('ausgeschaltetes Abo wird übersprungen', f.length === 1 && f[0].endpoint === 'ep-b');
await alsService(`select push_abo_entfernen(array['ep-b'])`);
pruefe('abgelaufenes Abo entfernt', (await als(B, 'select * from push_abo')).length === 0);

// --- Fotos -----------------------------------------------------------------
await db.exec('delete from net.aufrufe');
const pfadA = `${paar.id}/${A}/${heute}-abc.jpg`;
const pfadB = `${paar.id}/${B}/${heute}-xyz.jpg`;
const hoch = (uid, name) => als(uid, `insert into storage.objects (bucket_id, name) values ('fotos', $1)`, [name]);
await hoch(A, pfadA);
await hoch(B, pfadB);
pruefe('Upload in fremden Ordner verboten', !!await fehler(() => hoch(A, `${paar.id}/${B}/x.jpg`)));
pruefe('Upload in fremdes Paar verboten', !!await fehler(() => hoch(C, `${paar.id}/${C}/x.jpg`)));
pruefe('Upload in anderen Bucket ist nicht erlaubt', !!await fehler(() =>
  als(A, `insert into storage.objects (bucket_id, name) values ('anderer', $1)`, [`${paar.id}/${A}/y.jpg`])));
pruefe('eigenes Foto gleich nach dem Upload lesbar', (await als(A, 'select name from storage.objects')).map(r => r.name).join() === pfadA);
// A und B haben heute keinen Eintrag mehr (siehe Erinnerungstest) → B schreibt mit Foto
await als(B, 'insert into eintrag (paar_id,user_id,tag,text,foto) values ($1,$2,$3,$4,$5)', [paar.id, B, heute, 'Ben mit Foto', pfadB]);
const aufrufe = (await db.query('select * from net.aufrufe')).rows;
pruefe('Trigger ruft die Edge Function genau einmal', aufrufe.length === 1 && /functions\/v1\/erinnern$/.test(aufrufe[0].url));
pruefe('… mit Eintrags-Nummer und Geheimnis aus dem Vault',
  !!aufrufe[0].body.eintrag && aufrufe[0].headers['x-lichtblick-geheim'] === 'tresor-geheim');
pruefe('A sieht Bens Foto noch nicht', !(await als(A, 'select name from storage.objects')).some(r => r.name === pfadB));
pruefe('C sieht kein Foto', (await als(C, 'select name from storage.objects')).length === 0);
await als(B, `update eintrag set text = 'Ben mit Foto!' where user_id = $1 and tag = $2`, [B, heute]);
pruefe('Ändern löst keine zweite Mitteilung aus', (await db.query('select count(*)::int as n from net.aufrufe')).rows[0].n === 1);

const eintragB = aufrufe[0].body.eintrag;
pruefe('partner_mitteilung für Nutzer gesperrt', /permission denied/.test(await fehler(() => als(A, 'select * from partner_mitteilung($1)', [eintragB]))));
await als(A, `update push_abo set aktiv = true`);
let pm = await alsService('select * from partner_mitteilung($1)', [eintragB]);
pruefe('Mitteilung geht an A (nicht an B selbst)', pm.length === 1 && pm[0].endpoint === 'ep-a');
pruefe('… Autor Ben, mit Foto, A hat noch nicht geschrieben', pm[0].autor === 'Ben' && pm[0].mit_foto === true && pm[0].partner_schon === false);

await als(A, 'insert into eintrag (paar_id,user_id,tag,text,foto) values ($1,$2,$3,$4,$5)', [paar.id, A, heute, 'Anna mit Foto', pfadA]);
pruefe('nach eigenem Eintrag sieht A Bens Foto', (await als(A, 'select name from storage.objects order by name')).some(r => r.name === pfadB));
pm = await alsService('select * from partner_mitteilung($1)', [(await db.query('select body from net.aufrufe order by ctid desc limit 1')).rows[0].body.eintrag]);
pruefe('Mitteilung an B: Ben hat kein aktives Abo → niemand', pm.length === 0);
pruefe('fremdes Foto löschen verboten', (await als(A, 'delete from storage.objects where name = $1 returning name', [pfadB])).length === 0);
pruefe('eigenes Foto löschen erlaubt', (await als(A, 'delete from storage.objects where name = $1 returning name', [pfadA])).length === 1);

// --- Paar verlassen -----------------------------------------------------------
await als(B, 'select paar_verlassen()');
pruefe('B nach Verlassen ohne Paar und ohne Sicht', (await als(B, 'select * from eintrag where user_id <> $1', [B])).length === 0);
pruefe('Paar bleibt für A bestehen', (await als(A, 'select * from paar')).length === 1);
await als(A, 'select paar_verlassen()');
pruefe('letztes Mitglied weg → Paar und Einträge gelöscht', (await db.query('select count(*)::int as n from eintrag')).rows[0].n === 0);

console.log(`\n${ok} bestanden, ${fail} fehlgeschlagen`);
process.exit(fail ? 1 : 0);
