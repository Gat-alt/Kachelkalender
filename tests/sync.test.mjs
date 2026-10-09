// Abgleich mit einem nachgebauten CalDAV-Server (wie Infomaniak): nichts darf beim Anbieter verloren gehen.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const URL0 = "file://" + path.join(root, "dist/index.html");
let failed = 0, passed = 0;
const check = (n, c, i = "") => { if (c) { passed++; console.log("  ✓ " + n); } else { failed++; console.log("  ✗ " + n + (i ? "  → " + i : "")); } };
const b = await chromium.launch();

function server() {
  const res = new Map(); let n = 1; const log = [];
  const put = (href, ics) => res.set(href, { ics, etag: '"e' + (n++) + '"' });
  return { res, log, put, handler: async r => {
    const req = r.request(), u = new URL(req.url()), m = req.method(), h = req.headers();
    log.push([m, u.pathname]);
    if (m === "REPORT") {
      const body = [...res.entries()].map(([href, x]) => `<d:response><d:href>${href}</d:href><d:propstat><d:prop><d:getetag>${x.etag}</d:getetag><c:calendar-data>${x.ics.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</c:calendar-data></d:prop></d:propstat></d:response>`).join("");
      return r.fulfill({ status: 207, contentType: "application/xml", body: `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">${body}</d:multistatus>` });
    }
    if (m === "PUT") {
      const cur = res.get(u.pathname);
      if (h["if-match"] && (!cur || cur.etag !== h["if-match"])) return r.fulfill({ status: 412, body: "" });
      if (h["if-none-match"] === "*" && cur) return r.fulfill({ status: 412, body: "" });
      put(u.pathname, req.postData());
      return r.fulfill({ status: 201, headers: { etag: res.get(u.pathname).etag }, body: "" });
    }
    if (m === "DELETE") { res.delete(u.pathname); return r.fulfill({ status: 204, body: "" }); }
    r.fulfill({ status: 404, body: "" });
  } };
}
const VEV = (uid, sum, dt, de, extra = "") => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:${uid}\r\nSUMMARY:${sum}\r\nDTSTART;TZID=Europe/Zurich:${dt}\r\nDTEND;TZID=Europe/Zurich:${de}\r\n${extra}END:VEVENT\r\nEND:VCALENDAR\r\n`;
async function setup(srv) {
  const ctx = await b.newContext({ viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true, timezoneId: "Europe/Zurich", userAgent: "Mozilla/5.0 (Linux; Android 14) Chrome/141 Mobile" });
  const pg = await ctx.newPage(); pg.errs = []; pg.on("pageerror", e => pg.errs.push(String(e)));
  await pg.clock.install({ time: new Date("2026-10-08T09:00:00+02:00") });
  await pg.route("https://dav.test/**", srv.handler);
  await pg.addInitScript(() => {
    window.__TAURI__ = { http: { fetch: (...a) => fetch(...a) } };
    if (!localStorage.getItem("kachelkalender-proto-v1")) {
      localStorage.setItem("kachelkalender-sec-v1", JSON.stringify({ a1: { user: "u", pass: "p", server: "https://dav.test" } }));
      localStorage.setItem("kachelkalender-proto-v1", JSON.stringify({ cals: [{ id: "cdav", name: "Infomaniak", src: "Infomaniak", type: "infomaniak", acct: "a1", url: "https://dav.test/cal/", color: "#7b4fd6", on: true },
        { id: "czh", name: "ZHAW", src: "Microsoft · nur lesen", type: "ms", color: "#1f5fd1", on: true, ro: true }, { id: "local", name: "Persönlich", src: "Nur auf diesem Gerät", type: "local", color: "#0e9aa7", on: true }],
        ev: [], tasks: [], set: { theme: "", font: "14.5px", gaps: true, kw: true, hol: true, remind: 15 }, v3: 1, v4: 1, v5: 1, v6: 1, sets: [] }));
      localStorage.setItem("kachelkalender-proto-v1-view", "grid");
    }
  });
  await pg.goto(URL0); await pg.waitForTimeout(2500);
  return pg;
}
const evs = pg => pg.evaluate(() => window.KK_TEST.K().S.ev.map(e => ({ id: e.id, t: e.title, d: e.date, s: e.start, cal: e.cal, rh: e.rh || null, rep: e.rep && e.rep.f, lock: !!e.lock })));
const sync = async pg => { await pg.evaluate(() => window.KK_TEST.sync(false)); await pg.waitForTimeout(600); };
const onServer = srv => [...srv.res.values()].map(x => (x.ics.match(/SUMMARY:(.*)/) || [])[1] + "@" + (x.ics.split("BEGIN:VEVENT")[1].match(/DTSTART[^:]*:(\d{8})/) || [])[1]);
const openCard = (pg, id) => pg.evaluate(id => document.querySelector(`#view [data-ev="${id}"]`).click(), id);

