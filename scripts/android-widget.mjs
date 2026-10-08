// Baut das Startbildschirm-Widget in das (beim Bauen erzeugte) Android-Projekt ein.
// Läuft im Workflow nach «tauri android init».
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = path.join(root, "android/widget");
const app = path.join(root, "src-tauri/gen/android/app/src/main");
const pkgDir = path.join(app, "java/ch/kachelkalender/app");
if (!fs.existsSync(pkgDir)) throw new Error("Android-Projekt nicht gefunden: " + pkgDir);

// Kotlin-Datei und Ressourcen kopieren
fs.copyFileSync(path.join(src, "KachelWidget.kt"), path.join(pkgDir, "KachelWidget.kt"));
const copyDir = (a, b) => { fs.mkdirSync(b, { recursive: true }); for (const f of fs.readdirSync(a)) { const s = path.join(a, f), d = path.join(b, f); fs.statSync(s).isDirectory() ? copyDir(s, d) : fs.copyFileSync(s, d); } };
copyDir(path.join(src, "res"), path.join(app, "res"));

// Im Manifest anmelden
const mf = path.join(app, "AndroidManifest.xml");
let m = fs.readFileSync(mf, "utf8");
if (!m.includes("KachelWidget")) {
  m = m.replace("</application>", `    <receiver android:name="ch.kachelkalender.app.KachelWidget" android:exported="false" android:label="Kachelkalender">
            <intent-filter><action android:name="android.appwidget.action.APPWIDGET_UPDATE" /></intent-filter>
            <meta-data android:name="android.appwidget.provider" android:resource="@xml/kachel_widget_info" />
        </receiver>
    </application>`);
  fs.writeFileSync(mf, m);
}

// Widget aktualisieren, sobald die App in den Hintergrund geht (dann sind die neuesten Termine gespeichert)
const ma = path.join(pkgDir, "MainActivity.kt");
let a = fs.readFileSync(ma, "utf8");
if (!a.includes("KachelWidget.refresh")) {
  const hook = `\n  override fun onPause() {\n    super.onPause()\n    KachelWidget.refresh(this)\n  }\n`;
  if (/class MainActivity\s*:\s*TauriActivity\(\)\s*\{/.test(a)) a = a.replace(/(class MainActivity\s*:\s*TauriActivity\(\)\s*\{)/, `$1${hook}`);
  else a = a.replace(/class MainActivity\s*:\s*TauriActivity\(\)/, `class MainActivity : TauriActivity() {${hook}}`);
  fs.writeFileSync(ma, a);
}
console.log("Widget eingebaut:\n" + fs.readFileSync(ma, "utf8"));
