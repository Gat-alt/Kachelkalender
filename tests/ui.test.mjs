// Automatische Prüfung der Kalender-Oberfläche – läuft vor jedem Bau (und lokal mit: npm test).
// Tippt wie auf dem Handy durch alle Ansichten. Schlägt etwas fehl, wird keine neue Version gebaut.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kk-test-"));
const page = path.join(tmp, "index.html");
fs.writeFileSync(page, `<!doctype html><html lang="de"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,interactive-widget=resizes-content">
<style>[hidden]{display:none!important}html,body{margin:0}</style></head><body>
${fs.readFileSync(path.join(root, "ui/kalender.html"), "utf8")}</body></html>`);
const URL = "file://" + page;
const W = 412, H = 915, VIEWS = ["tiles", "grid", "work", "day", "month"];
const NOW = new Date("2026-10-08T09:00:00+02:00");

let failed = 0, passed = 0;
const check = (name, cond, info = "") => { if (cond) { passed++; console.log("  ✓ " + name); } else { failed++; console.log("  ✗ " + name + (info ? "  → " + info : "")); } };

const browser = await chromium.launch();
async function fresh(view, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: W, height: opts.h || H }, hasTouch: true, isMobile: true, timezoneId: "Europe/Zurich", locale: "de-CH" });
  const pg = await ctx.newPage();
  pg.errors = [];
  pg.on("pageerror", e => pg.errors.push(String(e)));
  await pg.clock.install({ time: NOW });
  await pg.addInitScript(v => { window.KK_APP = k => { window._K = k; }; if (v) localStorage.setItem("kachelkalender-proto-v1-view", v); }, view || null);
  await pg.goto(URL);
  await pg.waitForTimeout(600);
  return pg;
}
const closeAll = pg => pg.evaluate(() => { document.querySelectorAll(".scrim").forEach(s => s.hidden = true); const p = document.getElementById("peek"); if (p) { p.hidden = true; document.getElementById("peek-scrim").hidden = true; } });
const tap = (pg, x, y) => pg.touchscreen.tap(x, y);
async function tapEl(pg, el) {
  await el.scrollIntoViewIfNeeded().catch(() => {});
  const b = await el.boundingBox(); if (!b) return false;
  const x = b.x + Math.min(b.width / 2, 24), y = b.y + Math.min(b.height / 2, 8);
  const own = await pg.evaluate(([x, y, id]) => { const e = document.elementFromPoint(x, y); return !!(e && e.closest("[data-ev]") && e.closest("[data-ev]").dataset.ev === id); }, [x, y, await el.getAttribute("data-ev")]);
  if (!own) return null; // von Knopf o. Ä. verdeckt: nicht testbar an dieser Stelle
  await tap(pg, x, y); await pg.waitForTimeout(420); return true;
}
// Termine wie nach einem Abgleich (ZHAW, nur lesen; Abo-Kalender; über Mitternacht)
const SYNC = () => {
  const S = window._K.S;
  S.cals.push({ id: "cz", name: "ZHAW", src: "Microsoft · nur lesen", type: "ms", color: "#1f5fd1", on: true, ro: true });
  S.ev = S.ev.concat([
    { id: "mOld", cal: "cz", rcal: "cz", title: "Sozialpolitik im Übergang zum Postwohlfahrtsstaat", date: "2026-10-08", start: "13:00", end: "16:30", loc: "", notes: "Teams <https://teams.microsoft.com/l/meetup-join/x> ID 1", url: "https://teams.microsoft.com/l/x" },
  ]);
  window._K.save(); window._K.render();
  // zweiter Abgleich: gleiche Anzahl, neue Kennung
  S.ev = S.ev.filter(e => e.cal !== "cz").concat([{ id: "mNew", cal: "cz", rcal: "cz", title: "Sozialpolitik im Übergang zum Postwohlfahrtsstaat", date: "2026-10-08", start: "13:00", end: "16:30", loc: "", notes: "", url: "https://teams.microsoft.com/l/x" }]);
  window._K.render();
};

