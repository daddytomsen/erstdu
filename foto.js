// Lichtblick – Fotos vor dem Hochladen verkleinern.
// Das Neuzeichnen auf ein Canvas entfernt alle Metadaten (auch GPS-Ort und Aufnahmegerät).
// Die Drehung aus EXIF wenden Safari und Chrome beim Zeichnen eines <img> selbst an.

export async function verkleinere(datei, { max = 1600, qualitaet = 0.82 } = {}) {
  if (!datei || !/^image\//.test(datei.type || 'image/')) {
    throw new Error('Das ist kein Bild.');
  }
  const url = URL.createObjectURL(datei);
  try {
    const bild = await new Promise((ok, fehler) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = () => fehler(new Error('Das Foto ließ sich nicht öffnen.'));
      i.src = url;
    });
    const faktor = Math.min(1, max / Math.max(bild.naturalWidth, bild.naturalHeight));
    const b = Math.round(bild.naturalWidth * faktor);
    const h = Math.round(bild.naturalHeight * faktor);
    const canvas = document.createElement('canvas');
    canvas.width = b;
    canvas.height = h;
    canvas.getContext('2d').drawImage(bild, 0, 0, b, h);
    const blob = await new Promise(ok => canvas.toBlob(ok, 'image/jpeg', qualitaet));
    if (!blob) throw new Error('Das Foto ließ sich nicht umwandeln.');
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function alsDataUrl(blob) {
  return new Promise((ok, fehler) => {
    const r = new FileReader();
    r.onload = () => ok(r.result);
    r.onerror = () => fehler(r.error);
    r.readAsDataURL(blob);
  });
}
