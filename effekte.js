// ErstDu – die zwei großen Momente als Animation.
//   losschicken():       Beim Teilen wird dein Moment zu einem Licht und fliegt in deinen Tagesring.
//   enthuellen():        Wenn beide geteilt haben: eure zwei Lichter finden sich (Funke wie im Icon),
//                        dann schmilzt der Schleier über dem Moment der anderen Person.
// Antippen überspringt. Mit „Bewegung reduzieren“ (iOS) laufen keine Effekte.

const SANFT = 'cubic-bezier(.22,.8,.24,1)';
const laufend = new Set();   // alle Animationen eines Effekts – fürs Überspringen

export const ruhig = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

function anim(el, frames, opts) {
  const a = el.animate(frames, opts);
  laufend.add(a);
  a.finished.catch(() => {}).finally(() => laufend.delete(a));
  return a;
}

// Pause, die sich beim Überspringen sofort auflöst (setTimeout ließe sich nicht vorspulen)
const pause = ms => anim(document.documentElement, [{}, {}], { duration: ms }).finished.catch(() => {});

function ueberspringen() {
  for (const a of [...laufend]) { try { a.finish(); } catch { /* unendliche gibt es nicht */ } }
}

function ebene(klasse) {
  const e = document.createElement('div');
  e.className = 'fx-ebene ' + klasse;
  e.addEventListener('click', ueberspringen);
  document.body.appendChild(e);
  return e;
}

const mitte = el => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };

// 1 · Licht losschicken -----------------------------------------------------------------------

export async function losschicken(karte, ring) {
  if (ruhig() || !karte || !ring) return;
  const e = ebene('');
  const von = mitte(karte), nach = mitte(ring);
  anim(karte, [{ transform: 'none', opacity: 1, filter: 'brightness(1)' },
               { transform: 'scale(.35)', opacity: 0, filter: 'brightness(1.6)', borderRadius: '50%' }],
       { duration: 520, easing: 'cubic-bezier(.6,0,.8,.4)', fill: 'forwards' });
  const licht = document.createElement('div');
  licht.className = 'fx-licht fx-apricot';
  e.appendChild(licht);
  // Bogen (quadratische Bézierkurve) nach oben links ausholend in den Ring
  const kx = (von.x + nach.x) / 2 - 80, ky = Math.min(von.y, nach.y) - 70;
  const flug = [];
  for (let i = 0; i <= 24; i++) {
    const p = i / 24, q = 1 - p;
    const x = q * q * von.x + 2 * q * p * kx + p * p * nach.x;
    const y = q * q * von.y + 2 * q * p * ky + p * p * nach.y;
    const s = p < .15 ? .3 + p / .15 * 1.3 : 1.6 - p * .9;
    flug.push({ transform: `translate(${x}px, ${y}px) scale(${s})`, opacity: p < .05 ? 0 : 1 });
  }
  await pause(380);
  await anim(licht, flug, { duration: 1100, easing: 'cubic-bezier(.45,.05,.3,1)', fill: 'forwards' }).finished.catch(() => {});
  e.remove();
}

// Nach dem Neuzeichnen: der frisch gefüllte Ring leuchtet kurz auf
export function ringWelle(ring) {
  if (ruhig() || !ring) return;
  const e = ebene('fx-durchsichtig');
  const m = mitte(ring);
  for (const [klasse, von, bis] of [['fx-welle', 1, 2.6], ['fx-licht fx-apricot', .9, 1.8]]) {
    const w = document.createElement('div');
    w.className = klasse;
    e.appendChild(w);
    anim(w, [{ transform: `translate(${m.x}px, ${m.y}px) scale(${von})`, opacity: .9 },
             { transform: `translate(${m.x}px, ${m.y}px) scale(${bis})`, opacity: 0 }],
         { duration: 800, easing: SANFT, fill: 'forwards' });
  }
  anim(ring, [{ transform: 'scale(1)' }, { transform: 'scale(1.18)', offset: .35 }, { transform: 'scale(1)' }], { duration: 700, easing: SANFT });
  pause(900).then(() => e.remove());
}

