// Lichtblick – Verbindung zu Supabase.
// Beide Werte stehen im Supabase-Dashboard oben bei der Projektadresse unter „Copy“.
// Der Publishable key darf öffentlich sein: Die Zugriffsregeln in
// supabase/schema.sql sorgen dafür, dass jede Person nur ihre eigenen Daten sieht.
// Bleiben die Felder leer, startet die App im Demo-Modus.
window.LICHTBLICK_CONFIG = {
  url: 'https://zrkhhzdamuadgpzxurep.supabase.co',
  key: 'sb_publishable_X2c_LCBzwMOLByh6pr9UEw_28WgDfr8',   // Publishable key
  // Öffentlicher VAPID-Schlüssel für die Erinnerung (aus tools/vapid-erzeugen.mjs).
  // Der private Teil gehört NUR in die Supabase-Secrets, nie hierher.
  vapidPublic: 'BGY0_pxo-GJJRwZ9WNd18Ppfkqrz2dHO5JDb_SXA1KCtkSiOr839fA6jgXRTmzRXgW46YheZoWpa7l9eHkO404k',
};
