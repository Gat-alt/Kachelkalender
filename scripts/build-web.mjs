// Baut die Oberfläche für die App: Kalender-UI + App-Schicht + lokale Schriften (keine Google-Server).
import fs from "node:fs";
import path from "node:path";
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const dist = path.join(root, "dist");
fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(path.join(dist, "fonts"), { recursive: true });

let ui = fs.readFileSync(path.join(root, "ui/kalender.html"), "utf8");
ui = ui.replace(/<link rel="preconnect"[^>]*>\s*/g, "").replace(/<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com[^>]*>/g, '<link rel="stylesheet" href="fonts/fonts.css">');
if (/fonts\.googleapis|fonts\.gstatic/.test(ui)) throw new Error("Externe Schrift-Links gefunden");

const fonts = [
  ["@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-latin-opsz-normal.woff2", "bricolage-latin.woff2"],
  ["@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-latin-ext-opsz-normal.woff2", "bricolage-latin-ext.woff2"],
];
for (const w of [400, 500, 600, 700]) for (const s of ["latin", "latin-ext"])
  fonts.push([`@fontsource/instrument-sans/files/instrument-sans-${s}-${w}-normal.woff2`, `instrument-${s}-${w}.woff2`]);
for (const [src, dst] of fonts) fs.copyFileSync(path.join(root, "node_modules", src), path.join(dist, "fonts", dst));
const LATIN = "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD";
const EXT = "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF";
let css = "";
for (const [s, r] of [["latin", LATIN], ["latin-ext", EXT]]) {
  css += `@font-face{font-family:"Bricolage Grotesque";font-style:normal;font-display:swap;font-weight:200 800;src:url(bricolage-${s}.woff2) format("woff2");unicode-range:${r}}\n`;
  for (const w of [400, 500, 600, 700]) css += `@font-face{font-family:"Instrument Sans";font-style:normal;font-display:swap;font-weight:${w};src:url(instrument-${s}-${w}.woff2) format("woff2");unicode-range:${r}}\n`;
}
fs.writeFileSync(path.join(dist, "fonts/fonts.css"), css);
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
