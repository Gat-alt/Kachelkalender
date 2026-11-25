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

await pg.click("#back"); await pg.waitForTimeout(50);
await add("Am Morgen Zahnarzt anrufen, privat");
t = await last();
check("„am Morgen“ ist kein Datum", t.project === "privat" && !t.due, JSON.stringify(t));

// Mehr Datumsangaben (heute = Samstag, 14.11.2026)
const dueOf = async x => { await add(x); return await last(); };
t = await dueOf("Rechnung bezahlen in 3 Tagen privat"); check("„in 3 Tagen“", t.due === "2026-11-17" && t.text === "Rechnung bezahlen", JSON.stringify(t));
t = await dueOf("Bericht abgeben bis Ende Woche für die Arbeit"); check("„Ende Woche“ → Freitag", t.due === "2026-11-20" && t.project === "arbeit" && t.text === "Bericht abgeben", JSON.stringify(t));
t = await dueOf("Geschenk für Mama kaufen am 5. Dezember"); check("„am 5. Dezember“", t.due === "2026-12-05" && t.text === "Geschenk für Mama kaufen", JSON.stringify(t));
t = await dueOf("Steuern einreichen bis 31.3. privat"); check("„31.3.“ → nächstes Jahr", t.due === "2027-03-31", JSON.stringify(t));
t = await dueOf("1.5 Liter Milch kaufen privat"); check("„1.5 Liter“ ist kein Datum", !t.due, JSON.stringify(t));
t = await dueOf("Zimmer aufräumen in zwei Wochen privat"); check("„in zwei Wochen“", t.due === "2026-11-28", JSON.stringify(t));

// Mehrere Aufgaben in einem Satz
{ const n0 = (await all()).length;
  await add("Für die Arbeit: Protokoll an Peter schicken und dann noch Offerte für Nadia anfragen bis Montag");
  const a = await all(), neu = a.slice(n0);
  check("Zwei Aufgaben aus einem Satz", neu.length === 2 && neu[0].text === "Protokoll an Peter schicken" && neu[1].text === "Offerte für Nadia anfragen", JSON.stringify(neu));
  check("Projekt gilt für beide, Datum nur für die zweite", neu.every(x => x.project === "arbeit") && !neu[0].due && neu[1].due === "2026-11-16", JSON.stringify(neu));
  check("Hinweis nennt beide", (await pg.locator("#hint").textContent()).startsWith("2 Aufgaben gespeichert"));
  await add("Milch und noch Brot kaufen privat");
  check("„und noch“ mitten im Satz trennt nicht", (await last()).text.includes("Milch") && (await all()).length === n0 + 3, (await last()).text);
}

// Handy: Android-Spracherkennung → Aufgabe wird sofort gespeichert, mit Projekt und Datum
{
  const p2 = await ctx.newPage(); p2.on("pageerror", e => errs.push(String(e)));
  await p2.addInitScript(() => {
    window.DafarVoice = { available: () => true, start: () => setTimeout(() => window.dafarVoiceResult("Steuererklärung ausfüllen bis Freitag für die Arbeit", ""), 30) };
  });
  await p2.goto("file://" + path.join(root, "dafar/dist/index.html")); await p2.waitForTimeout(200);
  const n0 = (await p2.evaluate(() => JSON.parse(localStorage.getItem("dafar-tasks") || "[]"))).length;
  check("Mikrofon sichtbar mit Android-Erkennung", await p2.locator("#mic").isVisible());
  await p2.click("#mic"); await p2.waitForTimeout(200);
  const a2 = await p2.evaluate(() => JSON.parse(localStorage.getItem("dafar-tasks") || "[]"));
  const v = a2.slice(-1)[0];
  check("Gesprochenes wird sofort gespeichert", a2.length === n0 + 1 && v.project === "arbeit" && v.text === "Steuererklärung ausfüllen" && !!v.due, JSON.stringify(v));
  check("Hinweis bestätigt das Speichern", (await p2.locator("#hint").textContent()).startsWith("Gespeichert in „Arbeit“"));
  await p2.close();
}

