// Datenschutz-Sperre für «Da far»: bricht den Bau ab, sobald Code dazukommt, der Daten an Google
// (oder andere Clouddienste) schicken könnte. Aufruf:
//   node scripts/datenschutz-dafar.mjs            → prüft den Quellcode
//   node scripts/datenschutz-dafar.mjs --android  → prüft zusätzlich das fertige Android-Projekt
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fehler = [];
const walk = d => fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]) : [];
// Kommentare zählen nicht (sie dürfen erklären, dass Google NICHT verwendet wird)
const ohneKommentare = s => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1").replace(/<!--[\s\S]*?-->/g, "");

// Verboten im App-Code
const VERBOTEN = [
  [/google|gstatic|firebase|crashlytics|googletagmanager|doubleclick/i, "Google-/Firebase-Verweis"],
  [/\bSpeechRecognizer\b/, "SpeechRecognizer (nutzt die Standard-Erkennung des Handys, meist Google)"],
  [/sentry|bugsnag|mixpanel|amplitude|segment\.io|appcenter/i, "Tracking-/Analysedienst"],
];
const pruefe = (datei, text) => {
  const t = ohneKommentare(text);
  for (const [re, was] of VERBOTEN) { const m = t.match(re); if (m) fehler.push(`${path.relative(root, datei)}: ${was} („${m[0]}“)`); }
  // Spracherkennung darf nur mit fester, erlaubter App aufgerufen werden
  if (/RECOGNIZE_SPEECH/.test(t) && /\.launch\(|startActivity/.test(t) && !/setPackage\(/.test(t))
    fehler.push(`${path.relative(root, datei)}: Spracherkennung ohne feste App (könnte bei Google landen)`);
};

// 1. Quellcode
const quellen = [
  ...walk(path.join(root, "dafar/ui")),
  path.join(root, "ui/whisper.js"),
  ...walk(path.join(root, "dafar/src-tauri/src")),
  path.join(root, "dafar/src-tauri/Cargo.toml"),
];
for (const f of quellen) if (fs.existsSync(f)) pruefe(f, fs.readFileSync(f, "utf8"));

// Der Android-Baustein: nur der eingefügte Kotlin-Teil und die Liste erlaubter Erkennungs-Apps
{
  const f = path.join(root, "scripts/dafar-android.mjs"), s = fs.readFileSync(f, "utf8");
  const kotlin = (s.match(/const hook = `([\s\S]*?)`;/) || [])[1];
  if (!kotlin) fehler.push("scripts/dafar-android.mjs: Kotlin-Teil nicht gefunden");
  else {
    pruefe(f, kotlin);
    const liste = (kotlin.match(/erlaubt\s*=\s*listOf\(([^)]*)\)/) || [])[1];
    if (!liste) fehler.push("scripts/dafar-android.mjs: Liste erlaubter Spracherkennungen fehlt");
  }
}

// Netzwerk-Erlaubnis der Oberfläche (CSP): nur die App selbst und der einmalige Modell-Download
{
  const conf = JSON.parse(fs.readFileSync(path.join(root, "dafar/src-tauri/tauri.conf.json"), "utf8"));
  const connect = ((conf.app.security.csp || "").match(/connect-src([^;]*)/) || [, ""])[1].trim().split(/\s+/);
  const ok = /^(ipc:|http:\/\/ipc\.localhost|'self'|blob:|data:|https:\/\/huggingface\.co|https:\/\/\*\.huggingface\.co|https:\/\/\*\.hf\.co)$/;
  for (const c of connect) if (c && !ok.test(c)) fehler.push(`tauri.conf.json: neue Internet-Adresse erlaubt: ${c}`);
}

// 2. Fertiges Android-Projekt (nach «tauri android init» und dem Einbau der Spracheingabe)
if (process.argv.includes("--android")) {
  const gen = path.join(root, "dafar/src-tauri/gen/android");
  if (!fs.existsSync(gen)) fehler.push("Android-Projekt nicht gefunden");
  const app = path.join(gen, "app/src/main");
  // Unser eigener Android-Code (die Tauri-Dateien unter generated/ nennen das System-Webview „com.google.android.webview“ nur zur Versionsabfrage)
  for (const f of walk(path.join(app, "java"))) if (/\.(kt|java)$/.test(f) && !f.includes(`${path.sep}generated${path.sep}`)) pruefe(f, fs.readFileSync(f, "utf8"));
  const mf = path.join(app, "AndroidManifest.xml");
  if (fs.existsSync(mf)) {
    const m = ohneKommentare(fs.readFileSync(mf, "utf8"));
    if (/google|firebase|com\.android\.vending/i.test(m)) fehler.push("AndroidManifest.xml: Google-Eintrag");
    if (/ACCESS_FINE_LOCATION|ACCESS_COARSE_LOCATION|READ_CONTACTS|READ_CALENDAR|CAMERA|AD_ID/.test(m)) fehler.push("AndroidManifest.xml: unnötige Berechtigung");
  }
  // Bibliotheken: keine Google-Dienste (Play Services, Firebase, ML Kit). Erlaubt: AndroidX und Material (reine Oberfläche).
  for (const f of walk(gen)) if (/\.gradle(\.kts)?$/.test(f) || f.endsWith("libs.versions.toml")) {
    const t = fs.readFileSync(f, "utf8");
    const m = t.match(/com\.google\.(android\.gms|firebase|mlkit)|firebase|play-services|com\.google\.gms/i);
    if (m) fehler.push(`${path.relative(root, f)}: Google-Dienst als Bibliothek („${m[0]}“)`);
  }
}

if (fehler.length) {
  console.error("Datenschutz-Prüfung NICHT bestanden – Bau abgebrochen:\n  - " + fehler.join("\n  - "));
  process.exit(1);
}
console.log("Datenschutz-Prüfung bestanden: keine Google-Dienste, keine Tracker, Spracherkennung nur offline.");
