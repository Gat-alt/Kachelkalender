// Baut die Spracheingabe von Android in «Da far» ein (läuft im Workflow nach «tauri android init»).
// Die App ruft über window.DafarVoice die Spracherkennung des Handys auf – dieselbe, die auch andere
// Apps und die Tastatur nutzen. Sie versteht Deutsch viel besser als das kleine Whisper-Modell.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const app = path.join(root, "dafar/src-tauri/gen/android/app/src/main");
const ma = path.join(app, "java/ch/kachelkalender/dafar/MainActivity.kt");
if (!fs.existsSync(ma)) throw new Error("MainActivity nicht gefunden: " + ma);

// Manifest: Spracherkennung auf dem Handy finden dürfen (Android 11+)
const mf = path.join(app, "AndroidManifest.xml");
let m = fs.readFileSync(mf, "utf8");
if (!m.includes("android.speech.RecognitionService")) {
  m = m.replace("<application", `<queries>
        <intent><action android:name="android.speech.RecognitionService" /></intent>
        <intent><action android:name="android.speech.action.RECOGNIZE_SPEECH" /></intent>
    </queries>
    <application`);
  fs.writeFileSync(mf, m);
}

const hook = `
  private var dafarWebView: android.webkit.WebView? = null

  private val dafarSpeech = registerForActivityResult(
    androidx.activity.result.contract.ActivityResultContracts.StartActivityForResult()
  ) { r ->
    val list = r.data?.getStringArrayListExtra(android.speech.RecognizerIntent.EXTRA_RESULTS)
    val text = if (r.resultCode == android.app.Activity.RESULT_OK && !list.isNullOrEmpty()) list[0] else ""
    dafarSend(text, "")
  }

  private fun dafarSend(text: String, err: String) {
    val js = "window.dafarVoiceResult && window.dafarVoiceResult(" +
      org.json.JSONObject.quote(text) + "," + org.json.JSONObject.quote(err) + ")"
    runOnUiThread { dafarWebView?.evaluateJavascript(js, null) }
  }

  override fun onWebViewCreate(webView: android.webkit.WebView) {
    super.onWebViewCreate(webView)
    dafarWebView = webView
    webView.addJavascriptInterface(DafarVoice(), "DafarVoice")
  }

  inner class DafarVoice {
    @android.webkit.JavascriptInterface
    fun available(): Boolean {
      val i = android.content.Intent(android.speech.RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
      return i.resolveActivity(packageManager) != null ||
        android.speech.SpeechRecognizer.isRecognitionAvailable(this@MainActivity)
    }

    @android.webkit.JavascriptInterface
    fun start() {
      runOnUiThread {
        val loc = java.util.Locale.getDefault()
        val lang = if (loc.language == "de") loc.toLanguageTag() else "de-DE"
        val i = android.content.Intent(android.speech.RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
          putExtra(android.speech.RecognizerIntent.EXTRA_LANGUAGE_MODEL, android.speech.RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
          putExtra(android.speech.RecognizerIntent.EXTRA_LANGUAGE, lang)
          putExtra(android.speech.RecognizerIntent.EXTRA_PROMPT, "Aufgabe sagen …")
          putExtra(android.speech.RecognizerIntent.EXTRA_MAX_RESULTS, 1)
        }
        try { dafarSpeech.launch(i) }
        catch (e: android.content.ActivityNotFoundException) { dafarSend("", "missing") }
        catch (e: Exception) { dafarSend("", "busy") }
      }
    }
  }
`;

let a = fs.readFileSync(ma, "utf8");
if (!a.includes("DafarVoice")) {
  if (/class MainActivity\s*:\s*TauriActivity\(\)\s*\{/.test(a)) a = a.replace(/(class MainActivity\s*:\s*TauriActivity\(\)\s*\{)/, `$1${hook}`);
  else a = a.replace(/class MainActivity\s*:\s*TauriActivity\(\)/, `class MainActivity : TauriActivity() {${hook}}`);
  if (!a.includes("DafarVoice")) throw new Error("Spracheingabe konnte nicht eingebaut werden");
  fs.writeFileSync(ma, a);
}
console.log("Spracheingabe eingebaut:\n" + a);
