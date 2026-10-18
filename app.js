// ErstDu – App. Ansichten: Anmelden → Name → Paar → Heute / Archiv / Wir.

import { ladeApi } from './api.js';
import { heute, gestern, tagText, monatText, serie } from './tag.js';
import { verkleinere } from './foto.js';
import * as erinnerung from './erinnerung.js';

const VERSION = '0.5.0';
const MAX_ZEICHEN = 500;
const DATUM_LANG = new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
const WOCHENTAG_KURZ = new Intl.DateTimeFormat('de-DE', { weekday: 'short' });
const LINK_GUELTIG_MS = 50 * 60 * 1000;   // signierte Foto-Links gelten 60 min, wir erneuern nach 50

const $app = document.getElementById('app');
const $leiste = document.getElementById('leiste');
const $toast = document.getElementById('toast');

const z = {
  api: null,
  name: '',
  paar: null,          // { id, code, mitglieder: [{id, name}] }
  eintraege: [],       // [{ tag, user_id, text, foto, geaendert }]
  fotos: new Map(),    // Foto-Pfad → anzeigbare URL
  fotosStand: 0,
  entwurf: {},         // je Tag: { blob, url } neues Foto oder { entfernt: true }
  ansicht: 'heute',
  email: '',
  bearbeite: null,     // Tag, dessen eigener Eintrag gerade als Formular offen ist
  nachtragen: false,
  partnerHeute: false, // hat die andere Person heute schon geschrieben?
  suche: '',
  abmelden: () => {},
  zuletztGeladen: '',
};

// Hilfen --------------------------------------------------------------------

const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function toast(text) {
  $toast.textContent = text;
  $toast.classList.add('sichtbar');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => $toast.classList.remove('sichtbar'), 2200);
}

function zeige(html, { leiste = false } = {}) {
  $app.innerHTML = html;
  $app.firstElementChild?.classList.add('einblenden');
  $leiste.hidden = !leiste;
  document.body.classList.toggle('ohne-leiste', !leiste);
  setzeBilder($app);
  window.scrollTo(0, 0);
}

// Hintergrundbilder per JS setzen (URLs nie in HTML-Attribute einbauen)
function setzeBilder(wurzel) {
  for (const el of wurzel.querySelectorAll('[data-bild]')) {
    el.style.backgroundImage = `url("${el.dataset.bild.replace(/"/g, '%22')}")`;
  }
}

async function mitKnopf(knopf, fehlerFeld, arbeit) {
  knopf.disabled = true;
  if (fehlerFeld) fehlerFeld.textContent = '';
  try { await arbeit(); }
  catch (e) {
    if (fehlerFeld) fehlerFeld.textContent = e.message;
    else toast(e.message);
  }
  finally { knopf.disabled = false; }
}

const partner = () => z.paar?.mitglieder.find(m => m.id !== z.api.userId) || null;
const meiner = tag => z.eintraege.find(e => e.tag === tag && e.user_id === z.api.userId);
const seiner = tag => z.eintraege.find(e => e.tag === tag && e.user_id !== z.api.userId);
const fotoUrl = e => (e?.foto && z.fotos.get(e.foto)) || null;
const istIos = /iPhone|iPad|iPod/.test(navigator.userAgent);
const alsApp = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

const KAMERA = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h3l1.6-2.2h6.8L17 8h3v11H4z"/><circle cx="12" cy="13" r="3.6"/></svg>`;

// Das zuletzt geteilte Foto, das man sehen darf (Held auf „Heute“, Paarkarte auf „Wir“).
function letztesFoto() {
  return z.eintraege
    .filter(e => fotoUrl(e))
    .sort((a, b) => (b.geaendert || b.tag).localeCompare(a.geaendert || a.tag))[0] || null;
}

// Willkommen beim ersten Start --------------------------------------------

const MERKER_WILLKOMMEN = 'lichtblick-willkommen';
const MERKER_ERINNERUNG_GEFRAGT = 'lichtblick-erinnerung-gefragt';
const merkerLesen = k => { try { return localStorage.getItem(k); } catch { return null; } };
const merkerSetzen = k => { try { localStorage.setItem(k, '1'); } catch { /* privates Fenster */ } };

const WILLKOMMEN = [
  { titel: 'Liebe verbindet.',
    text: 'Gedanken, Momente – das Schönste an einem Tag. ErstDu ist ein stiller Ort nur für euch zwei.' },
  { titel: 'Ein Moment am Tag.',
    text: 'Jeden Tag eine Frage: Was war heute das Beste? Ein Satz genügt, ein Foto, wenn du magst. Kein Chat, kein Feed, keine Likes – abseits aller Messenger. Nur dieser eine Gedanke für den anderen.' },
  { titel: 'Erst teilen, dann sehen.',
    text: 'Den Moment deines Gegenübers siehst du, sobald du deinen eigenen festgehalten hast. So bleibt jeder Tag eine kleine Überraschung – und ihr sammelt ein Archiv eurer schönsten Momente.' },
];

