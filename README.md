# Kachelkalender

Ein übersichtlicher, datenschutzfreundlicher Kalender für Handy (Android / iodéOS), Mac, Windows und Linux.

- **Ansichten:** Tag, Mo–Fr, Woche, Kacheln (Sa + So in einer Kachel), Monat (zeitgetreu), Wochennummern
- **Kalender:** CalDAV (Infomaniak, iCloud, Nextcloud, …) lesen und schreiben, Abo-Links (.ics) wie der ZHAW-Stundenplan, Kalender nur auf dem Gerät
- **Planung:** Aufgaben in den Kalender ziehen, Tagesplaner, Kalender-Sets, Erinnerungen
- **Datenschutz:** kein eigener Server, kein Tracking, keine Google-Schriften. Termine liegen auf deinen Geräten und bei deinen Kalender-Anbietern. Zugangsdaten bleiben in der App auf dem Gerät.

## Installieren
Unter **Releases** liegt jede Version:
- Handy: `Kachelkalender-v….apk` – am besten mit der App **Obtainium** (hält die App automatisch aktuell)
- Mac: `.dmg` · Windows: `.exe` · Linux: `.AppImage` oder `.deb`

## Neue Version
Eine neue Version entsteht, wenn ein Tag `v…` gesetzt wird (z. B. `v0.2.0`). GitHub baut dann automatisch alle Dateien.

## Aufbau
- `ui/kalender.html` – die Kalender-Oberfläche
- `ui/app.js` – Abgleich mit Kalendern, Erinnerungen
- `src-tauri/` – die App-Hülle (Tauri 2)
