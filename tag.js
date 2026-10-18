// Lichtblick – Datumshilfen. Ein Tag beginnt um 4:00 Uhr (wie heute() in schema.sql),
// damit ein Eintrag kurz nach Mitternacht noch zum Vortag zählt.

const TAGESBEGINN_STUNDE = 4;

function iso(d) {
  const j = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const t = String(d.getDate()).padStart(2, '0');
  return `${j}-${m}-${t}`;
}

export function heute(jetzt = new Date()) {
  return iso(new Date(jetzt.getTime() - TAGESBEGINN_STUNDE * 3600 * 1000));
}

export function gestern(jetzt = new Date()) {
  const d = new Date(heute(jetzt) + 'T12:00:00');
  d.setDate(d.getDate() - 1);
  return iso(d);
}

const WOCHENTAG = new Intl.DateTimeFormat('de-DE', { weekday: 'long' });
const LANG = new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'long' });
const MONAT = new Intl.DateTimeFormat('de-DE', { month: 'long', year: 'numeric' });

export function tagText(tag) {
  if (tag === heute()) return 'Heute';
  if (tag === gestern()) return 'Gestern';
  const d = new Date(tag + 'T12:00:00');
  return `${WOCHENTAG.format(d)}, ${LANG.format(d)}`;
}

export function monatText(tag) {
  return MONAT.format(new Date(tag + 'T12:00:00'));
}

// Wie viele Tage am Stück (bis heute oder gestern) die Person geschrieben hat.
export function serie(tage) {
  const menge = new Set(tage);
  const d = new Date(heute() + 'T12:00:00');
  if (!menge.has(iso(d))) d.setDate(d.getDate() - 1);
  let n = 0;
  while (menge.has(iso(d))) { n++; d.setDate(d.getDate() - 1); }
  return n;
}
