// Erzeugt ein VAPID-Schlüsselpaar (P-256) und ein Cron-Geheimnis für die Lichtblick-Erinnerung.
// Aufruf: node tools/vapid-erzeugen.mjs
// Ausgabe im Format, das web-push erwartet: öffentlich = unkomprimierter Punkt, privat = d (je base64url).
import { generateKeyPairSync, randomBytes } from 'node:crypto';

const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const pub = publicKey.export({ format: 'jwk' });
const priv = privateKey.export({ format: 'jwk' });

const b64u = buf => Buffer.from(buf).toString('base64url');
const punkt = Buffer.concat([Buffer.from([4]), Buffer.from(pub.x, 'base64url'), Buffer.from(pub.y, 'base64url')]);

console.log(JSON.stringify({
  VAPID_PUBLIC: b64u(punkt),
  VAPID_PRIVATE: priv.d,
  CRON_GEHEIMNIS: b64u(randomBytes(24)),
}, null, 2));
