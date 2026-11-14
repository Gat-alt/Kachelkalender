// Baut die Oberfläche von Da far: die Seite + die Spracheingabe (Whisper, läuft auf dem Gerät).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildSync } from "esbuild";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dafar/dist");
fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(path.join(dist, "ort"), { recursive: true });

const ui = fs.readFileSync(path.join(root, "dafar/ui/dafar.html"), "utf8");
// Datenschutz-Prüfung wie beim Kachelkalender: keine Verbindungen zu Google
if (/googleapis|gstatic|google-analytics|googletagmanager|https:\/\/[^"' ]*google/i.test(ui))
  throw new Error("Google-Verweis im App-Code gefunden – Bau abgebrochen");
fs.writeFileSync(path.join(dist, "index.html"), ui);

buildSync({ entryPoints: [path.join(root, "ui/whisper.js")], bundle: true, format: "esm", minify: true,
  outfile: path.join(dist, "whisper.mjs"), logLevel: "warning", platform: "browser", target: "es2020" });
const ortDir = path.join(root, "node_modules/onnxruntime-web/dist");
for (const f of fs.readdirSync(ortDir)) if (/^ort-wasm-simd-threaded(\.jsep)?\.(wasm|mjs)$/.test(f)) fs.copyFileSync(path.join(ortDir, f), path.join(dist, "ort", f));
console.log("Da far gebaut:", fs.readdirSync(dist).join(", "));
