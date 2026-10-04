// Fügt die Signatur-Einstellungen in das von Tauri erzeugte Android-Projekt ein.
import fs from "node:fs";
const f = "src-tauri/gen/android/app/build.gradle.kts";
let s = fs.readFileSync(f, "utf8");
if (!s.includes("import java.io.FileInputStream")) s = "import java.io.FileInputStream\n" + s;
if (!s.includes("import java.util.Properties")) s = "import java.util.Properties\n" + s;
if (!s.includes('signingConfigs')) {
  s = s.replace(/(\n\s*)buildTypes \{/, `$1signingConfigs {
        create("release") {
            val p = Properties()
            p.load(FileInputStream(rootProject.file("keystore.properties")))
            keyAlias = p["keyAlias"] as String
            keyPassword = p["password"] as String
            storeFile = file(p["storeFile"] as String)
            storePassword = p["password"] as String
        }
    }$1buildTypes {`);
  s = s.replace(/getByName\("release"\) \{/, 'getByName("release") {\n            signingConfig = signingConfigs.getByName("release")');
}
if (!s.includes('signingConfigs.getByName("release")')) throw new Error("Signatur konnte nicht eingefügt werden");
fs.writeFileSync(f, s);
console.log("Signatur eingetragen");