// 3 + 2 · Enthüllen --------------------------------------------------------------------------

// Sofort (synchron) aufrufen, sobald die Karte im DOM steht – sonst blitzt sie kurz unverschleiert auf.
export function enthuellen(karte, name) {
  if (ruhig() || !karte) return Promise.resolve();
  const schleier = verschleiern(karte, name);
  return (async () => {
    await pause(800);   // erst ankommen lassen (Ring-Welle nach dem Teilen, Seitenaufbau beim Öffnen)
    karte.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await lichterFinden(karte);
    await schleier();
  })();
}

async function lichterFinden(karte) {
  const e = ebene('fx-dunkel');
  anim(e, [{ backgroundColor: 'rgba(42,38,32,0)' }, { backgroundColor: 'rgba(42,38,32,.68)' }], { duration: 400, fill: 'forwards' });
  // Scrollen zur Karte zu Ende kommen lassen (scrollend fehlt in älteren Safaris → höchstens 700 ms)
  await Promise.race([new Promise(r => addEventListener('scrollend', r, { once: true })), pause(700)]);
  await pause(100);
  // Der Funke zündet dort, wo sich danach der Schleier öffnet (42 % der Kartenhöhe)
  const k = karte.getBoundingClientRect();
  const b = innerWidth, mx = k.left + k.width / 2;
  const my = Math.min(innerHeight * .75, Math.max(innerHeight * .25, k.top + k.height * .42));
  const [a, s] = ['fx-apricot', 'fx-salbei'].map(f => {
    const l = document.createElement('div');
    l.className = 'fx-licht fx-gross ' + f;
    e.appendChild(l);
    return l;
  });
  const weg = (x0, x1) => [{ transform: `translate(${x0}px, ${my}px) scale(.6)`, opacity: 0 }, { opacity: 1, offset: .25 },
                           { transform: `translate(${x1}px, ${my}px) scale(1)`, opacity: 1 }];
  const zu = { duration: 1500, easing: 'cubic-bezier(.3,.6,.25,1)', fill: 'forwards' };
  anim(a, weg(-60, mx - 28), zu);
  await anim(s, weg(b + 60, mx + 28), zu).finished.catch(() => {});

  const funke = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  funke.setAttribute('viewBox', '-50 -50 100 100');
  funke.setAttribute('class', 'fx-funke');
  funke.innerHTML = '<path d="M0-48 C4-10 10-4 48 0 C10 4 4 10 0 48 C-4 10-10 4-48 0 C-10-4-4-10 0-48Z" fill="#fffaf0"/><circle r="9" fill="#fff"/>';
  e.appendChild(funke);
  const ort = `translate(${mx}px, ${my}px)`;
  anim(funke, [{ transform: `${ort} scale(.2) rotate(-30deg)`, opacity: 0, easing: 'cubic-bezier(.2,.9,.3,1.25)' },
               { transform: `${ort} scale(1.2) rotate(0)`, opacity: 1, offset: .3, easing: 'ease-in' },
               { transform: `${ort} scale(.7) rotate(18deg)`, opacity: 0 }], { duration: 1200, fill: 'forwards' });
  for (const l of [a, s]) {
    const x = l === a ? mx - 28 : mx + 28;
    anim(l, [{ transform: `translate(${x}px, ${my}px) scale(1)`, opacity: 1 }, { transform: `translate(${x}px, ${my}px) scale(1.5)`, opacity: 1, offset: .3 },
             { transform: `translate(${mx}px, ${my}px) scale(2.4)`, opacity: 0 }], { duration: 1200, easing: SANFT, fill: 'forwards' });
  }
  for (let i = 0; i < 34; i++) {
    const d = document.createElement('div');
    d.className = 'fx-staub ' + (i % 2 ? 'fx-apricot' : 'fx-salbei');
    e.appendChild(d);
    const w = Math.random() * Math.PI * 2, r = 60 + Math.random() * 120;
    const zx = mx + Math.cos(w) * r, zy = my + Math.sin(w) * r;
    anim(d, [{ transform: `translate(${mx}px, ${my}px) scale(1.2)`, opacity: 1, easing: 'cubic-bezier(.1,.7,.3,1)' },
             { transform: `translate(${zx}px, ${zy}px) scale(1)`, opacity: 1, offset: .45, easing: 'ease-in' },
             { transform: `translate(${zx + Math.cos(w) * r * .1}px, ${zy - 70 - Math.random() * 70}px) scale(.3)`, opacity: 0 }],
         { duration: 1800 + Math.random() * 900, fill: 'forwards' });
  }
  await pause(900);
  // Die Abdunkelung geht, während der Schleier schon schmilzt
  anim(e, [{ backgroundColor: 'rgba(42,38,32,.68)' }, { backgroundColor: 'rgba(42,38,32,0)' }], { duration: 1100, fill: 'forwards' })
    .finished.catch(() => {}).finally(() => pause(1200).then(() => e.remove()));
}

