"""ErstDu – App-Icon: zwei Lichter (Apricot und Salbei), die sich berühren; an der Berührung ein Funke.

Nach Thomas' Midjourney-Vorlage vom 18.10.2026, ohne Schatten und Rand (iOS rundet selbst ab).
Aufruf: python3 tools/icon-erzeugen.py  → icons/icon-180.png, icon-192.png, icon-512.png
Die Vektor-Fassung für den Browser-Tab steht in icons/icon.svg (gleiche Maße und Farben).
"""
from pathlib import Path

import numpy as np
from PIL import Image

N = 1024  # Arbeitsgröße, danach verkleinert (Kantenglättung)
ZIEL = Path(__file__).resolve().parent.parent / 'icons'


def farbe(hexwert):
    h = hexwert.lstrip('#')
    return np.array([int(h[i:i + 2], 16) for i in (0, 2, 4)], dtype=float) / 255


def mische(a, b, t):
    t = np.clip(t, 0, 1)[..., None]
    return a * (1 - t) + b * t


y, x = np.mgrid[0:N, 0:N] / N

# Hintergrund: Salbei mit warmem Lichtschein in der Mitte
bild = np.broadcast_to(farbe('#9aab94'), (N, N, 3)).copy()
d_glanz = np.hypot(x - 0.48, y - 0.46)
bild = mische(bild, farbe('#f3dcae'), (1 - d_glanz / 0.46) ** 2 * 0.9)

# Kreis A: Apricot, oben links, mit hellem Kern
ax, ay, r = 0.40, 0.40, 0.29
da = np.hypot(x - ax, y - ay)
in_a = da <= r
kern_a = np.hypot(x - 0.45, y - 0.44) / (r * 1.25)
apricot = mische(farbe('#ffe2a8'), farbe('#e0884c'), kern_a * 1.7)
apricot = mische(apricot, farbe('#86391c'), (kern_a - 0.42) * 1.7)

# Kreis B: Salbeigrün, unten rechts, Licht von oben links
bx, by = 0.60, 0.60
db = np.hypot(x - bx, y - by)
in_b = db <= r
licht_b = ((x - bx) + (y - by)) / (2 * r) + 0.5
salbei = mische(farbe('#a9c9b5'), farbe('#58756a'), licht_b * 1.1)
salbei = mische(salbei, farbe('#26392e'), (licht_b - 0.5) * 1.7)

# Weiche Kanten (1,5 px bei Arbeitsgröße)
kante = 1.5 / N
alpha_a = np.clip((r - da) / kante + 0.5, 0, 1)
alpha_b = np.clip((r - db) / kante + 0.5, 0, 1)
bild = mische(bild, apricot, alpha_a)
bild = mische(bild, salbei, alpha_b * (1 - alpha_a * 0.0))

# Überschneidung: warmes Bernstein statt Schwarz, mit Funke in der Mitte
beide = alpha_a * alpha_b
uebergang = mische(apricot * 0.5 + salbei * 0.5, farbe('#3d2616'), 0.72)
bild = mische(bild, uebergang, beide)
d_funke = np.hypot(x - 0.5, y - 0.5)
funke = np.clip(1 - d_funke / 0.13, 0, 1) ** 2.6
bild = mische(bild, farbe('#ffe9b8'), funke * 0.95)

rgb = (np.clip(bild, 0, 1) * 255).round().astype(np.uint8)
gross = Image.fromarray(rgb)
for groesse in (180, 192, 512):
    gross.resize((groesse, groesse), Image.LANCZOS).save(ZIEL / f'icon-{groesse}.png', optimize=True)
print('Icons geschrieben nach', ZIEL)