// 1) Jede Ansicht lädt ohne Fehler, jeder sichtbare Termin geht auf und wieder zu
console.log("Termine antippen in allen Ansichten");
for (const v of VIEWS) {
  const pg = await fresh(v);
  await pg.evaluate(SYNC); await pg.waitForTimeout(300);
  const ids = await pg.evaluate(() => [...new Set([...document.querySelectorAll("#view [data-ev]")].map(x => x.dataset.ev))]);
  let ok = 0, bad = [];
  for (const id of ids) {
    const el = await pg.$(`#view [data-ev="${id}"]`); if (!el) continue;
    const b = await el.boundingBox(); if (!b || b.width < 4 || b.height < 4) continue;
    const r = await tapEl(pg, el); if (r === null || r === false) continue;
    if (!(await pg.isVisible("#peek"))) { bad.push(id); await closeAll(pg); continue; }
    const pr = await pg.evaluate(() => document.getElementById("peek").getBoundingClientRect().toJSON());
    if (pr.top < 0 || pr.bottom > H + 1) bad.push(id + " (ragt raus)");
    await tap(pg, W / 2, pr.top + 22); await pg.waitForTimeout(380); // auf den Kopf der Karte tippen
    if (await pg.isVisible("#peek")) { bad.push(id + " (geht nicht zu)"); await closeAll(pg); }
    ok++;
  }
  check(`${v}: ${ok} Termine gehen auf und zu`, ok > 0 && !bad.length, bad.join(", "));
  check(`${v}: abgeglichener ZHAW-Termin wird aktuell angezeigt`, ids.includes("mNew") && !ids.includes("mOld"));
  check(`${v}: keine JS-Fehler`, !pg.errors.length, pg.errors.join(" | "));
  await pg.context().close();
}

// 2) Leere Stelle antippen: neuer Termin zur angetippten Uhrzeit
console.log("Neuer Termin durch Antippen");
for (const v of ["tiles", "grid", "month"]) {
  const pg = await fresh(v);
  const sel = v === "grid" ? "#view .col[data-drop]" : v === "tiles" ? "#view .evlist.tline" : "#view .mline";
  await pg.waitForTimeout(500);
  const lines = await pg.$$(sel);
  let done = false;
  for (const l of lines) {
    const b = await l.boundingBox(); if (!b || b.height < 60) continue;
    for (const f of [0.25, 0.5, 0.75]) {
      const x = b.x + b.width * 0.92, y = b.y + b.height * f;
      if (y < 150 || y > H - 120) continue;
      const free = await pg.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); return e && !e.closest("[data-ev],button,.rsz"); }, [x, y]);
      if (!free) continue;
      const before = await pg.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y), t = e.closest("[data-drop]"); return t ? t.dataset.drop : null; }, [x, y]);
      await tap(pg, x, y); await pg.waitForTimeout(450);
      if (await pg.isVisible("#peek")) { await closeAll(pg); continue; } // doch einen Termin getroffen: andere Stelle
      const st = await pg.evaluate(() => [document.getElementById("ev-scrim").hidden, document.getElementById("ev-date").value, document.getElementById("ev-start").value]);
      check(`${v}: Editor öffnet am richtigen Tag`, !st[0] && st[1] === before, JSON.stringify(st) + " erwartet " + before);
      // zwei Stellen auf derselben Linie müssen verschiedene Uhrzeiten ergeben
      await closeAll(pg);
      let y2 = null;
      for (const g of [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]) { const yy = b.y + b.height * g; if (Math.abs(yy - y) < b.height * 0.3 || yy < 150 || yy > H - 120) continue;
        if (await pg.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); return e && !e.closest("[data-ev],button,.rsz"); }, [x, yy])) { y2 = yy; break; } }
      if (y2 === null) { done = true; break; }
      {
        await tap(pg, x, y2); await pg.waitForTimeout(450);
        if (await pg.isVisible("#peek")) { await closeAll(pg); done = true; break; }
        const st2 = await pg.evaluate(() => document.getElementById("ev-start").value);
        check(`${v}: Uhrzeit folgt der angetippten Stelle (${st[2]} / ${st2})`, st2 !== st[2] && (y2 > y ? st2 > st[2] : st2 < st[2]));
        await closeAll(pg);
      }
      done = true; break;
    }
    if (done) break;
  }
  check(`${v}: freie Stelle gefunden`, done);
  await pg.context().close();
}

