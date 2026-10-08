// Prüft die App-Schicht (Erinnerungen, Widget) mit nachgebauter Handy-Umgebung.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let failed = 0, passed = 0;
const check = (n, c, i = "") => { if (c) { passed++; console.log("  ✓ " + n); } else { failed++; console.log("  ✗ " + n + (i ? "  → " + i : "")); } };
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 412, height: 915 }, userAgent: "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/141 Mobile Safari/537.36", timezoneId: "Europe/Zurich" });
const pg = await ctx.newPage(); const errs = []; pg.on("pageerror", e => errs.push(String(e)));
await pg.clock.install({ time: new Date("2026-10-08T09:00:00+02:00") });
await pg.addInitScript(() => {
  window._sent = []; window._inv = [];
  window.__TAURI__ = { notification: { isPermissionGranted: async () => true, requestPermission: async () => "granted", cancelAll: async () => {}, sendNotification: o => window._sent.push(o) },
    core: { invoke: async (c, a) => { window._inv.push([c, a]); } }, http: { fetch: (...a) => fetch(...a) } };
  localStorage.setItem("kachelkalender-proto-v1-view", "grid");
});
console.log("App-Schicht (Handy)");
await pg.goto("file://" + path.join(root, "dist/index.html"));
await pg.waitForTimeout(1500);
// Termin mit zwei Erinnerungen in 2 Tagen + ganztägiger Termin morgen
await pg.evaluate(() => { const S = window.__KK_S || null; });
await pg.evaluate(() => {
  const k = JSON.parse(localStorage.getItem("kachelkalender-proto-v1"));
  k.ev.push({ id: "t1", cal: "privat", title: "Prüfung Statistik", date: "2026-10-10", start: "09:00", end: "11:00", allDay: false, loc: "TB 610", remind: 60, remind2: 1440 });
  k.ev.push({ id: "t2", cal: "privat", title: "Geburtstag Mia", date: "2026-10-09", allDay: true, start: "", end: "", remind: 15 });
  localStorage.setItem("kachelkalender-proto-v1", JSON.stringify(k));
});
await pg.reload(); await pg.waitForTimeout(2000);
const sent = await pg.evaluate(() => window._sent.map(o => ({ t: o.title, b: o.body, at: o.schedule && new Date(o.schedule.at.date).toISOString() })));
const p = sent.filter(x => x.t === "Prüfung Statistik");
check("Zwei Erinnerungen geplant (1 Tag und 1 Std. vorher)", p.length === 2 && p.some(x => x.at === "2026-10-09T07:00:00.000Z") && p.some(x => x.at === "2026-10-10T06:00:00.000Z"), JSON.stringify(p));
check("Text der Erinnerung sagt, wann es losgeht", p.some(x => x.b.startsWith("Morgen")) && p.some(x => x.b.startsWith("In 1 Std.")), JSON.stringify(p.map(x => x.b)));
const g = sent.filter(x => x.t === "Geburtstag Mia");
check("Ganztägiger Termin: Erinnerung um 08:00", g.length === 1 && g[0].at === "2026-10-09T06:00:00.000Z", JSON.stringify(g));
const w = await pg.evaluate(() => window._inv.filter(x => x[0] === "widget_data").map(x => JSON.parse(x[1].json)).pop());
check("Widget bekommt die nächsten Termine", Array.isArray(w) && w.length === 2 && w[0].day === "Morgen" && w[1].day === "Sa, 10. Okt.", w && JSON.stringify(w.slice(0, 2)));
check("Widget: sortiert und mit Farbe", w && w.every((x, i) => i === 0 || x.ds >= w[i - 1].ds) && w.every(x => /^#/.test(x.color)));
check("keine JS-Fehler", !errs.length, errs.join(" | "));
await b.close();
console.log(`\n${passed} bestanden, ${failed} fehlgeschlagen`);
process.exit(failed ? 1 : 0);
