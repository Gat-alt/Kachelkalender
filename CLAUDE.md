# Regeln für dieses Projekt (Kachelkalender und Da far)

## Datenschutz zuerst – das ist der Besitzerin sehr wichtig

- **Keine Google-Dienste.** Kein Google-Konto, keine Google-Spracherkennung, kein Firebase, keine Play Services, kein ML Kit, keine Google-Schriften oder -Skripte.
- **Nichts verlässt das Handy ohne ausdrückliche Rückfrage.** Aufgaben, Termine und Stimme bleiben auf dem Gerät. Bevor eine Änderung Daten an einen Server schicken könnte (auch „nur“ Sprache, Statistiken oder Absturzberichte), zuerst fragen und klar sagen, wohin die Daten gehen.
- **Keine Tracker, keine Werbung, keine Analysedienste.**
- **Spracheingabe nur offline:** In Da far ausschliesslich Erkennungs-Apps aus der Liste `erlaubt` in `scripts/dafar-android.mjs` (FUTO Voice Input, Transcribro) mit fester App (`setPackage`) aufrufen, sonst die eingebaute Whisper-Erkennung. Nie `SpeechRecognizer` oder einen `RECOGNIZE_SPEECH`-Aufruf ohne feste App: Der landet meist bei Google.
- **Keine Klientennamen ins öffentliche GitHub-Projekt** (keine echten Aufgaben als Testdaten).
- Im Zweifel: lieber eine schwächere Lösung, die auf dem Gerät bleibt, und die Besitzerin fragen.

## Automatische Sperre

`scripts/datenschutz-dafar.mjs` bricht den Bau von Da far ab, wenn Google-Dienste, Tracker oder eine Spracherkennung ohne feste App auftauchen. Diese Prüfung nicht abschwächen oder umgehen. Wenn sie anschlägt: die Änderung ändern, nicht die Prüfung.

## Arbeitsweise

- Die Besitzerin ist keine Programmiererin und nutzt die Apps auf dem Handy (Android, Installation über Obtainium oder APK-Link). Antworten auf Deutsch (Schweizer Schreibweise, „ss“ statt „ß“), kurz und ohne Fachjargon.
- Da far liegt im Branch `dafar`. Ein neues Release entsteht, wenn die Version in `dafar/src-tauri/tauri.conf.json` steigt.