// Drei Seiten zum Wischen; liefert ein Promise, das beim Schließen erfüllt wird.
function willkommen() {
  return new Promise(fertig => {
    const letzte = WILLKOMMEN.length - 1;
    const el = document.createElement('div');
    el.className = 'willkommen';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-label', 'Willkommen bei ErstDu');
    el.innerHTML = `
      <div class="seiten">${WILLKOMMEN.map((w, i) => `
        <section class="seite">
          <div class="motiv m${i}" aria-hidden="true"></div>
          <h2>${esc(w.titel)}</h2>
          <p>${esc(w.text)}</p>
        </section>`).join('')}
      </div>
      <div class="unten">
        <div class="punkte">${WILLKOMMEN.map((_, i) => `<i class="${i ? '' : 'an'}"></i>`).join('')}</div>
        <button class="haupt" id="w-weiter">Weiter</button>
        <button class="link klein" id="w-ueberspringen">Überspringen</button>
      </div>`;
    document.body.append(el);
    document.body.classList.add('gesperrt');

    const seiten = el.querySelector('.seiten');
    const weiterKnopf = el.querySelector('#w-weiter');
    const ueberspringen = el.querySelector('#w-ueberspringen');
    const index = () => Math.round(seiten.scrollLeft / seiten.clientWidth);
    const anzeigen = () => {
      const i = index();
      el.querySelectorAll('.punkte i').forEach((p, j) => p.classList.toggle('an', j === i));
      weiterKnopf.textContent = i >= letzte ? 'Los geht’s' : 'Weiter';
      ueberspringen.style.visibility = i >= letzte ? 'hidden' : 'visible';
    };
    const schliessen = () => {
      merkerSetzen(MERKER_WILLKOMMEN);
      document.body.classList.remove('gesperrt');
      el.classList.add('weg');
      setTimeout(() => el.remove(), 300);
      fertig();
    };
    seiten.addEventListener('scroll', anzeigen, { passive: true });
    weiterKnopf.onclick = () => {
      const i = index();
      if (i >= letzte) schliessen();
      else seiten.scrollTo({ left: (i + 1) * seiten.clientWidth, behavior: 'smooth' });
    };
    ueberspringen.onclick = schliessen;
    weiterKnopf.focus();
  });
}

// Start ---------------------------------------------------------------------

async function start() {
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  try {
    z.api = await ladeApi();
  } catch {
    zeige(`<div><h1>Keine Verbindung</h1><p>ErstDu braucht beim Start Internet. Bitte später noch einmal öffnen.</p></div>`);
    return;
  }
  document.getElementById('demo-band').hidden = !z.api.demo;
  const codeAusLink = new URLSearchParams(location.search).get('code');
  if (codeAusLink) sessionStorage.setItem('lichtblick-code', codeAusLink);

  $leiste.addEventListener('click', e => {
    const b = e.target.closest('button[data-ziel]');
    if (b) wechsle(b.dataset.ziel);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && z.paar) aktualisiere();
  });

  if (!merkerLesen(MERKER_WILLKOMMEN)) await willkommen();
  await weiter();
}

// Entscheidet, welcher Schritt als Nächstes dran ist.
async function weiter() {
  if (!(await z.api.init())) return anmelden();
  z.email = z.api.email || z.email;
  const p = await z.api.profil();
  if (!p) return nameFestlegen();
  z.name = p.name;
  z.paar = await z.api.paar();
  if (!z.paar) return paarStart();
  await ladeEintraege();
  z.abmelden();
  z.abmelden = z.api.abonniere(() => aktualisiere());
  erinnerung.abgleichen(z.api);
  wechsle(z.ansicht);
}

async function ladeEintraege() {
  z.eintraege = await z.api.eintraege();
  z.partnerHeute = partner() ? await z.api.partnerHatGeschrieben(heute()) : false;
  z.zuletztGeladen = heute();
  await ladeFotoLinks();
}

async function ladeFotoLinks() {
  if (Date.now() - z.fotosStand > LINK_GUELTIG_MS) { z.fotos = new Map(); z.fotosStand = Date.now(); }
  const fehlend = [...new Set(z.eintraege.map(e => e.foto).filter(p => p && !z.fotos.has(p)))];
  if (!fehlend.length) return;
  try {
    for (const [pfad, url] of await z.api.fotoLinks(fehlend)) z.fotos.set(pfad, url);
  } catch { /* Fotos fehlen dann nur in der Anzeige */ }
}

// Neu laden, ohne angefangenen Text im Formular zu zerstören.
async function aktualisiere() {
  try {
    const neuerTag = z.zuletztGeladen !== heute();
    z.paar = await z.api.paar();
    await ladeEintraege();
    const tipptGerade = document.activeElement?.tagName === 'TEXTAREA';
    if (z.ansicht === 'heute') {
      if (neuerTag && !tipptGerade) zeigeHeute();
      else zeichnePartner();
    } else if (z.ansicht === 'archiv') zeichneArchivListe();
  } catch { /* offline – beim nächsten Mal */ }
}

function wechsle(ziel) {
  z.ansicht = ziel;
  for (const b of $leiste.querySelectorAll('button')) {
    if (b.dataset.ziel === ziel) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  }
  if (ziel === 'heute') zeigeHeute();
  else if (ziel === 'archiv') zeigeArchiv();
  else zeigeWir();
}

// Anmelden ------------------------------------------------------------------