// 3) Eingabe, Bearbeiten, Löschen, Rückgängig, Zeitwahl, Mitternacht
console.log("Termine anlegen und ändern");
{
  const pg = await fresh("grid");
  const S = "window._K.S";
  const n0 = await pg.evaluate(`${S}.ev.length`);
  await pg.click("#fab"); await pg.waitForTimeout(300);
  check("Neuer Termin: Tastatur geht auf", await pg.evaluate(() => document.activeElement.id === "ev-title"));
  await pg.type("#ev-title", "Testtermin morgen 14 Uhr 2h");
  await pg.evaluate(() => document.getElementById("ev-form").requestSubmit()); await pg.waitForTimeout(400);
  const z = await pg.evaluate(`${S}.ev.find(e=>e.title==="Testtermin")`);
  check("Schnelleingabe: Tag, Beginn und Dauer", z && z.date === "2026-10-09" && z.start === "14:00" && z.end === "16:00", JSON.stringify(z));

  // Zeitwahl: Dauer bleibt, Weiterschreiben setzt nichts zurück
  await pg.click("#fab"); await pg.waitForTimeout(300);
  await pg.type("#ev-title", "4 Formaggi Robin kocht");
  await pg.click("#ev-tbtn"); await pg.click('#ev-hrs [data-h="18"]'); await pg.click('#ev-mins [data-m="0"]');
  await pg.click('#ev-durs [data-d="120"]');
  await pg.type("#ev-title", " ");
  let t = await pg.evaluate(() => [document.getElementById("ev-start").value, document.getElementById("ev-end").value]);
  check("Zeitwahl bleibt beim Weiterschreiben", t[0] === "18:00" && t[1] === "20:00", t.join("–"));
  await pg.click('#ev-durs [data-d="240"]'); await pg.click("#ev-tbtn"); await pg.click('#ev-hrs [data-h="21"]');
  t = await pg.evaluate(() => [document.getElementById("ev-start").value, document.getElementById("ev-end").value]);
  check("4 Std. ab 21 Uhr endet um 01:00", t[0] === "21:00" && t[1] === "01:00", t.join("–"));
  await pg.click('#ev-hrs [data-h="14"]');
  t = await pg.evaluate(() => [document.getElementById("ev-start").value, document.getElementById("ev-end").value]);
  check("Dauer bleibt beim Umstellen der Uhrzeit", t[0] === "14:00" && t[1] === "18:00", t.join("–"));
  // Ende frei wählen (z. B. 13:30–14:50)
  await pg.evaluate(() => { document.getElementById("ev-tpick").hidden = true; });
  await pg.click("#ev-tbtn"); await pg.click('#ev-hrs [data-h="13"]'); await pg.click('#ev-mins [data-m="30"]');
  await pg.click("#ev-tbtn2"); await pg.click('#ev-hrs [data-h="14"]'); await pg.click('#ev-mins [data-m="50"]');
  t = await pg.evaluate(() => [document.getElementById("ev-start").value, document.getElementById("ev-end").value]);
  check("Ende frei wählbar (13:30–14:50)", t[0] === "13:30" && t[1] === "14:50", t.join("–"));
  await pg.click("#ev-tbtn"); await pg.click('#ev-hrs [data-h="15"]'); // Minuten bleiben :30
  t = await pg.evaluate(() => [document.getElementById("ev-start").value, document.getElementById("ev-end").value]);
  check("…Dauer bleibt beim Verschieben des Beginns", t[0] === "15:30" && t[1] === "16:50", t.join("–"));
  await pg.fill("#ev-texact", "08:07"); await pg.dispatchEvent("#ev-texact", "change");
  t = await pg.evaluate(() => document.getElementById("ev-start").value);
  check("Genaue Uhrzeit eintippen", t === "08:07", t);
  await closeAll(pg);

  // Über Mitternacht
  await pg.click("#fab"); await pg.waitForTimeout(300);
  await pg.fill("#ev-title", "Party");
  await pg.evaluate(() => { document.getElementById("ev-date").value = "2026-10-09"; document.getElementById("ev-start").value = "22:00"; document.getElementById("ev-end").value = "02:00"; });
  await pg.evaluate(() => document.getElementById("ev-form").requestSubmit()); await pg.waitForTimeout(400);
  const party = await pg.evaluate(`${S}.ev.find(e=>e.title==="Party")`);
  check("Termin über Mitternacht wird gespeichert", party && party.edate === "2026-10-10" && party.end === "02:00", JSON.stringify(party));
  const segs = await pg.evaluate(() => [...document.querySelectorAll("#view [data-ev]")].filter(x => x.textContent.includes("Party")).map(x => x.textContent.replace(/\s+/g, " ")));
  check("…und an beiden Tagen angezeigt", segs.length === 2, JSON.stringify(segs));

  // Bearbeiten: über die Karte, ohne Tastatur, ohne Doppel
  const el = await pg.$(`#view [data-ev="${z.id}"]`);
  await tapEl(pg, el);
  await pg.click("#pk-edit"); await pg.waitForTimeout(400);
  check("Bearbeiten öffnet ohne Tastatur", await pg.evaluate(() => document.activeElement.id !== "ev-title"));
  await pg.fill("#ev-title", "Testtermin geändert");
  await pg.evaluate(() => document.getElementById("ev-form").requestSubmit()); await pg.waitForTimeout(400);
  const tt = await pg.evaluate(`${S}.ev.filter(e=>e.title.startsWith("Testtermin")).map(e=>e.title)`);
  check("Bearbeiten speichert ohne Doppel", tt.length === 1 && tt[0] === "Testtermin geändert", JSON.stringify(tt));
  check("Anzahl Termine stimmt", (await pg.evaluate(`${S}.ev.length`)) === n0 + 2);

  // Löschen und Rückgängig
  await tapEl(pg, await pg.$(`#view [data-ev="${z.id}"]`));
  await pg.click("#pk-more"); await pg.waitForTimeout(450);
  await pg.click("#act-del"); await pg.click("#act-del"); await pg.waitForTimeout(300);
  check("Löschen", await pg.evaluate(`!${S}.ev.find(e=>e.id==="${z.id}")`));
  await pg.click(".toast button"); await pg.waitForTimeout(300);
  check("Rückgängig", await pg.evaluate(`!!${S}.ev.find(e=>e.id==="${z.id}")`));
  check("keine JS-Fehler", !pg.errors.length, pg.errors.join(" | "));
  await pg.context().close();
}

