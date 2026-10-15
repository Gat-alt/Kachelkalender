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
const onServer = srv => [...srv.res.values()].flatMap(x => x.ics.split("BEGIN:VEVENT").slice(1).map(v => (v.match(/SUMMARY:(.*)/) || [])[1].trim() + "@" + (v.match(/\nDTSTART[^:]*:(\d{8})/) || [])[1]));
const ics = (srv, href) => (srv.res.get(href) || {}).ics || "";
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
// D) Serie mit Ausnahme beim Anbieter: alles bearbeitbar, Ausnahme bleibt Teil der Serie
{
  const srv = server();
  srv.put("/cal/ex.ics", "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:ex-1\r\nSUMMARY:Kurs\r\nDTSTART;TZID=Europe/Zurich:20261001T100000\r\nDTEND;TZID=Europe/Zurich:20261001T110000\r\nRRULE:FREQ=WEEKLY\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:ex-1\r\nRECURRENCE-ID;TZID=Europe/Zurich:20261015T100000\r\nSUMMARY:Kurs (anderer Raum)\r\nDTSTART;TZID=Europe/Zurich:20261015T120000\r\nDTEND;TZID=Europe/Zurich:20261015T130000\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n");
  const pg = await setup(srv);
  const l0 = await evs(pg);
  check("Serie mit Ausnahme: nichts gesperrt", l0.filter(e => e.t.startsWith("Kurs")).every(e => !e.lock), JSON.stringify(l0));
  const shown = await pg.evaluate(() => window.KK_TEST.K().expanded().filter(e => e.title.startsWith("Kurs") && e.date >= "2026-10-08" && e.date <= "2026-10-22").map(e => e.date + " " + e.title).sort());
  check("…am 15. die Ausnahme statt dem Serientermin", JSON.stringify(shown) === JSON.stringify(["2026-10-08 Kurs", "2026-10-15 Kurs (anderer Raum)", "2026-10-22 Kurs"]), JSON.stringify(shown));
  // Ausnahme bearbeiten
  const xid = l0.find(e => e.t === "Kurs (anderer Raum)").id;
  await pg.evaluate(() => window.KK_TEST.K().goto("2026-10-15", "grid")); await pg.waitForTimeout(400);
  await openCard(pg, xid); await pg.waitForTimeout(450); await pg.click("#pk-edit"); await pg.waitForTimeout(400);
  check("…Ausnahme: Titel änderbar", !(await pg.evaluate(() => document.getElementById("ev-title").disabled)));
  await pg.fill("#ev-title", "Kurs Raum B");
  await pg.evaluate(() => document.getElementById("ev-form").requestSubmit()); await pg.waitForTimeout(2600); await sync(pg);
  const t = ics(srv, "/cal/ex.ics");
  check("…beim Anbieter geändert, als Ausnahme derselben Serie", /SUMMARY:Kurs Raum B/.test(t) && /RECURRENCE-ID/.test(t) && /RRULE:FREQ=WEEKLY/.test(t) && srv.res.size === 1, t);
  // ein anderes Datum nur einmal ändern → neue Ausnahme in derselben Ressource
  await pg.evaluate(() => window.KK_TEST.K().goto("2026-10-08", "grid")); await pg.waitForTimeout(400);
  const occ = await pg.evaluate(() => [...document.querySelectorAll("#view [data-ev]")].map(x => x.dataset.ev).find(x => x.includes("@2026-10-08")));
  await openCard(pg, occ); await pg.waitForTimeout(450); await pg.click("#pk-edit"); await pg.waitForTimeout(400);
  await pg.fill("#ev-title", "Kurs fällt aus?");
  await pg.evaluate(() => document.getElementById("ev-form").requestSubmit()); await pg.waitForTimeout(2600); await sync(pg);
  const t2 = ics(srv, "/cal/ex.ics");
  check("…zweite Ausnahme ebenfalls in der Serie", (t2.match(/RECURRENCE-ID/g) || []).length === 2 && /SUMMARY:Kurs fällt aus\?/.test(t2) && srv.res.size === 1, t2);
  const after = await pg.evaluate(() => window.KK_TEST.K().expanded().filter(e => e.title.startsWith("Kurs") && e.date >= "2026-10-08" && e.date <= "2026-10-22").map(e => e.date + " " + e.title).sort());
  check("…nach dem Abgleich alles richtig da", JSON.stringify(after) === JSON.stringify(["2026-10-08 Kurs fällt aus?", "2026-10-15 Kurs Raum B", "2026-10-22 Kurs"]), JSON.stringify(after));
  // ganze Serie von einer Ausnahme aus löschen
  const x2 = (await evs(pg)).find(e => e.t === "Kurs Raum B").id;
  await pg.evaluate(() => window.KK_TEST.K().goto("2026-10-15", "grid")); await pg.waitForTimeout(400);
  await openCard(pg, x2); await pg.waitForTimeout(450); await pg.click("#pk-edit"); await pg.waitForTimeout(400);
  await pg.click('#ev-scope [data-scope="all"]'); await pg.click("#ev-del"); await pg.click("#ev-del"); await pg.waitForTimeout(2600); await sync(pg);
  check("…ganze Serie gelöscht, auch beim Anbieter", srv.res.size === 0 && !(await evs(pg)).some(e => e.t.startsWith("Kurs")), JSON.stringify(onServer(srv)));
  check("keine JS-Fehler", !pg.errs.length, pg.errs.join(" | "));
  await pg.context().close();
}
// G) Eigene Regel «jeden 2. Dienstag im Monat»: anzeigen, bearbeiten, Regel bleibt
{
  const srv = server(); srv.put("/cal/m.ics", VEV("m-1", "Teamsitzung", "20260908T090000", "20260908T100000", "RRULE:FREQ=MONTHLY;BYDAY=2TU\r\n"));
  const pg = await setup(srv);
  const days = await pg.evaluate(() => window.KK_TEST.K().expanded().filter(e => e.title === "Teamsitzung").map(e => e.date).filter(d => d < "2026-12-31"));
  check("2. Dienstag: richtige Tage", JSON.stringify(days) === JSON.stringify(["2026-09-08", "2026-10-13", "2026-11-10", "2026-12-08"]), JSON.stringify(days));
  const m = (await evs(pg)).find(e => e.t === "Teamsitzung");
  check("…als bearbeitbare Serie", m.rep === "x" && !m.lock, JSON.stringify(m));
  const occ = (await pg.evaluate(() => window.KK_TEST.K().expanded().find(e => e.title === "Teamsitzung" && e.date === "2026-10-13").id));
  await pg.evaluate(() => window.KK_TEST.K().goto("2026-10-13", "grid")); await pg.waitForTimeout(400);
  await openCard(pg, occ); await pg.waitForTimeout(450);
  const sub = await pg.evaluate(() => document.getElementById("pk-body").textContent);
  check("…Text «Jeden Monat am 2. Di»", /Jeden Monat am 2\. Di/.test(sub), sub.slice(0, 200));
  await pg.click("#pk-edit"); await pg.waitForTimeout(400);
  await pg.click('#ev-scope [data-scope="all"]');
  check("…Regel im Formular gewählt", (await pg.evaluate(() => document.getElementById("ev-rep").value)) === "x");
  await pg.fill("#ev-title", "Teamsitzung neu"); await pg.evaluate(() => { document.getElementById("ev-start").value = "09:30"; document.getElementById("ev-end").value = "10:30"; });
  await pg.evaluate(() => document.getElementById("ev-form").requestSubmit()); await pg.waitForTimeout(2600); await sync(pg);
  const t = ics(srv, "/cal/m.ics");
  check("…ganze Serie beim Anbieter geändert, Regel bleibt", /SUMMARY:Teamsitzung neu/.test(t) && /RRULE:FREQ=MONTHLY;BYDAY=2TU\r\n/.test(t) && /DTSTART;TZID=Europe\/Zurich:20260908T093000/.test(t), t);
  // einen Termin löschen
  const occ2 = (await pg.evaluate(() => window.KK_TEST.K().expanded().find(e => e.title === "Teamsitzung neu" && e.date === "2026-11-10").id));
  await pg.evaluate(() => window.KK_TEST.K().goto("2026-11-10", "grid")); await pg.waitForTimeout(400);
  await openCard(pg, occ2); await pg.waitForTimeout(450); await pg.click("#pk-edit"); await pg.waitForTimeout(400);
  await pg.click("#ev-del"); await pg.click("#ev-del"); await pg.waitForTimeout(2600); await sync(pg);
  check("…einzelner Termin gelöscht (EXDATE)", /EXDATE[^:]*:20261110/.test(ics(srv, "/cal/m.ics")), ics(srv, "/cal/m.ics"));
  const d2 = await pg.evaluate(() => window.KK_TEST.K().expanded().filter(e => e.title === "Teamsitzung neu").map(e => e.date).filter(d => d < "2026-12-31"));
  check("…und in der App weg", JSON.stringify(d2) === JSON.stringify(["2026-09-08", "2026-10-13", "2026-12-08"]), JSON.stringify(d2));
  check("keine JS-Fehler", !pg.errs.length, pg.errs.join(" | "));
  await pg.context().close();
}
// H) Serie mit fester Anzahl (COUNT) bleibt beim Bearbeiten erhalten
{
  const srv = server(); srv.put("/cal/c.ics", VEV("c-1", "Physio", "20261005T170000", "20261005T173000", "RRULE:FREQ=WEEKLY;BYDAY=MO,WE;COUNT=6\r\n"));
  const pg = await setup(srv);
  const days = await pg.evaluate(() => window.KK_TEST.K().expanded().filter(e => e.title === "Physio").map(e => e.date));
  check("COUNT=6: genau sechs Termine", JSON.stringify(days) === JSON.stringify(["2026-10-05", "2026-10-07", "2026-10-12", "2026-10-14", "2026-10-19", "2026-10-21"]), JSON.stringify(days));
  await pg.evaluate(() => { const K = window.KK_TEST.K(); const e = K.S.ev.find(x => x.title === "Physio"); e.loc = "Praxis Nord"; K.save(); });
  await pg.waitForTimeout(2600); await sync(pg);
  const t = ics(srv, "/cal/c.ics");
  check("…nach dem Ändern: COUNT=6 beim Anbieter", /RRULE:FREQ=WEEKLY;BYDAY=MO,WE;COUNT=6/.test(t) && /LOCATION:Praxis Nord/.test(t), t);
  check("keine JS-Fehler", !pg.errs.length, pg.errs.join(" | "));
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