function startHeld(titel, text) {
  return `<section class="start-held">
    <img class="logo" src="icons/icon-180.png" alt="">
    <h1>${titel}</h1>
    <p>${text}</p>
  </section>`;
}

function anmelden() {
  const installHinweis = istIos && !alsApp
    ? `<div class="hinweis">Tipp: In Safari auf <b>Teilen</b> → <b>Zum Home-Bildschirm</b> tippen. Dann startet ErstDu wie eine App und kann dich erinnern.</div>`
    : '';
  zeige(`<div>
    ${startHeld('ErstDu', 'Ein Moment am Tag. Nur für euch zwei.')}
    ${installHinweis}
    <form id="f-mail" class="karte">
      <label class="klein leise" for="mail">Deine E-Mail-Adresse</label>
      <input id="mail" type="email" autocomplete="email" inputmode="email" required value="${esc(z.email)}" placeholder="name@beispiel.de" style="margin-top:6px">
      <button class="haupt" style="margin-top:12px">Code schicken</button>
      <div class="fehler" id="fehler"></div>
    </form>
    <p class="klein leise zentriert">Du bekommst einen Code per E-Mail. Kein Passwort nötig.
    ${z.api.demo ? '<br><b>Demo:</b> beliebige Adresse, Code 123456.' : ''}</p>
  </div>`);
  const f = document.getElementById('f-mail');
  f.addEventListener('submit', e => {
    e.preventDefault();
    z.email = f.mail.value.trim();
    mitKnopf(f.querySelector('button'), document.getElementById('fehler'), async () => {
      await z.api.sendeCode(z.email);
      codeEingeben();
    });
  });
}

function codeEingeben() {
  zeige(`<div>
    <h1>Code eingeben</h1>
    <p class="leise">Wir haben einen Code an <b>${esc(z.email)}</b> geschickt. Schau auch im Spam-Ordner.</p>
    <form id="f-code" class="karte">
      <input id="code" class="code" inputmode="numeric" autocomplete="one-time-code" maxlength="8" pattern="[0-9]{6,8}" required placeholder="······">
      <button class="haupt" style="margin-top:12px">Anmelden</button>
      <div class="fehler" id="fehler"></div>
    </form>
    <button class="link" id="zurueck">Andere Adresse</button>
  </div>`);
  const f = document.getElementById('f-code');
  f.code.focus();
  f.addEventListener('submit', e => {
    e.preventDefault();
    mitKnopf(f.querySelector('button'), document.getElementById('fehler'), async () => {
      await z.api.pruefeCode(z.email, f.code.value.trim());
      await weiter();
    });
  });
  document.getElementById('zurueck').onclick = anmelden;
}

function nameFestlegen() {
  zeige(`<div>
    <h1>Wie heißt du?</h1>
    <p class="leise">Diesen Namen sieht die Person, mit der du ErstDu teilst.</p>
    <form id="f-name" class="karte">
      <input id="name" maxlength="40" autocomplete="given-name" required placeholder="Vorname">
      <button class="haupt" style="margin-top:12px">Weiter</button>
      <div class="fehler" id="fehler"></div>
    </form>
  </div>`);
  const f = document.getElementById('f-name');
  f.name.focus();
  f.addEventListener('submit', e => {
    e.preventDefault();
    mitKnopf(f.querySelector('button'), document.getElementById('fehler'), async () => {
      await z.api.setzeName(f.name.value.trim());
      await weiter();
    });
  });
}

function paarStart() {
  const code = sessionStorage.getItem('lichtblick-code') || '';
  zeige(`<div>
    <h1>Mit wem teilst du deine Momente?</h1>
    <p class="leise">ErstDu verbindet genau zwei Menschen. Nur ihr beide seht eure Einträge.</p>
    <div class="karte">
      <h2 style="margin-top:0">Ich habe einen Code</h2>
      <form id="f-beitreten">
        <input id="code" class="code" maxlength="6" autocapitalize="characters" autocomplete="off" required value="${esc(code)}" placeholder="CODE">
        <button class="haupt" style="margin-top:12px">Beitreten</button>
        <div class="fehler" id="fehler"></div>
      </form>
      ${z.api.demo ? '<p class="klein leise" style="margin:8px 0 0"><b>Demo:</b> Code K7M3QX verbindet dich mit „Sam“.</p>' : ''}
    </div>
    <div class="karte">
      <h2 style="margin-top:0">Ich fange an</h2>
      <p class="leise klein">Du bekommst einen Code für die andere Person. Bis sie beitritt, schreibst du schon allein.</p>
      <button class="zweit" id="gruenden">Neues Paar anlegen</button>
    </div>
  </div>`);
  const f = document.getElementById('f-beitreten');
  f.addEventListener('submit', e => {
    e.preventDefault();
    mitKnopf(f.querySelector('button'), document.getElementById('fehler'), async () => {
      await z.api.paarBeitreten(f.code.value);
      sessionStorage.removeItem('lichtblick-code');
      toast('Ihr seid verbunden');
      await weiter();
    });
  });
  const g = document.getElementById('gruenden');
  g.onclick = () => mitKnopf(g, null, async () => {
    await z.api.paarGruenden();
    z.ansicht = 'mehr';
    await weiter();
  });
}

// Heute ---------------------------------------------------------------------

