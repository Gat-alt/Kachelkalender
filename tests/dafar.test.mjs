// Prüft Da far automatisch: tippt wie auf dem Handy durch die App. Schlägt etwas fehl, wird nichts gebaut.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let failed = 0, passed = 0;
const check = (n, c, i = "") => { if (c) { passed++; console.log("  ✓ " + n); } else { failed++; console.log("  ✗ " + n + (i ? "  → " + i : "")); } };
const b = await chromium.launch(process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : {});
const ctx = await b.newContext({ viewport: { width: 412, height: 915 }, timezoneId: "Europe/Zurich" });
const pg = await ctx.newPage(); const errs = []; pg.on("pageerror", e => errs.push(String(e)));
await pg.clock.install({ time: new Date("2026-11-14T10:00:00+01:00") }); // Samstag
console.log("Da far");
// Alte, lange Aufgabe aus früheren Versionen
await pg.addInitScript(() => { if (!localStorage.getItem("dafar-tasks")) localStorage.setItem("dafar-tasks", JSON.stringify([{ id: "alt1", project: "arbeit", done: false, created: 1, text: "Also neue Aufgabe und zwar betrifft mit Arbeit. Bitte mache ich ein Studio für Nadia Anfrage. Wer schickt diese Briefe zurück an dem Finger, wenn der Unterlagen zum Wählen kommen?" }])); });
await pg.goto("file://" + path.join(root, "dafar/dist/index.html"));
await pg.waitForTimeout(300);
check("Startet mit den Kacheln", await pg.locator(".tile2").count() === 5);

const add = async t => { await pg.fill("#inp", t); await pg.click(".send"); await pg.waitForTimeout(50); };
const all = () => pg.evaluate(() => JSON.parse(localStorage.getItem("dafar-tasks") || "[]"));
const last = async () => (await all()).slice(-1)[0];
{ const old = (await all()).find(x => x.id === "alt1");
  check("Alte lange Aufgabe wird kurz zusammengefasst", old.text === "Studio für Nadia anfragen" && old.note.includes("Briefe") && old.project === "arbeit", JSON.stringify(old));
  await pg.evaluate(() => localStorage.setItem("dafar-tasks", "[]")); await pg.reload(); await pg.waitForTimeout(200); }

await add("Also neue Aufgabe und zwar betrifft mit Arbeit. Bitte Offerte für Nadia anfragen. Wer schickt die Briefe zurück?");
let t = await last();
check("Gesprochenes: Projekt mitten im Satz erkannt", t.project === "arbeit", JSON.stringify(t));
check("Gesprochenes: kurzer Titel ohne Füllwörter", t.text === "Offerte für Nadia anfragen", t.text);
check("Gesprochenes: ganzer Text bleibt als Notiz", t.note && t.note.includes("Briefe"), t.note);

await add("Nein, Aufgabe für Arbeit, das wäre Vorbereitung von der Sitzung mit dem Team am Mittwoch");
t = await last();
check("Ansage „Aufgabe für Arbeit, das wäre …“ fällt weg", t.project === "arbeit" && t.text === "Sitzung mit dem Team vorbereiten" && t.due === "2026-11-18", JSON.stringify(t));
await add("Ein Aufgabe für Arbeit. Bericht für Frau Meier schreiben");
t = await last();
check("„Ein Aufgabe“ wird nicht zum Titel", t.text === "Bericht für Frau Meier schreiben", t.text);
check("Hinweis unten zeigt nichts Veraltetes", (await pg.locator("#hint").textContent()).startsWith("Gespeichert"));
await pg.evaluate(() => { const a = JSON.parse(localStorage.getItem("dafar-tasks")); a.splice(-2, 2); localStorage.setItem("dafar-tasks", JSON.stringify(a)); });
await pg.reload(); await pg.waitForTimeout(200);

await add("Bauchtasche abholen, morgen, privat");
t = await last();
check("Projekt am Ende + Datum morgen", t.project === "privat" && t.due === "2026-11-15" && t.text === "Bauchtasche abholen", JSON.stringify(t));

await add("Präsentation für die ZHAW vorbereiten bis Freitag");
t = await last();
check("ZHAW → Schule, Freitag → nächster Freitag", t.project === "schule" && t.due === "2026-11-20", JSON.stringify(t));

await add("Chef anrufen");
t = await last();
check("Ohne Angaben: gewähltes Projekt, kein Datum", t.project === "arbeit" && !t.due && t.text === "Chef anrufen", JSON.stringify(t));

await pg.reload(); await pg.waitForTimeout(300);
check("Aufgaben bleiben nach Neustart erhalten", (await all()).length === 4);
check("Kachel Arbeit zählt richtig", (await pg.locator('.tile2[data-view=arbeit] .big').textContent()) === "2");

await pg.click('.tile2[data-view=privat]');
await pg.click("[data-check]"); await pg.waitForTimeout(50);
check("Abhaken speichert", (await all()).find(x => x.project === "privat").done === true);
await pg.click("#undo"); await pg.waitForTimeout(50);
check("Rückgängig macht es wieder offen", (await all()).find(x => x.project === "privat").done === false);

await pg.click("[data-edit]"); await pg.waitForTimeout(50);
await pg.click('#equick [data-eq=""]'); await pg.click('#epick [data-ep="schule"]'); await pg.click("#esave"); await pg.waitForTimeout(50);
t = (await all()).find(x => x.text === "Bauchtasche abholen");
check("Bearbeiten: Datum entfernt, Projekt gewechselt", t.project === "schule" && !t.due, JSON.stringify(t));

await pg.click("#back"); await pg.click('.tile2[data-view=kalender]'); await pg.waitForTimeout(50);
check("Kachel-Kalender zeigt den Monat", (await pg.locator(".calview .tile").count()) >= 28);

check("Keine Fehler in der App", errs.length === 0, errs.join(" | "));
await b.close();
console.log(`\n${passed} bestanden, ${failed} fehlgeschlagen`);
process.exit(failed ? 1 : 0);