// Korrekturliste: falsch verstandene Wörter werden gelernt und beim nächsten Sprechen ersetzt
{
  const p3 = await ctx.newPage(); p3.on("pageerror", e => errs.push(String(e)));
  await p3.addInitScript(() => {
    window.__say = "Tockets für das Konzert kaufen, privat";
    window.DafarVoice = { available: () => true, start: () => setTimeout(() => window.dafarVoiceResult(window.__say, ""), 30) };
  });
  await p3.goto("file://" + path.join(root, "dafar/dist/index.html")); await p3.waitForTimeout(200);
  const get = () => p3.evaluate(() => JSON.parse(localStorage.getItem("dafar-tasks") || "[]"));
  await p3.click("#mic"); await p3.waitForTimeout(200);
  let v = (await get()).slice(-1)[0];
  check("Gesprochene Aufgabe ist markiert", v.voice === true && v.text === "Tockets für das Konzert kaufen", JSON.stringify(v));
  await p3.click('.tile2[data-view=privat]'); await p3.waitForTimeout(50);
  await p3.locator(".task", { hasText: "Tockets" }).locator("[data-edit]").click(); await p3.waitForTimeout(50);
  await p3.fill("#etext", "Tickets für das Konzert kaufen"); await p3.click("#esave"); await p3.waitForTimeout(50);
  const k = await p3.evaluate(() => JSON.parse(localStorage.getItem("dafar-korrektur") || "{}"));
  check("Korrektur wird gemerkt", k.tockets === "Tickets", JSON.stringify(k));
  check("Hinweis „Gemerkt“ erscheint", (await p3.locator("#toastMsg").textContent()).includes("Tockets → Tickets"));
  await p3.evaluate(() => { window.__say = "Tockets fürs Kino abholen, privat"; });
  await p3.click("#mic"); await p3.waitForTimeout(200);
  v = (await get()).slice(-1)[0];
  check("Nächstes Mal wird das Wort ersetzt", v.text === "Tickets fürs Kino abholen", JSON.stringify(v));
  // Umgeschriebener Inhalt wird nicht gelernt
  await p3.locator(".task", { hasText: "Kino" }).locator("[data-edit]").click(); await p3.waitForTimeout(50);
  await p3.fill("#etext", "Tickets fürs Theater abholen"); await p3.click("#esave"); await p3.waitForTimeout(50);
  const k2 = await p3.evaluate(() => JSON.parse(localStorage.getItem("dafar-korrektur") || "{}"));
  check("Andere Wörter werden nicht als Fehler gelernt", !k2.kino, JSON.stringify(k2));
  // Liste ansehen, von Hand ergänzen und löschen
  await p3.click("#korrBtn"); await p3.waitForTimeout(50);
  check("Liste zeigt das gelernte Wort", (await p3.locator("#klist").textContent()).includes("Tickets"));
  await p3.fill("#kfalsch", "Sali"); await p3.fill("#krichtig", "Salat"); await p3.click("#kadd"); await p3.waitForTimeout(50);
  await p3.locator('[data-kdel="tockets"]').click(); await p3.waitForTimeout(50);
  const k3 = await p3.evaluate(() => JSON.parse(localStorage.getItem("dafar-korrektur") || "{}"));
  check("Von Hand hinzufügen und löschen", k3.sali === "Salat" && !k3.tockets, JSON.stringify(k3));
  await p3.click("#kclose");
  // Getippte Aufgaben werden nicht verändert
  await p3.fill("#inp", "Sali kaufen privat"); await p3.click(".send"); await p3.waitForTimeout(50);
  check("Getippter Text bleibt, wie er ist", (await get()).slice(-1)[0].text === "Sali kaufen", (await get()).slice(-1)[0].text);
  await p3.close();
}

check("Keine Fehler in der App", errs.length === 0, errs.join(" | "));
await b.close();
console.log(`\n${passed} bestanden, ${failed} fehlgeschlagen`);
process.exit(failed ? 1 : 0);