function held() {
  const t = heute();
  const f = letztesFoto();
  let nachweis = '';
  if (f) {
    const von = f.user_id === z.api.userId ? 'Dein Foto' : `Foto von ${esc(partner()?.name || '')}`;
    nachweis = `<div class="bildnachweis">${von} · ${esc(tagText(f.tag))}</div>`;
  }
  return `<section class="held ${f ? '' : 'ohne-foto'}">
    ${f ? `<div class="bild" data-bild="${esc(fotoUrl(f))}"></div>` : ''}
    <span class="datum">${esc(DATUM_LANG.format(new Date(t + 'T12:00:00')))}</span>
    <div class="frage">Was war heute<br>das Beste?</div>
    ${nachweis}
  </section>`;
}

// Die letzten sieben Tage als Kreise. Der Ring zeigt, wer geschrieben hat:
// linke Hälfte apricot = du, rechte Hälfte salbei = die andere Person.
function wochenstreifen() {
  const ich = z.api.userId;
  const p = partner();
  const ende = new Date(heute() + 'T12:00:00');
  let tage = '';
  for (let i = 6; i >= 0; i--) {
    const d = new Date(ende);
    d.setDate(d.getDate() - i);
    const tag = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const ichJa = z.eintraege.some(e => e.tag === tag && e.user_id === ich);
    const duJa = !!p && (z.eintraege.some(e => e.tag === tag && e.user_id !== ich) || (i === 0 && z.partnerHeute));
    const links = ichJa ? 'var(--apricot)' : 'var(--ring-leer)';
    const rechts = p ? (duJa ? 'var(--salbei)' : 'var(--ring-leer)') : links;
    const wer = [ichJa && 'du', duJa && p.name].filter(Boolean).join(' und ') || 'niemand';
    tage += `<div class="t ${i === 0 ? 'heute' : ''}" aria-label="${esc(tagText(tag))}: ${esc(wer)}">
      <span>${esc(WOCHENTAG_KURZ.format(d).replace('.', '').slice(0, 2))}</span>
      <i style="--l:${links};--r:${rechts}">${d.getDate()}</i>
    </div>`;
  }
  const legende = p
    ? `<div class="legende"><span class="ich">du</span><span class="du">${esc(p.name)}</span></div>`
    : '';
  return `<div class="woche" role="group" aria-label="Die letzten sieben Tage"><div class="tage">${tage}</div>${legende}</div>`;
}

function formular(tag, vorhanden) {
  const istHeute = tag === heute();
  const titel = vorhanden ? 'Deinen Moment ändern'
    : istHeute ? 'Dein Moment heute' : `${tagText(tag)} nachtragen`;
  const abbrechen = vorhanden || !istHeute;
  return `<form class="karte schreibkarte eintragform" data-tag="${tag}">
    <div class="schreibkopf">
      <span class="schritt">1</span>
      <div><b>${esc(titel)}</b><span class="leise klein">Was hat dich heute gefreut? Ein Satz reicht.</span></div>
    </div>
    <textarea name="text" maxlength="${MAX_ZEICHEN}" placeholder="Zum Beispiel: Kaffee in der Sonne, bevor alle wach waren.">${esc(vorhanden?.text)}</textarea>
    <div class="zaehler leise"><span>${(vorhanden?.text || '').length}</span> / ${MAX_ZEICHEN}</div>
    <div class="schreibkopf">
      <span class="schritt">2</span>
      <div><b>Foto dazu</b><span class="leise klein">Freiwillig – ein Bild von diesem Moment.</span></div>
    </div>
    <div class="vorschauplatz"></div>
    <label class="fotofeld">${KAMERA}<span>Foto auswählen</span><input type="file" accept="image/*" name="foto"></label>
    <button class="haupt" data-aktion="speichern">${vorhanden ? 'Änderung speichern' : 'Moment festhalten'}</button>
    ${abbrechen ? '<button type="button" class="link klein abbrechen" data-aktion="abbrechen">Abbrechen</button>' : ''}
    <div class="fehler"></div>
  </form>`;
}

function eintragKarte(e, { wer, klasse, aenderbar = false, text = esc(e.text) }) {
  const url = fotoUrl(e);
  return `<div class="karte ${klasse}">
    ${url ? `<img class="kartenfoto" src="${esc(url)}" alt="" loading="lazy">` : ''}
    <div class="kopf"><div class="wer">${esc(wer)}</div>
      ${aenderbar ? `<button class="link klein" data-aktion="aendern" data-tag="${e.tag}">Ändern</button>` : ''}</div>
    <div class="eintragtext">${text}</div>
  </div>`;
}

function zeigeHeute() {
  const t = heute(), g = gestern();
  const mein = meiner(t);
  const offen = z.bearbeite === t || !mein;
  const gesternFehlt = !meiner(g);

  let nachtrag = '';
  if (z.nachtragen && gesternFehlt) nachtrag = `<div style="margin-top:24px">${formular(g, null)}</div>`;
  else if (gesternFehlt) nachtrag = `<button class="link" data-aktion="nachtragen">Gestern vergessen? Nachtragen</button>`;

  zeige(`<div>
    ${held()}
    ${wochenstreifen()}
    ${offen ? formular(t, mein) : eintragKarte(mein, { wer: 'Du', klasse: 'ich', aenderbar: true })}
    <div id="partnerbereich"></div>
    <div id="erinnerungsfrage"></div>
    ${nachtrag}
  </div>`, { leiste: true });

  zeichnePartner();
  zeichneErinnerungsfrage();
  verdrahteFormulare();
}

