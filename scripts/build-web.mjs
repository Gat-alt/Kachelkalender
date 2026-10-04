// Baut die Oberfläche für die App: Kalender-UI (Schriften eingebettet) + App-Schicht.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });

const ui = fs.readFileSync(path.join(root, "ui/kalender.html"), "utf8");
// Datenschutz-Prüfung: keine Verbindungen zu Google oder anderen fremden Servern im App-Code
if (/googleapis|gstatic|google-analytics|googletagmanager|https:\/\/[^"' ]*google/i.test(ui + fs.readFileSync(path.join(root, "ui/app.js"), "utf8")))
  throw new Error("Google-Verweis im App-Code gefunden – Bau abgebrochen");
fs.copyFileSync(path.join(root, "ui/app.js"), path.join(dist, "app.js"));

const html = `<!doctype html><html lang="de"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#0f1318">
<style>[hidden]{display:none!important}html,body{margin:0}</style>
<script src="app.js"></script>
</head><body>
${ui}
</body></html>`;
fs.writeFileSync(path.join(dist, "index.html"), html);
console.log("dist gebaut:", fs.readdirSync(dist).join(", "));
