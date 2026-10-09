// Prüft die App-Schicht (Erinnerungen, Widget) mit nachgebauter Handy-Umgebung.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let failed = 0, passed = 0;
const check = (n, c, i = "") => { if (c) { passed++; console.log("  ✓ " + n); } else { failed++; console.log("  ✗ " + n + (i ? "  → " + i : "")); } };
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 412, height: 915 }, userAgent: "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/141 Mobile Safari/537.36", timezoneId: "Europe/Zurich" });
const pg = await ctx.newPage(); const errs = [];  pg.on("pageerror", e => errs.push(String(e)));
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
const w = await pg.evaluate(() => window._inv.filter(x => x[0] === "widget_data" && !x[1].name).map(x => JSON.parse(x[1].json)).pop());
check("Widget bekommt die nächsten Termine", Array.isArray(w) && w.length === 2 && w[0].day === "Morgen" && w[1].day === "Sa, 10. Okt.", w && JSON.stringify(w.slice(0, 2)));
const tw = await pg.evaluate(() => window._inv.filter(x => x[0] === "widget_data" && x[1].name === "tasks").map(x => JSON.parse(x[1].json)).pop());
check("Aufgaben-Widget bekommt die offenen Aufgaben", Array.isArray(tw), JSON.stringify(tw));
check("Widget: sortiert und mit Farbe", w && w.every((x, i) => i === 0 || x.ds >= w[i - 1].ds) && w.every(x => /^#/.test(x.color)));
check("keine JS-Fehler", !errs.length, errs.join(" | "));

// Todoist mit nachgebautem Server
console.log("Todoist");
const tdTasks = [
  { id: "101", content: "Bericht schreiben", checked: false, due: { date: "2026-10-09", is_recurring: false } },
  { id: "102", content: "Zahnarzt anrufen", checked: false, due: { date: "2026-10-08T14:00:00", is_recurring: false }, duration: { amount: 15, unit: "minute" } },
  { id: "103", content: "Ohne Datum", checked: false, due: null },
];
const calls = [];
await pg.route("https://api.todoist.com/**", async r => {
  const u = new URL(r.request().url()), m = r.request().method(), body = r.request().postData();
  calls.push([m, u.pathname, body ? JSON.parse(body) : null]);
  if (r.request().headers().authorization !== "Bearer 0123456789abcdef0123456789abcdef01234567") return r.fulfill({ status: 401, body: "" });
  if (m === "GET" && u.pathname === "/api/v1/tasks") return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ results: tdTasks.filter(t => !t.checked), next_cursor: null }) });
  if (m === "POST" && u.pathname === "/api/v1/tasks") { const b = JSON.parse(body), n = { id: "200", content: b.content, checked: false, due: b.due_date ? { date: b.due_date } : null }; tdTasks.push(n); return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(n) }); }
  const cl = /\/api\/v1\/tasks\/(\d+)\/close/.exec(u.pathname); if (cl) { tdTasks.find(t => t.id === cl[1]).checked = true; return r.fulfill({ status: 204, body: "" }); }
  if (/\/api\/v1\/tasks\/\d+$/.test(u.pathname)) return r.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  r.fulfill({ status: 404, body: "" });
});
let res = await pg.evaluate(async () => { try { await window.KK_todoist.connect("falsch"); return "ok"; } catch (e) { return e.message; } });
check("Falscher Schlüssel wird abgelehnt", res !== "ok", res);
res = await pg.evaluate(async () => { try { return await window.KK_todoist.connect("0123456789abcdef0123456789abcdef01234567"); } catch (e) { return e.message; } });
check("Verbinden holt die Todoist-Aufgaben", res === 3, String(res));
const tk = await pg.evaluate(() => JSON.parse(localStorage.getItem("kachelkalender-proto-v1")).tasks.filter(t => t.src === "todoist"));
const z = tk.find(t => t.tid === "102");
check("Aufgabe mit Uhrzeit ist im Kalender eingeplant", z && z.sDate === "2026-10-08" && z.sStart === "14:00" && z.sDur === 15, JSON.stringify(z));
check("Aufgabe ohne Datum", tk.find(t => t.tid === "103").nodue === true);
// Abhaken -> close
await pg.evaluate(() => { const cb = document.querySelector('[data-task="td101"]'); if (cb) { cb.checked = true; cb.dispatchEvent(new Event("change", { bubbles: true })); } });
await pg.waitForTimeout(2200);
check("Abhaken schliesst die Aufgabe in Todoist", calls.some(c => c[0] === "POST" && c[1] === "/api/v1/tasks/101/close"), JSON.stringify(calls.map(c => c[1])));
// neue Aufgabe -> in Todoist anlegen
await pg.evaluate(() => { document.getElementById("task-new").value = "Neu aus Kalender"; document.getElementById("task-form").requestSubmit(); });
await pg.waitForTimeout(2200);
const created = calls.find(c => c[0] === "POST" && c[1] === "/api/v1/tasks");
check("Neue Aufgabe wird in Todoist angelegt", created && created[2].content === "Neu aus Kalender", JSON.stringify(created));
const after = await pg.evaluate(() => JSON.parse(localStorage.getItem("kachelkalender-proto-v1")).tasks.filter(t => t.title === "Neu aus Kalender"));
check("…ohne Doppel", after.length === 1 && after[0].src === "todoist", JSON.stringify(after));
await pg.waitForTimeout(1200);
const tw2 = await pg.evaluate(() => window._inv.filter(x => x[0] === "widget_data" && x[1].name === "tasks").map(x => JSON.parse(x[1].json)).pop());
check("Aufgaben-Widget: Todoist-Aufgaben gruppiert", tw2 && tw2.some(t => t.todoist && t.group === "Ohne Datum") && tw2.some(t => t.title === "Zahnarzt anrufen" && t.meta === "14:00"), JSON.stringify(tw2));
// Einplanen -> Uhrzeit und Dauer in Todoist
await pg.click("#bb-tasks"); await pg.waitForTimeout(300);
await pg.click('#task-scrim [data-plan="td103"]'); await pg.waitForTimeout(200);
await pg.evaluate(() => { document.getElementById("pd-td103").value = "2026-10-12"; document.getElementById("pt-td103").value = "10:30"; document.querySelector('[data-planform="td103"]').requestSubmit(); });
await pg.waitForTimeout(2200);
const up = calls.find(c => c[1] === "/api/v1/tasks/103");
check("Einplanen setzt Uhrzeit und Dauer in Todoist", up && up[2].due_datetime === "2026-10-12T08:30:00Z" && up[2].duration_unit === "minute", JSON.stringify(up));
check("keine JS-Fehler", !errs.length, errs.join(" | "));
await b.close();
console.log(`\n${passed} bestanden, ${failed} fehlgeschlagen`);
process.exit(failed ? 1 : 0);