// Nach dem ersten eigenen ErstDu einmal fragen, ob ErstDu abends erinnern soll.
function zeichneErinnerungsfrage() {
  const ziel = document.getElementById('erinnerungsfrage');
  if (!ziel || !meiner(heute()) || merkerLesen(MERKER_ERINNERUNG_GEFRAGT) || erinnerung.gemerkt()) return;
  const status = erinnerung.pushStatus();
  const pn = esc(partner()?.name || 'die andere Person');
  if (status === 'bereit') {
    ziel.innerHTML = `<div class="karte erinnerungsfrage einblenden">
      <div class="glocke" aria-hidden="true">🔔</div>
      <b class="serif">Jeden Abend erinnern?</b>
      <p class="klein leise">ErstDu meldet sich einmal am Abend – nur, wenn du noch nichts geschrieben hast.
        Und sofort, wenn ${pn} einen Moment teilt. Ändern kannst du das jederzeit unter „Wir“.</p>
      <div class="knopfreihe">
        <button class="zweit" data-frage="nein">Nein danke</button>
        <button class="haupt" data-frage="ja">Ja, um 21 Uhr</button>
      </div>
    </div>`;
  } else if (status === 'ios-browser') {
    ziel.innerHTML = `<div class="karte erinnerungsfrage einblenden">
      <div class="glocke" aria-hidden="true">🔔</div>
      <b class="serif">Damit ErstDu dich erinnern kann</b>
      <p class="klein leise">Leg ErstDu auf den Home-Bildschirm: in Safari auf <b>Teilen</b> → <b>Zum Home-Bildschirm</b>
        tippen und ErstDu dann von dort öffnen. Erst dann sind Mitteilungen möglich.</p>
      <button class="zweit" data-frage="nein">Verstanden</button>
    </div>`;
  } else return;

  for (const b of ziel.querySelectorAll('[data-frage]')) {
    b.addEventListener('click', async () => {
      if (b.dataset.frage === 'ja') {
        b.disabled = true;
        try {
          await erinnerung.einschalten(z.api, '21:00');
          toast('Erinnerung um 21 Uhr');
        } catch (e) { toast(e.message); b.disabled = false; return; }
      }
      merkerSetzen(MERKER_ERINNERUNG_GEFRAGT);
      ziel.innerHTML = '';
    });
  }
}

function zeichnePartner() {
  const ziel = document.getElementById('partnerbereich');
  if (!ziel) return;
  const p = partner();
  const t = heute();
  let html;
  if (!p) {
    html = `<div class="hinweis">Du schreibst gerade allein. Unter <b>Wir</b> findest du den Code, mit dem jemand dazukommen kann.</div>`;
  } else if (meiner(t)) {
    const e = seiner(t);
    html = e
      ? eintragKarte(e, { wer: p.name, klasse: 'partner einblenden' })
      : `<p class="leise">${esc(p.name)} hat heute noch nichts geschrieben.</p>`;
  } else if (z.partnerHeute) {
    html = `<div class="verdeckt"><span class="symbol">✉️</span><div>
      <b>${esc(p.name)} hat schon geschrieben</b>
      <span>Halte deinen Moment fest, dann siehst du den von ${esc(p.name)}.</span></div></div>`;
  } else {
    html = `<p class="leise">${esc(p.name)} hat heute auch noch nichts geschrieben.</p>`;
  }
  ziel.innerHTML = html;
}

// Vorschau des Fotos im Formular (neu gewählt, vorhanden oder keins)
function zeichneVorschau(form) {
  const tag = form.dataset.tag;
  const ent = z.entwurf[tag];
  const url = ent?.url || (!ent?.entfernt && fotoUrl(meiner(tag))) || null;
  const platz = form.querySelector('.vorschauplatz');
  platz.innerHTML = url
    ? `<div class="vorschau"><img src="${esc(url)}" alt="Gewähltes Foto"><button type="button" data-aktion="foto-weg" aria-label="Foto entfernen">×</button></div>`
    : '';
  form.querySelector('.fotofeld span').textContent = url ? 'Anderes Foto wählen' : 'Foto auswählen';
  form.querySelector('.fotofeld').classList.toggle('klein', !!url);
}

function verwerfeEntwurf(tag) {
  if (z.entwurf[tag]?.url) URL.revokeObjectURL(z.entwurf[tag].url);
  delete z.entwurf[tag];
}

