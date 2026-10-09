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
for (const f of ["KachelWidget.kt", "KachelTasksWidget.kt", "KachelWeekWidget.kt"]) fs.copyFileSync(path.join(src, f), path.join(pkgDir, f));
const copyDir = (a, b) => { fs.mkdirSync(b, { recursive: true }); for (const f of fs.readdirSync(a)) { const s = path.join(a, f), d = path.join(b, f); fs.statSync(s).isDirectory() ? copyDir(s, d) : fs.copyFileSync(s, d); } };
copyDir(path.join(src, "res"), path.join(app, "res"));

// Im Manifest anmelden
const mf = path.join(app, "AndroidManifest.xml");
let m = fs.readFileSync(mf, "utf8");
if (!m.includes("KachelWidget")) {
  m = m.replace("</application>", `    <receiver android:name="ch.kachelkalender.app.KachelWeekWidget" android:exported="false" android:label="Kachelkalender · Woche">
            <intent-filter><action android:name="android.appwidget.action.APPWIDGET_UPDATE" /></intent-filter>
            <meta-data android:name="android.appwidget.provider" android:resource="@xml/kachel_week_widget_info" />
        </receiver>
        <receiver android:name="ch.kachelkalender.app.KachelWidget" android:exported="false" android:label="Kachelkalender · Termine">
            <intent-filter><action android:name="android.appwidget.action.APPWIDGET_UPDATE" /></intent-filter>
            <meta-data android:name="android.appwidget.provider" android:resource="@xml/kachel_widget_info" />
        </receiver>
        <receiver android:name="ch.kachelkalender.app.KachelTasksWidget" android:exported="false" android:label="Kachelkalender · Aufgaben">
            <intent-filter><action android:name="android.appwidget.action.APPWIDGET_UPDATE" /></intent-filter>
            <meta-data android:name="android.appwidget.provider" android:resource="@xml/kachel_tasks_widget_info" />
        </receiver>
    </application>`);
  fs.writeFileSync(mf, m);
}

// Widget aktualisieren, sobald die App in den Hintergrund geht (dann sind die neuesten Termine gespeichert)
const ma = path.join(pkgDir, "MainActivity.kt");
let a = fs.readFileSync(ma, "utf8");
if (!a.includes("KachelWidget.refresh")) {
  const hook = `
  override fun onPause() {
    super.onPause()
    KachelWidget.refresh(this)
    KachelTasksWidget.refresh(this)
    KachelWeekWidget.refresh(this)
  }

  override fun onResume() {
    KachelTasksWidget.handleIntent(this, intent)
    super.onResume()
  }

  override fun onNewIntent(intent: android.content.Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    KachelTasksWidget.handleIntent(this, intent)
  }
`;
  if (/class MainActivity\s*:\s*TauriActivity\(\)\s*\{/.test(a)) a = a.replace(/(class MainActivity\s*:\s*TauriActivity\(\)\s*\{)/, `$1${hook}`);
  else a = a.replace(/class MainActivity\s*:\s*TauriActivity\(\)/, `class MainActivity : TauriActivity() {${hook}}`);
  fs.writeFileSync(ma, a);
}
console.log("Widget eingebaut:\n" + fs.readFileSync(ma, "utf8"));