// 4) Tastatur offen (kleiner Bildschirm): Speichern bleibt sichtbar
console.log("Tastatur");
{
  const pg = await fresh("grid");
  await pg.click("#fab"); await pg.waitForTimeout(300);
  await pg.setViewportSize({ width: W, height: 470 }); await pg.waitForTimeout(350);
  let b = await (await pg.$("#ev-form .actions .btn.primary")).boundingBox();
  check("Speichern sichtbar bei offener Tastatur", b && b.y >= 0 && b.y + b.height <= 470, JSON.stringify(b));
  await pg.evaluate(() => document.getElementById("ev-morebtn").click()); await pg.waitForTimeout(200);
  b = await (await pg.$("#ev-form .actions .btn.primary")).boundingBox();
  check("…auch mit «Mehr Optionen»", b && b.y >= 0 && b.y + b.height <= 470, JSON.stringify(b));
  await pg.context().close();
}

// 5) Links in der Karte
console.log("Links");
{
  const pg = await fresh("grid");
  await pg.evaluate(SYNC); await pg.waitForTimeout(300);
  await tapEl(pg, await pg.$('#view [data-ev="mNew"]'));
  const urls = await pg.evaluate(() => [...document.querySelectorAll("#peek [data-url]")].map(a => a.dataset.url));
  check("Teams-Link wird als Knopf angezeigt", urls[0] && urls[0].includes("teams.microsoft.com"), JSON.stringify(urls));
  await pg.context().close();
}