function verdrahteFormulare() {
  $app.onclick = e => {
    const b = e.target.closest('[data-aktion]');
    if (!b) return;
    const a = b.dataset.aktion;
    if (a === 'aendern') { z.bearbeite = b.dataset.tag; zeigeHeute(); fokus(); }
    if (a === 'nachtragen') { z.nachtragen = true; zeigeHeute(); fokus(gestern()); }
    if (a === 'abbrechen') {
      const tag = b.closest('form').dataset.tag;
      verwerfeEntwurf(tag);
      if (tag === heute()) z.bearbeite = null; else z.nachtragen = false;
      zeigeHeute();
    }
    if (a === 'foto-weg') {
      const form = b.closest('form');
      verwerfeEntwurf(form.dataset.tag);
      z.entwurf[form.dataset.tag] = { entfernt: true };
      zeichneVorschau(form);
    }
  };
  for (const f of $app.querySelectorAll('.eintragform')) {
    const feld = f.text;
    const zaehler = f.querySelector('.zaehler span');
    const passe = () => {
      zaehler.textContent = feld.value.length;
      feld.style.height = 'auto';
      feld.style.height = Math.max(110, feld.scrollHeight + 2) + 'px';
    };
    feld.addEventListener('input', passe);
    passe();
    zeichneVorschau(f);

    f.foto.addEventListener('change', async () => {
      const datei = f.foto.files[0];
      f.foto.value = '';
      if (!datei) return;
      const fehler = f.querySelector('.fehler');
      fehler.textContent = '';
      try {
        const blob = await verkleinere(datei, z.api.demo ? { max: 900, qualitaet: 0.7 } : undefined);
        verwerfeEntwurf(f.dataset.tag);
        z.entwurf[f.dataset.tag] = { blob, url: URL.createObjectURL(blob) };
        zeichneVorschau(f);
      } catch (err) { fehler.textContent = err.message; }
    });

    f.addEventListener('submit', e => {
      e.preventDefault();
      const text = feld.value.trim();
      const fehler = f.querySelector('.fehler');
      if (!text) { fehler.textContent = 'Schreib wenigstens ein paar Worte.'; return; }
      mitKnopf(f.querySelector('[data-aktion="speichern"]'), fehler, async () => {
        const tag = f.dataset.tag;
        const alt = meiner(tag)?.foto || null;
        const ent = z.entwurf[tag];
        let foto = alt;
        if (ent?.blob) foto = await z.api.fotoHochladen(tag, ent.blob);
        else if (ent?.entfernt) foto = null;
        try {
          await z.api.speichere(tag, text, foto);
        } catch (err) {
          if (foto && foto !== alt) z.api.fotoLoeschen(foto).catch(() => {});
          throw err;
        }
        if (alt && alt !== foto) z.api.fotoLoeschen(alt).catch(() => {});
        verwerfeEntwurf(tag);
        z.bearbeite = null;
        if (tag !== heute()) z.nachtragen = false;
        await ladeEintraege();
        zeigeHeute();
        toast('Festgehalten');
      });
    });
  }
}

function fokus(tag = heute()) {
  const f = $app.querySelector(`.eintragform[data-tag="${tag}"] textarea`);
  if (f) { f.focus(); f.setSelectionRange(f.value.length, f.value.length); }
}

// Archiv --------------------------------------------------------------------

function zeigeArchiv() {
  const ich = z.api.userId;
  const meineTage = z.eintraege.filter(e => e.user_id === ich).map(e => e.tag);
  const partnerTage = new Set(z.eintraege.filter(e => e.user_id !== ich).map(e => e.tag));
  const gemeinsam = meineTage.filter(t => partnerTage.has(t)).length;

  zeige(`<div>
    <h1>Archiv</h1>
    <div class="zahlen">
      <div class="zahl"><b>${meineTage.length}</b><span>Einträge</span></div>
      <div class="zahl"><b>${serie(meineTage)}</b><span>Tage am Stück</span></div>
      ${partner() ? `<div class="zahl"><b>${gemeinsam}</b><span>zu zweit</span></div>` : ''}
    </div>
    <input class="suche" id="suche" type="search" placeholder="Suchen …" value="${esc(z.suche)}" autocomplete="off">
    <div id="liste"></div>
  </div>`, { leiste: true });

  $app.onclick = null;
  const s = document.getElementById('suche');
  s.addEventListener('input', () => { z.suche = s.value; zeichneArchivListe(); });
  zeichneArchivListe();
}