console.log("Abgleich mit CalDAV (Infomaniak)");
// A) «Morgen wiederholen»: Original bleibt beim Anbieter, Kopie kommt dazu
{
  const srv = server(); srv.put("/cal/meet.ics", VEV("meet-1", "Meeting", "20261008T140000", "20261008T150000"));
  const pg = await setup(srv);
  const id = (await evs(pg)).find(e => e.t === "Meeting").id;
  await openCard(pg, id); await pg.waitForTimeout(450); await pg.click("#pk-more"); await pg.waitForTimeout(300);
  await pg.click('#act-scrim [data-act="dup"]'); await pg.waitForTimeout(2600); await sync(pg);
  const s = onServer(srv).sort();
  check("«Morgen wiederholen»: Original und Kopie beim Anbieter", JSON.stringify(s) === JSON.stringify(["Meeting@20261008", "Meeting@20261009"]), JSON.stringify(s));
  check("…und beide in der App", (await evs(pg)).filter(e => e.t === "Meeting").length === 2);
  check("keine JS-Fehler", !pg.errs.length, pg.errs.join(" | "));
  await pg.context().close();
}
// B) Serie: nur diesen Termin ändern → Ausnahme bleibt erhalten
{
  const srv = server(); srv.put("/cal/ser.ics", VEV("ser-1", "Training", "20261001T183000", "20261001T200000", "RRULE:FREQ=WEEKLY\r\n"));
  const pg = await setup(srv);
  const occ = await pg.evaluate(() => [...document.querySelectorAll("#view [data-ev]")].map(x => x.dataset.ev).find(x => x.includes("@2026-10-08")));
  await openCard(pg, occ); await pg.waitForTimeout(450); await pg.click("#pk-edit"); await pg.waitForTimeout(400);
  await pg.fill("#ev-title", "Training verschoben");
  await pg.evaluate(() => document.getElementById("ev-form").requestSubmit()); await pg.waitForTimeout(2600); await sync(pg);
  const loc = await evs(pg);
  check("Serie «nur diesen»: geänderter Termin bleibt nach dem Abgleich", loc.some(e => e.t === "Training verschoben" && e.d === "2026-10-08"), JSON.stringify(loc));
  check("…auch beim Anbieter", onServer(srv).includes("Training verschoben@20261008"), JSON.stringify(onServer(srv)));
  check("…die Serie bleibt", onServer(srv).some(x => x.startsWith("Training@")));
  await pg.context().close();
}
// C) Nur-lesen-Termin (ZHAW) in Infomaniak kopieren → wird hochgeladen
{
  const srv = server();
  const pg = await setup(srv);
  await pg.evaluate(() => { const K = window.KK_TEST.K(); K.S.ev.push({ id: "mz1", gid: "G1", cal: "czh", rcal: "czh", title: "Vorlesung", date: "2026-10-08", start: "13:00", end: "14:00", allDay: false, loc: "", notes: "", lock: true, rsig: "x" }); K.save(); K.render(); });
  await pg.waitForTimeout(300); await openCard(pg, "mz1"); await pg.waitForTimeout(450);
  await pg.click("#pk-more"); await pg.waitForTimeout(300); await pg.click('#act-scrim [data-act="copy"]'); await pg.waitForTimeout(300);
  await pg.evaluate(() => { const c = document.querySelectorAll("#view .col[data-drop]")[4]; const r = c.getBoundingClientRect(); c.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: r.left + 5, clientY: r.top + 300 })); });
  await pg.waitForTimeout(2600); await sync(pg);
  check("Kopie eines ZHAW-Termins wird zu Infomaniak hochgeladen", onServer(srv).some(x => x.startsWith("Vorlesung@")), JSON.stringify(onServer(srv)));
  await pg.context().close();
}
// D) Serie mit Ausnahme beim Anbieter: Einzeltermin ist geschützt, nichts verschwindet
{
  const srv = server();
  srv.put("/cal/ex.ics", "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:ex-1\r\nSUMMARY:Kurs\r\nDTSTART;TZID=Europe/Zurich:20261001T100000\r\nDTEND;TZID=Europe/Zurich:20261001T110000\r\nRRULE:FREQ=WEEKLY\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:ex-1\r\nRECURRENCE-ID;TZID=Europe/Zurich:20261015T100000\r\nSUMMARY:Kurs (anderer Raum)\r\nDTSTART;TZID=Europe/Zurich:20261015T120000\r\nDTEND;TZID=Europe/Zurich:20261015T130000\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n");
  const pg = await setup(srv);
  const before = (await evs(pg)).filter(e => e.t.startsWith("Kurs")).length;
  const id = await pg.evaluate(() => window.KK_TEST.K().S.ev.find(e => e.title === "Kurs" && e.date === "2026-10-08").id);
  await openCard(pg, id); await pg.waitForTimeout(450); await pg.click("#pk-edit"); await pg.waitForTimeout(400);
  check("Gesperrter Einzeltermin: Titel nicht änderbar", await pg.evaluate(() => document.getElementById("ev-title").disabled));
  check("…kein Löschen", await pg.evaluate(() => document.getElementById("ev-del").hidden));
  await pg.evaluate(() => document.getElementById("ev-form").requestSubmit()); await pg.waitForTimeout(2600); await sync(pg);
  const after = (await evs(pg)).filter(e => e.t.startsWith("Kurs")).length;
  check("…und nach dem Abgleich fehlt kein Termin", after === before && before > 5, before + " → " + after);
  await pg.context().close();
}
// E) Termin nach «Persönlich (nur auf diesem Gerät)» verschieben → beim Anbieter gelöscht
{
  const srv = server(); srv.put("/cal/p.ics", VEV("p-1", "Privat", "20261009T100000", "20261009T110000"));
  const pg = await setup(srv);
  await pg.evaluate(() => { const K = window.KK_TEST.K(); const e = K.S.ev.find(x => x.title === "Privat"); e.cal = "local"; K.save(); });
  await pg.waitForTimeout(2600); await sync(pg);
  check("Nach «nur auf diesem Gerät» verschoben: beim Anbieter gelöscht", !onServer(srv).some(x => x.startsWith("Privat@")), JSON.stringify(onServer(srv)));
  check("…in der App noch da", (await evs(pg)).some(e => e.t === "Privat" && e.cal === "local"));
  await pg.context().close();
}
// F) Serie über Mitternacht: «Ganze Serie» ändern streckt keine Termine
{
  const srv = server(); srv.put("/cal/n.ics", VEV("n-1", "Nachtschicht", "20260924T220000", "20260925T020000", "RRULE:FREQ=WEEKLY\r\n"));
  const pg = await setup(srv);
  const occ = await pg.evaluate(() => [...document.querySelectorAll("#view [data-ev]")].map(x => x.dataset.ev).find(x => x.includes("@2026-10-08")));
  await openCard(pg, occ); await pg.waitForTimeout(450); await pg.click("#pk-edit"); await pg.waitForTimeout(400);
  await pg.click('#ev-scope [data-scope="all"]'); await pg.fill("#ev-title", "Nachtdienst");
  await pg.evaluate(() => document.getElementById("ev-form").requestSubmit()); await pg.waitForTimeout(500);
  const m = await pg.evaluate(() => { const e = window.KK_TEST.K().S.ev.find(x => x.title === "Nachtdienst"); return [e.date, e.edate]; });
  check("«Ganze Serie» über Mitternacht: Ende bleibt am Folgetag", m[0] === "2026-09-24" && m[1] === "2026-09-25", JSON.stringify(m));
  await pg.context().close();
}
await b.close();
console.log(`\n${passed} bestanden, ${failed} fehlgeschlagen`);
process.exit(failed ? 1 : 0);
