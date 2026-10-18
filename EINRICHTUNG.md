# Lichtblick – Einrichtung

Lichtblick ist eine eigene, frei gebaute Web-App nach der Idee von „Das Beste des Tages“
(gemeinsames Mini-Tagebuch für zwei). Sie enthält keinen Code, keine Texte und kein Design
aus dem Original.

## Was die App kann (Version 0.4)

- Anmelden per E-Mail-Code, ohne Passwort
- Ein Paar aus genau zwei Personen, Beitritt über einen 6-stelligen Code oder einen Einladungslink
- Jeden Tag eine Frage: „Was war heute das Beste?“ (bis 500 Zeichen)
- Den Eintrag der anderen Person sieht man erst nach dem eigenen. Ist der Tag vorbei, sind beide sichtbar.
- Gestern nachtragen, heute ändern
- Archiv mit Suche, Monaten und Serie („Tage am Stück“)
- Export als Text (Markdown) oder JSON
- Neue Einträge erscheinen live
- Ein Tag beginnt um 4:00 Uhr, damit ein Eintrag kurz nach Mitternacht noch zum Vortag zählt.
- **Neu in 0.2:** Erinnerung am Abend als Mitteilung (Uhrzeit 18:00–23:30 wählbar). Sie kommt nur, wenn man
  an dem Tag noch nichts geschrieben hat, und höchstens einmal. Hat die andere Person schon geschrieben,
  steht das in der Mitteilung („Sam hat schon geschrieben“).

- **Neu in 0.3:** Foto zum Lichtblick (wird vor dem Hochladen auf 1600 px verkleinert, Ortsdaten fallen weg),
  verdeckt wie der Text, bis man selbst geschrieben hat. Das zuletzt geteilte Foto ist der Hintergrund oben auf
  „Heute“ und auf „Wir“. Teilt die andere Person einen Lichtblick, kommt sofort eine Mitteilung (ohne den Text).
  Neues Design nach Midjourney-Vorlage: Creme, Salbeigrün, Apricot, Glas-Leiste, Wochenstreifen.

- **Neu in 0.4:** Willkommen-Seiten beim ersten Start („Liebe verbindet“ – ein Moment am Tag, abseits aller
  Messenger; erst teilen, dann sehen), jederzeit wieder unter **Wir → Worum es bei Lichtblick geht**.
  Nach dem ersten eigenen Lichtblick fragt die App einmal, ob sie abends um 21 Uhr erinnern soll
  (in Safari statt Home-Bildschirm: Hinweis, wie man sie dorthin legt).

## So funktioniert die Erinnerung
```
pg_cron (alle 15 min) ──► Edge Function „erinnern“ ──► Apples Push-Dienst ──► iPhone (sw.js zeigt Mitteilung)
                               │
                               └─ fragt faellige_erinnerungen() und merkt sich, wer heute schon erinnert wurde
```
Auf dem iPhone geht das nur, wenn Lichtblick auf dem Home-Bildschirm liegt (ab iOS 16.4).

## Einrichtung – Stand 18.10.2026

Supabase-Projekt `zrkhhzdamuadgpzxurep` (Region West EU/Irland). Per Connector von Claude erledigt:

- [x] Datenbank: Migrationen `lichtblick_schema`, `lichtblick_erinnerung`, `lichtblick_konfig_aus_vault`, `lichtblick_cron`
      (Inhalt = `supabase/schema.sql`, `erinnerung.sql`, `vault.sql`, `cron.sql`), dazu
      `lichtblick_fotos` (= `fotos.sql`: privater Bucket „fotos“, Regeln, Sofort-Mitteilung per Trigger)
      und `lichtblick_pg_net_schema` (pg_net ins Schema extensions)
- [x] Vault: Cron-Geheimnis (in der Datenbank erzeugt), VAPID-Schlüssel, VAPID-Kontakt
- [x] Edge Function `erinnern` (Verify JWT aus), liest ihre Schlüssel aus dem Vault – **keine Secrets nötig**
- [x] Cron-Job `lichtblick-erinnern` alle 15 Minuten; Probeaufruf → `{"faellig":0,"gesendet":0,...}`
- [x] `config.js`: Projektadresse und Publishable key
- [x] Sicherheitsberater: keine fehlenden Zugriffsregeln. Er warnt nur, dass angemeldete Nutzer
      SECURITY-DEFINER-Funktionen aufrufen dürfen – gewollt, das sind die App-Funktionen (Paar gründen usw.).