function verschleiern(karte, name) {
  karte.classList.add('fx-verschleiert');
  const foto = karte.querySelector('.kartenfoto');
  const text = karte.querySelector('.eintragtext');
  const v = document.createElement('div');
  v.className = 'fx-schleier';
  v.innerHTML = `<b></b><span>Ihr habt beide geteilt.</span>`;
  v.querySelector('b').textContent = `${name} hat geteilt`;
  const kante = document.createElement('div');
  kante.className = 'fx-kante';
  karte.append(v, kante);
  const worte = text ? inWorte(text) : [];
  for (const w of worte) w.style.opacity = 0;
  if (foto) foto.style.filter = 'blur(18px) grayscale(1) brightness(1.1)';

  return async () => {
    await pause(250);
    const r = Math.hypot(karte.offsetWidth, karte.offsetHeight) / 2 + 30;
    const schmelzen = { duration: 2000, easing: 'cubic-bezier(.45,0,.25,1)', fill: 'forwards' };
    anim(v, [{ '--fx-r': '0px' }, { '--fx-r': `${r}px` }], schmelzen);
    anim(kante, [{ width: '0px', height: '0px', opacity: 0 }, { opacity: 1, offset: .12 }, { opacity: .85, offset: .75 },
                 { width: `${2 * r + 52}px`, height: `${2 * r + 52}px`, opacity: 0 }], schmelzen);
    if (foto) {
      anim(foto, [{ filter: 'blur(18px) grayscale(1) brightness(1.1)' }, { filter: 'blur(0) grayscale(0) brightness(1)' }],
           { duration: 1800, delay: 300, easing: SANFT, fill: 'forwards' });
      foto.style.filter = '';
    }
    await pause(1300);
    worte.forEach((w, i) => anim(w, [{ opacity: 0, transform: 'translateY(6px)', filter: 'blur(4px)' },
                                     { opacity: 1, transform: 'none', filter: 'blur(0)' }],
                                 { duration: 500, delay: i * 90, easing: SANFT, fill: 'forwards' }));
    await pause(700 + worte.length * 90 + 500);
    // Aufräumen: Karte ist danach wieder eine ganz normale Karte
    v.remove(); kante.remove();
    karte.classList.remove('fx-verschleiert');
    for (const a of [...karte.getAnimations({ subtree: true })]) a.cancel();
    for (const w of worte) w.style.opacity = '';
  };
}

// Text in Wort-Spans zerlegen, Leerraum (auch Zeilenumbrüche) bleibt als Text erhalten
function inWorte(el) {
  const teile = el.textContent.split(/(\s+)/);
  el.textContent = '';
  const worte = [];
  for (const t of teile) {
    if (!t) continue;
    if (/^\s+$/.test(t)) { el.append(t); continue; }
    const s = document.createElement('span');
    s.className = 'fx-wort';
    s.textContent = t;
    el.append(s);
    worte.push(s);
  }
  return worte;
}