// 6) Unten: Aufgaben, Suche, Einstellungen
console.log("Leiste unten");
{
  const pg = await fresh("grid");
  for (const [b, s] of [["#bb-tasks", "#task-scrim"], ["#bb-search", "#search-scrim"], ["#bb-set", "#set-scrim"]]) {
    await pg.click(b); await pg.waitForTimeout(350);
    check(`${b.slice(4)} öffnet`, await pg.isVisible(s));
    await closeAll(pg);
  }
  await pg.click("#bb-tasks"); await pg.waitForTimeout(300);
  const n = await pg.evaluate("window._K.S.tasks.length");
  await pg.fill("#task-new2", "Test-Aufgabe"); await pg.press("#task-new2", "Enter"); await pg.waitForTimeout(300);
  check("Aufgabe hinzufügen", (await pg.evaluate("window._K.S.tasks.length")) === n + 1);
  await closeAll(pg);
  await pg.click("#bb-search"); await pg.waitForTimeout(300); await pg.keyboard.type("Statistik"); await pg.waitForTimeout(350);
  check("Suche findet Termine", (await pg.evaluate(() => document.querySelectorAll("#search-scrim [data-ev]").length)) > 0);
  check("keine JS-Fehler", !pg.errors.length, pg.errors.join(" | "));
  await pg.context().close();
}

// 7) Sicherung, .ics, zweite Erinnerung
console.log("Sicherung und Erinnerungen");
{
  const pg = await fresh("grid");
  const r = await pg.evaluate(() => {
    const B = window.KK_backup, S = window._K.S, n = S.ev.length, nt = S.tasks.length;
    const json = B.backupJSON();
    S.ev.splice(0, 3); S.tasks = [];
    B.importText(json, false);
    const back = [window._K.S.ev.length === n, window._K.S.tasks.length === nt];
    const ics = B.toICS([{ id: "a1", title: "Party; mit, Sonderzeichen", date: "2026-10-09", start: "22:00", end: "02:00", edate: "2026-10-10", loc: "Zürich", notes: "Zeile 1\nZeile 2", allDay: false, remind: 30 },
                         { id: "a2", title: "Ferien", date: "2026-10-12", edate: "2026-10-16", allDay: true, start: "", end: "" },
                         { id: "a3", title: "Training", date: "2026-10-05", start: "18:30", end: "20:00", allDay: false, rep: { f: "w", until: null, ex: [] } }]);
    const l = B.fromICS(ics);
    return { back, n: l.length, p: l[0], f: l[1], t: l[2] };
  });
  check("Sicherung speichern und laden stellt alles wieder her", r.back[0] && r.back[1], JSON.stringify(r.back));
  check(".ics: Export und Import", r.n === 3);
  check(".ics: Sonderzeichen, Zeilen, über Mitternacht", r.p.title === "Party; mit, Sonderzeichen" && r.p.notes === "Zeile 1\nZeile 2" && r.p.edate === "2026-10-10" && r.p.end === "02:00", JSON.stringify(r.p));
  check(".ics: mehrtägig ganztägig", r.f.allDay && r.f.edate === "2026-10-16", JSON.stringify(r.f));
  check(".ics: wöchentliche Serie", r.t.rep && r.t.rep.f === "w", JSON.stringify(r.t));
  // zweite Erinnerung im Editor
  await pg.click("#fab"); await pg.waitForTimeout(300);
  await pg.fill("#ev-title", "Prüfung");
  await pg.evaluate(() => { document.getElementById("ev-morebtn").click(); document.getElementById("ev-remind").value = "60"; document.getElementById("ev-remind2").value = "1440"; document.getElementById("ev-form").requestSubmit(); });
  await pg.waitForTimeout(300);
  const pr = await pg.evaluate(() => window._K.S.ev.find(e => e.title === "Prüfung"));
  check("Zwei Erinnerungen werden gespeichert", pr && pr.remind === 60 && pr.remind2 === 1440, JSON.stringify(pr));
  check("keine JS-Fehler", !pg.errors.length, pg.errors.join(" | "));
  await pg.context().close();
}

// 8) Querformat und Farben
console.log("Querformat, Hell/Dunkel");
{
  const pg = await fresh("tiles");
  await pg.setViewportSize({ width: H, height: W }); await pg.waitForTimeout(600);
  await pg.evaluate(() => document.getElementById("theme-btn").click()); await pg.waitForTimeout(200);
  check("Querformat und Farbwechsel ohne Fehler", !pg.errors.length, pg.errors.join(" | "));
  await pg.context().close();
}

await browser.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${passed} bestanden, ${failed} fehlgeschlagen`);
process.exit(failed ? 1 : 0);