### Noch offen

**1. E-Mail mit Code statt Link** – ✅ erledigt am 18.10.2026
Supabase lässt Vorlagen nur mit eigenem SMTP-Server ändern. Eingerichtet: **Gmail-SMTP**
(`smtp.gmail.com`, Port 587, App-Passwort; Supabase-Hinweis „personal provider“ ist für zwei Personen unkritisch).
Vorlagen **Magic link or OTP** und **Confirm sign up** zeigen jetzt `{{ .Token }}` statt eines Links.
Code-Login lokal getestet: Konto bestätigt, Profil angelegt.
Für mehr Nutzer später auf einen Versanddienst (z. B. Brevo) umstellen – nur die SMTP-Felder ändern sich.

**2. Veröffentlichen (GitHub Pages)** – ✅ erledigt am 18.10.2026
Repo https://github.com/daddytomsen/lichtblick (öffentlich), Pages auf `main` / Root.
Live: **https://daddytomsen.github.io/lichtblick/** · Supabase **Site URL** zeigt auf diese Adresse.

**3. Aufs iPhone**
1. Adresse in **Safari** öffnen → **Teilen** → **Zum Home-Bildschirm**.
2. Lichtblick vom Home-Bildschirm starten, anmelden, Namen eingeben, **Neues Paar anlegen**.
3. Unter **Wir → Einladung teilen** den Link an deine Partnerin schicken. Sie öffnet ihn, legt
   Lichtblick ebenfalls auf den Home-Bildschirm und tritt mit dem Code bei.
4. Unter **Wir → Erinnerung** „Abends erinnern“ einschalten, Mitteilungen erlauben, Uhrzeit wählen.
   Mit **Test-Mitteilung zeigen** prüfen, ob Mitteilungen ankommen.

### Kontrolle der Erinnerung
Im SQL Editor:
```sql
select id, status_code, content::text, created from net._http_response order by id desc limit 5;
```

### Gut zu wissen
- Die alten Supabase-Schlüssel (anon/service_role) gelten nur bis Ende 2026. Lichtblick nutzt schon die neuen
  (`sb_publishable_…` in der App, `SUPABASE_SECRET_KEYS` in der Edge Function).
- Ohne Anmeldung liefert die Datenbank 401 statt leerer Listen – gewollt.

## Ausprobieren ohne Supabase
Ist `config.js` leer (oder steht `?demo` in der Adresse), läuft die App im Demo-Modus:
Code `123456`, Paarcode `K7M3QX` verbindet mit der erfundenen Person „Sam“. Alles bleibt im Browser.

## Updates
Dateien ändern → in `sw.js` die `VERSION` hochzählen (`lichtblick-v1` → `v2`) und in `app.js` die
`VERSION` anpassen → pushen. Am iPhone die App ganz schließen und zweimal starten.

## Dateien
| Datei | Inhalt |
|---|---|
| `index.html` | Gerüst und Gestaltung |
| `app.js` | Ansichten und Abläufe |
| `api.js` | Datenschicht: Supabase oder Demo |
| `tag.js` | Datum, Tagesgrenze 4 Uhr, Serie |
| `config.js` | Supabase-Adresse und -Schlüssel |
| `sw.js` | Offline-Speicher |
| `erinnerung.js` | Erinnerung: Erlaubnis, Push-Abo, Test-Mitteilung |
| `supabase/schema.sql` | Tabellen, Zugriffsregeln, Funktionen |
| `supabase/erinnerung.sql` | Push-Abos und Abfrage „wer ist dran“ |
| `supabase/functions/erinnern/index.ts` | Edge Function, verschickt die Mitteilungen |
| `foto.js` | Fotos verkleinern (Canvas, entfernt Metadaten) |
| `supabase/fotos.sql` | Foto-Speicher, Sichtbarkeit, Sofort-Mitteilung |
| `supabase/vault.sql` | Schlüssel im Vault, `erinnerung_konfig()` |
| `supabase/cron.sql` | Zeitplan alle 15 Minuten (ohne Geheimnis im Klartext) |
| `tools/vapid-erzeugen.mjs` | erzeugt neue Push-Schlüssel |
| `tools/test/` | Tests: `npm run db` (Datenbank in PGlite), `npm run fn` (Edge Function mit echtem web-push) |
