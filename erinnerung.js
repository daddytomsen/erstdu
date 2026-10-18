// Lichtblick – Erinnerung am Abend: Mitteilungs-Erlaubnis, Push-Abo, Test-Mitteilung.
// Der Server-Teil steckt in supabase/functions/erinnern und supabase/erinnerung.sql.

const MERKER = 'lichtblick-erinnerung';   // { uhrzeit } solange die Erinnerung an ist

export const UHRZEITEN = ['18:00', '18:30', '19:00', '19:30', '20:00', '20:30', '21:00',
  '21:30', '22:00', '22:30', '23:00', '23:30'];

const istIos = /iPhone|iPad|iPod/.test(navigator.userAgent);
const alsApp = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

// 'bereit' | 'ios-browser' | 'nicht-unterstuetzt' | 'verweigert'
export function pushStatus() {
  if (!('serviceWorker' in navigator)) return 'nicht-unterstuetzt';
  // Auf iPhone/iPad gibt es Push nur für Web-Apps auf dem Home-Bildschirm (ab iOS 16.4).
  if (istIos && !alsApp()) return 'ios-browser';
  if (!('PushManager' in window) || !('Notification' in window)) return 'nicht-unterstuetzt';
  if (Notification.permission === 'denied') return 'verweigert';
  return 'bereit';
}

export function gemerkt() {
  try { return JSON.parse(localStorage.getItem(MERKER)); } catch { return null; }
}
function merke(wert) {
  try {
    if (wert) localStorage.setItem(MERKER, JSON.stringify(wert));
    else localStorage.removeItem(MERKER);
  } catch { /* privates Fenster */ }
}

function schluesselBytes(base64url) {
  const b64 = (base64url + '='.repeat((4 - base64url.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
}

async function registrierung() {
  return navigator.serviceWorker.ready;
}

export async function aktuellesAbo() {
  if (pushStatus() !== 'bereit') return null;
  return (await registrierung()).pushManager.getSubscription();
}

// Fragt (falls nötig) nach der Erlaubnis und liefert ein Push-Abo.
// Muss direkt aus einem Tippen heraus aufgerufen werden, sonst blockt iOS die Frage.
async function abonnieren(vapidPublic) {
  const erlaubnis = await Notification.requestPermission();
  if (erlaubnis !== 'granted') throw new Error('Ohne Erlaubnis für Mitteilungen geht es nicht.');
  const reg = await registrierung();
  return (await reg.pushManager.getSubscription())
    || reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: schluesselBytes(vapidPublic) });
}

// Einschalten oder Uhrzeit ändern.
export async function einschalten(api, uhrzeit) {
  if (api.demo) {
    if ('Notification' in window) await Notification.requestPermission();
    await api.erinnerungSpeichern({ endpoint: 'demo', keys: {} }, uhrzeit);
  } else {
    const vapid = window.LICHTBLICK_CONFIG?.vapidPublic;
    if (!vapid) throw new Error('Erinnerungen sind noch nicht eingerichtet (vapidPublic in config.js fehlt).');
    const abo = await abonnieren(vapid);
    await api.erinnerungSpeichern(abo.toJSON(), uhrzeit);
  }
  merke({ uhrzeit });
}

export async function ausschalten(api) {
  merke(null);
  if (api.demo) { await api.erinnerungLoeschen('demo'); return; }
  const abo = await aktuellesAbo();
  if (abo) {
    await api.erinnerungLoeschen(abo.endpoint);
    await abo.unsubscribe();
  }
}

// Beim Start: War die Erinnerung an, Abo still erneuern (Push-Dienste tauschen
// die Adresse gelegentlich aus). Fragt nie nach, wenn die Erlaubnis fehlt.
export async function abgleichen(api) {
  const m = gemerkt();
  if (!m || api.demo || pushStatus() !== 'bereit' || Notification.permission !== 'granted') return;
  const vapid = window.LICHTBLICK_CONFIG?.vapidPublic;
  if (!vapid) return;
  try {
    const reg = await registrierung();
    const abo = (await reg.pushManager.getSubscription())
      || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: schluesselBytes(vapid) });
    await api.erinnerungSpeichern(abo.toJSON(), m.uhrzeit);
  } catch { /* beim nächsten Start wieder */ }
}

export async function testMitteilung(partnerName) {
  if (!('Notification' in window)) throw new Error('Dieses Gerät kann keine Mitteilungen anzeigen.');
  if ((await Notification.requestPermission()) !== 'granted') {
    throw new Error('Mitteilungen sind nicht erlaubt.');
  }
  const reg = await registrierung();
  await reg.showNotification(partnerName ? `${partnerName} hat schon geschrieben` : 'Lichtblick', {
    body: partnerName ? 'Was war dein Lichtblick heute?' : 'Was war heute das Beste?',
    icon: 'icons/icon-192.png',
    tag: 'lichtblick-test',
    data: { url: './' },
  });
}

// Beim Abmelden: Gerät abmelden, damit keine Erinnerungen mehr für das alte Konto kommen.
export async function vorAbmelden(api) {
  try { await ausschalten(api); } catch { /* egal */ }
}