function markiere(text, suche) {
  const sicher = esc(text);
  if (!suche) return sicher;
  const muster = new RegExp(esc(suche).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
  return sicher.replace(muster, m => `<mark>${m}</mark>`);
}

function zeichneArchivListe() {
  const ziel = document.getElementById('liste');
  if (!ziel) return;
  const ich = z.api.userId;
  const p = partner();
  const suche = z.suche.trim().toLowerCase();

  const proTag = new Map();
  for (const e of z.eintraege) {
    if (suche && !e.text.toLowerCase().includes(suche)) continue;
    if (!proTag.has(e.tag)) proTag.set(e.tag, {});
    proTag.get(e.tag)[e.user_id === ich ? 'ich' : 'du'] = e;
  }
  const tage = [...proTag.keys()].sort().reverse();
  if (!tage.length) {
    ziel.innerHTML = `<p class="leise" style="margin-top:24px">${suche ? 'Nichts gefunden.' : 'Noch keine Einträge. Der erste Moment wartet unter „Heute“.'}</p>`;
    return;
  }

  let html = '', monat = '';
  for (const t of tage) {
    const m = monatText(t);
    if (m !== monat) { html += `<div class="monat">${esc(m)}</div>`; monat = m; }
    const { ich: a, du: b } = proTag.get(t);
    html += `<div class="tag"><div class="datumzeile">${esc(tagText(t))}</div>`;
    if (a) html += eintragKarte(a, { wer: 'Du', klasse: 'ich', text: markiere(a.text, z.suche.trim()) });
    if (b) html += eintragKarte(b, { wer: p?.name || 'Früher geteilt', klasse: 'partner', text: markiere(b.text, z.suche.trim()) });
    html += `</div>`;
  }
  ziel.innerHTML = html;
}

// Wir (Paar, Name, Erinnerung, Export, Konto) -------------------------------

function einladungslink() {
  const u = new URL(location.href);
  u.search = '';
  u.hash = '';
  u.searchParams.set('code', z.paar.code);
  return u.toString();
}

function zeigeWir() {
  const p = partner();
  const f = letztesFoto();
  const ich = z.api.userId;
  const meineTage = new Set(z.eintraege.filter(e => e.user_id === ich).map(e => e.tag));
  const gemeinsam = [...new Set(z.eintraege.filter(e => e.user_id !== ich).map(e => e.tag))].filter(t => meineTage.has(t)).length;

  const paarKarte = p
    ? `<div class="paarkarte">
         ${f ? `<div class="bild" data-bild="${esc(fotoUrl(f))}"></div>` : ''}
         <div class="namen">${esc(z.name)} &amp; ${esc(p.name)}</div>
         <div class="seit">${gemeinsam === 1 ? 'Ein gemeinsamer Moment' : `${gemeinsam} gemeinsame Momente`}</div>
       </div>`
    : `<div class="karte">
         <h2 style="margin-top:0">Jemanden einladen</h2>
         <p class="leise klein">Die andere Person öffnet ErstDu, meldet sich an und gibt diesen Code ein:</p>
         <div class="codeanzeige">${esc(z.paar.code)}</div>
         <button class="haupt" id="einladen">Einladung teilen</button>
       </div>`;

  zeige(`<div>
    <h1>Wir</h1>
    ${paarKarte}
    <div class="karte">
      <form id="f-name">
        <label class="klein leise" for="name">Dein Name</label>
        <div class="knopfreihe" style="margin-top:6px">
          <input id="name" maxlength="40" required value="${esc(z.name)}" style="flex:2">
          <button class="zweit">Sichern</button>
        </div>
      </form>
    </div>
    <div class="karte">
      <h2 style="margin-top:0">Erinnerung</h2>
      <div id="erinnerung"><p class="klein leise">Lädt …</p></div>
    </div>
    <div class="karte">
      <h2 style="margin-top:0">Sichern</h2>
      <p class="klein leise">Alle Einträge, die du sehen kannst, als Datei (ohne Fotos).</p>
      <div class="knopfreihe">
        <button class="zweit" id="export-text">Als Text</button>
        <button class="zweit" id="export-json">Als JSON</button>
      </div>
    </div>
    <div class="karte">
      <div class="zeile"><span class="klein leise">Angemeldet als</span><span class="klein">${esc(z.email || (z.api.demo ? 'Demo' : '…'))}</span></div>
      <div class="zeile"><span class="klein leise">Version</span><span class="klein">${VERSION}</span></div>
      <button class="link" id="worum">Worum es bei ErstDu geht</button><br>
      <button class="link" id="abmelden">Abmelden</button><br>
      <button class="gefahr" id="verlassen">Paar verlassen …</button>
    </div>
  </div>`, { leiste: true });

  $app.onclick = null;
  const ein = document.getElementById('einladen');
  if (ein) ein.onclick = async () => {
    const link = einladungslink();
    const text = `Lass uns jeden Tag einen Moment miteinander teilen. Code: ${z.paar.code}`;
    try {
      if (navigator.share) await navigator.share({ title: 'ErstDu', text, url: link });
      else { await navigator.clipboard.writeText(`${text}\n${link}`); toast('Einladung kopiert'); }
    } catch { /* Teilen abgebrochen */ }
  };

  const fn = document.getElementById('f-name');
  fn.addEventListener('submit', e => {
    e.preventDefault();
    mitKnopf(fn.querySelector('button'), null, async () => {
      await z.api.setzeName(fn.name.value.trim());
      z.name = fn.name.value.trim();
      z.paar = await z.api.paar();
      toast('Name gesichert');
    });
  });

  zeichneErinnerung();

  document.getElementById('worum').onclick = () => willkommen();
  document.getElementById('export-text').onclick = () => exportiere('text');
  document.getElementById('export-json').onclick = () => exportiere('json');

  document.getElementById('abmelden').onclick = async () => {
    z.abmelden();
    await erinnerung.vorAbmelden(z.api);
    await z.api.abmelden();
    z.paar = null; z.eintraege = []; z.fotos = new Map(); z.ansicht = 'heute';
    anmelden();
  };
  document.getElementById('verlassen').onclick = async () => {
    const warn = p
      ? `Wirklich verlassen? Du siehst danach die gemeinsamen Einträge nicht mehr. ${p.name} behält sie.`
      : 'Wirklich verlassen? Du bist allein im Paar – alle deine Einträge werden gelöscht.';
    if (!confirm(warn)) return;
    try {
      z.abmelden();
      await z.api.paarVerlassen();
      z.paar = null; z.eintraege = []; z.fotos = new Map(); z.ansicht = 'heute';
      await weiter();
    } catch (e) { toast(e.message); }
  };
}

// Karte „Erinnerung“: je nach Gerät Hinweis oder Schalter mit Uhrzeit.
async function zeichneErinnerung() {
  const ziel = document.getElementById('erinnerung');
  if (!ziel) return;
  const status = erinnerung.pushStatus();
  if (status === 'ios-browser') {
    ziel.innerHTML = `<p class="klein">Auf dem iPhone kann ErstDu nur erinnern, wenn es auf dem Home-Bildschirm liegt:
      in Safari <b>Teilen</b> → <b>Zum Home-Bildschirm</b>, dann ErstDu von dort starten.</p>`;
    return;
  }
  if (status === 'nicht-unterstuetzt') {
    ziel.innerHTML = `<p class="klein">Dieser Browser kann keine Mitteilungen empfangen.</p>`;
    return;
  }
  if (status === 'verweigert') {
    ziel.innerHTML = `<p class="klein">Mitteilungen für ErstDu sind ausgeschaltet. Einschalten unter
      <b>Einstellungen → Mitteilungen → ErstDu</b>, danach ErstDu neu öffnen.</p>`;
    return;
  }

  let an = false, uhrzeit = erinnerung.gemerkt()?.uhrzeit || '21:00';
  try {
    const endpoint = z.api.demo ? 'demo' : (await erinnerung.aktuellesAbo())?.endpoint;
    const zeile = endpoint ? await z.api.erinnerungLesen(endpoint) : null;
    if (zeile?.aktiv) { an = true; uhrzeit = zeile.uhrzeit.slice(0, 5); }
  } catch { /* offline: Stand aus dem Merker */ an = !!erinnerung.gemerkt(); }
  if (!erinnerung.UHRZEITEN.includes(uhrzeit)) uhrzeit = '21:00';

  const pn = esc(partner()?.name || 'die andere Person');
  ziel.innerHTML = `
    <div class="zeile">
      <label for="erinnern-an">Mitteilungen</label>
      <input type="checkbox" class="schalter" id="erinnern-an" ${an ? 'checked' : ''}>
    </div>
    <div class="zeile">
      <label for="erinnern-zeit" class="${an ? '' : 'leise'}">Abends erinnern um</label>
      <select id="erinnern-zeit" ${an ? '' : 'disabled'}>
        ${erinnerung.UHRZEITEN.map(u => `<option ${u === uhrzeit ? 'selected' : ''}>${u}</option>`).join('')}
      </select>
    </div>
    <p class="klein leise" style="margin:10px 0 0">Du bekommst eine Mitteilung, sobald ${pn} einen Moment teilt.
      Abends erinnert ErstDu dich nur, wenn du an dem Tag noch nichts geschrieben hast.</p>
    <button class="link klein" id="erinnern-test">Test-Mitteilung zeigen</button>`;

  const schalter = document.getElementById('erinnern-an');
  const zeit = document.getElementById('erinnern-zeit');
  schalter.onchange = async () => {
    schalter.disabled = true;
    try {
      if (schalter.checked) { await erinnerung.einschalten(z.api, zeit.value); toast('Mitteilungen an'); }
      else { await erinnerung.ausschalten(z.api); toast('Mitteilungen aus'); }
    } catch (e) { toast(e.message); }
    zeichneErinnerung();
  };
  zeit.onchange = async () => {
    try { await erinnerung.einschalten(z.api, zeit.value); toast(`Erinnerung um ${zeit.value} Uhr`); }
    catch (e) { toast(e.message); zeichneErinnerung(); }
  };
  document.getElementById('erinnern-test').onclick = async () => {
    try { await erinnerung.testMitteilung(partner()?.name); }
    catch (e) { toast(e.message); }
  };
}

async function exportiere(art) {
  const ich = z.api.userId;
  const name = id => id === ich ? z.name : (partner()?.name || 'Partner');
  const liste = [...z.eintraege].sort((a, b) => a.tag.localeCompare(b.tag) || name(a.user_id).localeCompare(name(b.user_id)));
  const stempel = heute();
  let inhalt, datei, typ;
  if (art === 'json') {
    inhalt = JSON.stringify({ app: 'ErstDu', version: VERSION, exportiert: new Date().toISOString(),
      eintraege: liste.map(e => ({ tag: e.tag, von: name(e.user_id), text: e.text, mit_foto: !!e.foto })) }, null, 2);
    datei = `erstdu-${stempel}.json`; typ = 'application/json';
  } else {
    let tag = '';
    inhalt = '# ErstDu\n';
    for (const e of liste) {
      if (e.tag !== tag) { inhalt += `\n## ${tagText(e.tag)} (${e.tag})\n`; tag = e.tag; }
      inhalt += `- ${name(e.user_id)}: ${e.text.replace(/\n/g, ' ')}${e.foto ? ' (mit Foto)' : ''}\n`;
    }
    datei = `erstdu-${stempel}.md`; typ = 'text/markdown';
  }
  const file = new File([inhalt], datei, { type: typ });
  try {
    if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: 'ErstDu' }); return; }
  } catch (e) { if (e.name === 'AbortError') return; }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = datei;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

start();
