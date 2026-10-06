# Kachelkalender

Ein übersichtlicher, datenschutzfreundlicher Kalender für Handy (Android / iodéOS), Mac, Windows und Linux.

- **Ansichten:** Tag, Mo–Fr, Woche, Kacheln (Sa + So in einer Kachel), Monat (zeitgetreu), Wochennummern
- **Kalender:** Microsoft 365 / Outlook (lesen und schreiben oder nur lesen, braucht die Client-ID und Freigabe der eigenen IT), CalDAV (Infomaniak, iCloud, Nextcloud, …) lesen und schreiben, Abo-Links (.ics) wie der ZHAW-Stundenplan, Kalender nur auf dem Gerät
- **Spracheingabe:** 🎤 antippen und sagen, z. B. «Morgen um drei Zahnarzt, eine Stunde». Whisper läuft auf dem Gerät; die Aufnahme verlässt es nie. Beim ersten Mal wird das Modell einmalig geladen (ca. 80 MB von Hugging Face).
- **Planung:** Aufgaben in den Kalender ziehen, Tagesplaner, Kalender-Sets, Erinnerungen
- **Datenschutz:** kein eigener Server, kein Tracking, nichts von Google (keine Google-Dienste, keine Google-Schriften; der Bau bricht ab, falls je ein Google-Verweis auftaucht). Termine liegen auf deinen Geräten und bei deinen Kalender-Anbietern. Zugangsdaten bleiben in der App auf dem Gerät.

## Installieren
Unter **Releases** liegt jede Version:
- Handy: `Kachelkalender-v….apk` – am besten mit der App **Obtainium** (hält die App automatisch aktuell)
- Mac: `.dmg` · Windows: `.exe` · Linux: `.AppImage` oder `.deb`

## Neue Version
Eine neue Version entsteht, wenn die Versionsnummer in `src-tauri/tauri.conf.json` erhöht wird (z. B. `0.2.0`). GitHub baut dann automatisch alle Dateien und legt sie unter Releases ab.

## Aufbau
- `ui/kalender.html` – die Kalender-Oberfläche
- `ui/app.js` – Abgleich mit Kalendern, Erinnerungen
- `src-tauri/` – die App-Hülle (Tauri 2)
