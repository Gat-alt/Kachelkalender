/* Kachelkalender – App-Schicht
   Läuft nur in der installierten App (Tauri). Verbindet Kalender direkt mit deinen Anbietern:
   - Abo-Links (.ics), z. B. ZHAW-Stundenplan: nur lesen
   - CalDAV (Infomaniak, iCloud, Nextcloud, …): lesen und schreiben
   Zugangsdaten bleiben in einem eigenen Speicherbereich dieser App auf diesem Gerät.
   Es gibt keinen Kachelkalender-Server: Die App spricht nur mit den Servern, die du einträgst. */
(() => {
"use strict";
window.KK_IS_APP = true;
document.documentElement.classList.add("kk-app");

const T = window.__TAURI__ || {};
const IS_ANDROID = /Android/i.test(navigator.userAgent);
const SEC = "kachelkalender-sec-v1";
const SERVERS = { infomaniak: "https://sync.infomaniak.com", icloud: "https://caldav.icloud.com" };
const LOCAL_TZ = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Zurich"; } catch (e) { return "Europe/Zurich"; } })();
let K = null;           // Zugriff auf die Kalender-Oberfläche (wird beim Start übergeben)
let busy = Promise.resolve();
let lastSync = null, lastErr = null, offline = !navigator.onLine;

window.KK_EMPTY = () => ({
  cals: [{ id: "local", name: "Persönlich", src: "Nur auf diesem Gerät", type: "local", color: "#7b4fd6", on: true }],
  ev: [], tasks: [],
  set: { theme: "", font: "14.5px", gaps: true, kw: true, hol: true, remind: 15 },
  v3: 1, v4: 1
});

window.KK_note = (k, t) => ({
  ms: "Die Microsoft-Anmeldung kommt mit einem der nächsten Updates. Bis dahin geht es so: In Outlook im Web unter Einstellungen → Kalender → Freigegebene Kalender → «Kalender veröffentlichen» einen ICS-Link erstellen und ihn hier als «Abo-Link (.ics)» hinzufügen (nur lesen). Für das ZHAW-Konto braucht es die Freigabe der ZHAW.",
  ics: "Nur lesen. Wird beim Öffnen und alle 15 Minuten aktualisiert.",
  local: "Termine bleiben nur auf diesem Gerät."
}[k] || (t.note + " Zugangsdaten bleiben nur auf diesem Gerät."));

/* ---------- Speicher für Zugangsdaten (getrennt von den Terminen) ---------- */
const sec = () => { try { return JSON.parse(localStorage.getItem(SEC)) || {}; } catch (e) { return {}; } };
const setSec = o => { try { localStorage.setItem(SEC, JSON.stringify(o)); } catch (e) {} };

/* ---------- Netzwerk ---------- */
const hfetch = (url, opt) => (T.http && T.http.fetch ? T.http.fetch(url, opt) : fetch(url, opt));
const b64 = s => btoa(unescape(encodeURIComponent(s)));
function authHeaders(acct) {
  const a = sec()[acct] || {};
  return a.user ? { Authorization: "Basic " + b64(a.user + ":" + (a.pass || "")) } : {};
}
async function dav(method, url, acct, body, depth, extra) {
  const h = Object.assign({ "Content-Type": "application/xml; charset=utf-8" }, authHeaders(acct), extra || {});
  if (depth != null) h.Depth = String(depth);
  let r;
  try { r = await hfetch(url, { method, headers: h, body }); }
  catch (e) { throw new Error("Keine Verbindung zum Server (" + new URL(url).host + ")."); }
  if (r.status === 401 || r.status === 403) throw new Error("Benutzername oder App-Passwort stimmt nicht.");
  if (r.status === 412) { const err = new Error("Konflikt"); err.conflict = true; throw err; }
  if (r.status >= 400 && !(method === "DELETE" && r.status === 404)) throw new Error("Der Server meldet Fehler " + r.status + ".");
  return { status: r.status, text: await r.text(), url: r.url || url, etag: r.headers.get("etag") };
}
const xml = t => new DOMParser().parseFromString(t, "application/xml");
const tags = (n, name) => [...n.getElementsByTagNameNS("*", name)];
const txt = (n, name) => { const e = tags(n, name)[0]; return e ? e.textContent.trim() : ""; };
const abs = (base, h) => new URL(h, base).href;
const hrefIn = (t, prop) => { const p = tags(xml(t), prop)[0]; return p ? txt(p, "href") : ""; };

/* ---------- CalDAV: Kalender finden ---------- */
async function discover(server, acct) {
  const base = server.replace(/\/+$/, "");
  const P1 = '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>';
  let princ = "", r;
  for (const u of [base + "/.well-known/caldav", base + "/"]) {
    try { r = await dav("PROPFIND", u, acct, P1, 0); const h = hrefIn(r.text, "current-user-principal"); if (h) { princ = abs(r.url, h); break; } }
    catch (e) { if (/Passwort|Verbindung/.test(e.message)) throw e; }
  }
  if (!princ) princ = base + "/";
  const P2 = '<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><c:calendar-home-set/></d:prop></d:propfind>';
  r = await dav("PROPFIND", princ, acct, P2, 0);
  const home = hrefIn(r.text, "calendar-home-set");
  const homeUrl = home ? abs(r.url, home) : princ;
  const P3 = '<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:a="http://apple.com/ns/ical/"><d:prop><d:resourcetype/><d:displayname/><a:calendar-color/><c:supported-calendar-component-set/><d:current-user-privilege-set/></d:prop></d:propfind>';
  r = await dav("PROPFIND", homeUrl, acct, P3, 1);
  const out = [];
  tags(xml(r.text), "response").forEach(resp => {
    const rt = tags(resp, "resourcetype")[0];
    if (!rt || !tags(rt, "calendar").length) return;
    const comps = tags(resp, "comp").map(c => c.getAttribute("name"));
    if (comps.length && !comps.includes("VEVENT")) return;
    const privs = tags(resp, "privilege").map(p => p.firstElementChild && p.firstElementChild.localName);
    const ro = privs.length ? !(privs.includes("write") || privs.includes("write-content") || privs.includes("all")) : false;
    out.push({ url: abs(r.url, txt(resp, "href")), name: txt(resp, "displayname") || "Kalender", color: (txt(resp, "calendar-color") || "").slice(0, 7), ro });
  });
  if (!out.length) throw new Error("Keine Kalender gefunden. Stimmt die Server-Adresse?");
  return out;
}

/* ---------- iCalendar lesen ---------- */
const WINTZ = { "W. Europe Standard Time": "Europe/Zurich", "Central Europe Standard Time": "Europe/Budapest", "Romance Standard Time": "Europe/Paris",
  "Central European Standard Time": "Europe/Warsaw", "GMT Standard Time": "Europe/London", "UTC": "UTC", "Coordinated Universal Time": "UTC",
  "Eastern Standard Time": "America/New_York", "Pacific Standard Time": "America/Los_Angeles", "Central Standard Time": "America/Chicago" };
function tzOff(tz, ms) {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const p = {}; f.formatToParts(new Date(ms)).forEach(x => p[x.type] = x.value);
  return Date.UTC(+p.year, p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - ms;
}
function zoned(y, mo, d, h, mi, tz) {
  tz = WINTZ[tz] || String(tz).replace(/^\/[^/]*\/[^/]*\//, "");
  try { const g = Date.UTC(y, mo - 1, d, h, mi); let u = g - tzOff(tz, g); u = g - tzOff(tz, u); return new Date(u); }
  catch (e) { return new Date(y, mo - 1, d, h, mi); }
}
const unesc = s => String(s || "").replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1");
function parseICS(text) {
  const lines = text.replace(/\r\n?/g, "\n").replace(/\n[ \t]/g, "").split("\n");
  const evs = []; let cur = null, inAlarm = false, depth = 0;
  for (const L of lines) {
    if (L === "BEGIN:VEVENT") { cur = { p: {}, ex: [], alarm: null }; continue; }
    if (L === "END:VEVENT") { if (cur) evs.push(cur); cur = null; continue; }
    if (!cur) continue;
    if (L.startsWith("BEGIN:")) { depth++; inAlarm = L === "BEGIN:VALARM"; continue; }
    if (L.startsWith("END:")) { depth--; inAlarm = false; continue; }
    const m = L.match(/^([A-Za-z0-9-]+)((?:;(?:[^:"]|"[^"]*")*)?):(.*)$/);
    if (!m) continue;
    const name = m[1].toUpperCase(), params = {};
    (m[2].match(/;[^;=]+=(?:"[^"]*"|[^;]*)/g) || []).forEach(x => { const i = x.indexOf("="); params[x.slice(1, i).toUpperCase()] = x.slice(i + 1).replace(/^"|"$/g, ""); });
    if (inAlarm || depth > 0) { if (inAlarm && name === "TRIGGER" && cur.alarm == null) cur.alarm = { v: m[3], params }; continue; }
    if (name === "EXDATE") { m[3].split(",").forEach(v => cur.ex.push({ v, params })); continue; }
    cur.p[name] = { v: m[3], params };
  }
  return evs;
}
function icsDate(o) {
  if (!o) return null;
  const v = o.v.trim();
  if (o.params.VALUE === "DATE" || /^\d{8}$/.test(v)) return { d: v.slice(0, 4) + "-" + v.slice(4, 6) + "-" + v.slice(6, 8), t: null };
  const m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/);
  if (!m) return null;
  let dt;
  if (m[7]) dt = new Date(Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5]));
  else if (o.params.TZID) dt = zoned(+m[1], +m[2], +m[3], +m[4], +m[5], o.params.TZID);
  else dt = new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5]);
  return { d: K.ymd(dt), t: K.toMin(dt.getHours() * 60 + dt.getMinutes()), dt };
}
function durMin(v) { const m = /^(-)?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(v || ""); if (!m) return null;
  return (m[1] ? -1 : 1) * ((+m[2] || 0) * 10080 + (+m[3] || 0) * 1440 + (+m[4] || 0) * 60 + (+m[5] || 0)); }
function hash(s) { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; return h.toString(36); }
const WDN = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

/* Wiederholregel: einfache Regeln werden zu Serien in der App, komplizierte werden aufgefaltet (nur lesen) */
function ruleOf(r) { const o = {}; r.split(";").forEach(x => { const [k, v] = x.split("="); o[k.toUpperCase()] = v; }); o.iv = +(o.INTERVAL || 1); o.by = (o.BYDAY || "").split(",").filter(Boolean); return o; }
function simpleRep(o, start) {
  if (o.COUNT || o.BYSETPOS || o.BYMONTHDAY || o.BYMONTH || o.BYYEARDAY || o.BYWEEKNO) return null;
  const wd = WDN[start.getDay()];
  if (o.FREQ === "DAILY" && o.iv === 1 && !o.by.length) return "d";
  if (o.FREQ === "WEEKLY") {
    if (o.iv === 1 && o.by.length === 5 && ["MO", "TU", "WE", "TH", "FR"].every(d => o.by.includes(d))) return "wd";
    if (!o.by.length || (o.by.length === 1 && o.by[0] === wd)) return o.iv === 1 ? "w" : o.iv === 2 ? "w2" : null;
  }
  if (o.FREQ === "MONTHLY" && o.iv === 1 && !o.by.length) return "m";
  if (o.FREQ === "YEARLY" && o.iv === 1 && !o.by.length) return "y";
  return null;
}
function matchDay(d, st, o) {
  if (d < st) return false;
  const wd = WDN[d.getDay()], days = Math.round((d - st) / 864e5);
  const byWd = o.by.map(x => x.replace(/^[+-]?\d+/, ""));
  switch (o.FREQ) {
    case "DAILY": return days % o.iv === 0 && (!o.by.length || byWd.includes(wd));
    case "WEEKLY": { const mon = x => { const y = new Date(x); y.setDate(y.getDate() - (y.getDay() + 6) % 7); return y; };
      const w = Math.round((mon(d) - mon(st)) / 6048e5); return w % o.iv === 0 && (o.by.length ? byWd.includes(wd) : d.getDay() === st.getDay()); }
    case "MONTHLY": case "YEARLY": {
      const mdiff = (d.getFullYear() - st.getFullYear()) * 12 + d.getMonth() - st.getMonth();
      if (o.FREQ === "MONTHLY" && mdiff % o.iv) return false;
      if (o.FREQ === "YEARLY") { if ((d.getFullYear() - st.getFullYear()) % o.iv) return false;
        const months = o.BYMONTH ? o.BYMONTH.split(",").map(Number) : [st.getMonth() + 1]; if (!months.includes(d.getMonth() + 1)) return false; }
      if (o.BYMONTHDAY) { const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
        return o.BYMONTHDAY.split(",").map(Number).some(n => (n > 0 ? n : last + 1 + n) === d.getDate()); }
      if (o.by.length) {
        const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
        const nth = Math.ceil(d.getDate() / 7), nthBack = -Math.ceil((last - d.getDate() + 1) / 7);
        const ok = o.by.some(x => { const m = /^([+-]?\d+)?(\w\w)$/.exec(x); if (!m || m[2] !== wd) return false; if (!m[1]) return true; const n = +m[1]; return n === nth || n === nthBack; });
        if (!ok) return false;
        if (o.BYSETPOS) { // z. B. letzter Werktag im Monat
          const all = []; for (let i = 1; i <= last; i++) { const x = new Date(d.getFullYear(), d.getMonth(), i); if (byWd.includes(WDN[x.getDay()])) all.push(i); }
          return o.BYSETPOS.split(",").map(Number).some(p => all[p > 0 ? p - 1 : all.length + p] === d.getDate());
        }
        return true;
      }
      return d.getDate() === st.getDate();
    }
  }
  return false;
}

/* Ein VEVENT-Paket (eine .ics-Ressource) in App-Termine umwandeln */
function toEvents(list, cal, meta, win) {
  const out = [], master = list.find(v => !v.p["RECURRENCE-ID"]), overrides = list.filter(v => v.p["RECURRENCE-ID"]);
  const lock = overrides.length > 0;
  const conv = (v, extra) => {
    const p = v.p, s = icsDate(p.DTSTART); if (!s) return null;
    let e = icsDate(p.DTEND);
    if (!e && p.DURATION) { const dm = durMin(p.DURATION.v); if (dm != null) { if (s.t) { const dt = new Date(s.dt.getTime() + dm * 6e4); e = { d: K.ymd(dt), t: K.toMin(dt.getHours() * 60 + dt.getMinutes()) }; } else e = { d: K.ymd(K.addDays(K.parse(s.d), Math.max(1, Math.round(dm / 1440)))), t: null }; } }
    const uid = (p.UID && p.UID.v) || hash(JSON.stringify(p));
    const rid = p["RECURRENCE-ID"] ? p["RECURRENCE-ID"].v : "";
    const ev = { id: "r" + hash(cal.id + "|" + uid + "|" + rid + (extra && extra.occ ? "|" + extra.occ : "")), uid, cal: cal.id,
      title: unesc(p.SUMMARY && p.SUMMARY.v) || "(ohne Titel)", date: s.d, loc: unesc(p.LOCATION && p.LOCATION.v), notes: unesc(p.DESCRIPTION && p.DESCRIPTION.v) };
    if (!s.t) { ev.allDay = true; ev.start = ""; ev.end = ""; const ed = e && e.d > s.d ? K.ymd(K.addDays(K.parse(e.d), -1)) : s.d; if (ed > s.d) ev.edate = ed; }
    else {
      ev.start = s.t;
      if (!e) ev.end = K.toMin(Math.min(24 * 60 - 1, K.mins(s.t) + 60));
      else if (e.d > s.d) ev.end = "23:59";
      else ev.end = e.t;
      if (K.mins(ev.end) <= K.mins(ev.start)) ev.end = K.toMin(Math.min(24 * 60 - 1, K.mins(ev.start) + 15));
    }
    if (v.alarm) { const dm = durMin(v.alarm.v); if (dm != null && dm <= 0) ev.remind = -dm; }
    if (p.TRANSP && p.TRANSP.v === "TRANSPARENT") ev.free = true;
    if (meta) Object.assign(ev, meta);
    return Object.assign(ev, extra || {});
  };
  if (!master) { overrides.forEach(v => { const e = conv(v, { lock: true }); if (e) out.push(e); }); return out; }
  const base = conv(master); if (!base) return out;
  const rr = master.p.RRULE && master.p.RRULE.v;
  if (!rr) { if (lock) base.lock = true; out.push(base); overrides.forEach(v => { const e = conv(v, { lock: true }); if (e) out.push(e); }); return out; }
  const o = ruleOf(rr), st = K.parse(base.date);
  const exd = master.ex.map(x => { const d = icsDate(x); return d && d.d; }).filter(Boolean);
  overrides.forEach(v => { const d = icsDate(v.p["RECURRENCE-ID"]); if (d) exd.push(d.d); });
  const until = o.UNTIL ? o.UNTIL.slice(0, 4) + "-" + o.UNTIL.slice(4, 6) + "-" + o.UNTIL.slice(6, 8) : null;
  const f = simpleRep(o, st);
  if (f && !lock) { base.rep = { f, until, ex: exd }; out.push(base); }
  else {
    // auffalten im Zeitfenster (nur lesen in der App, bearbeiten beim Anbieter)
    let n = 0; const end = win.b, startScan = o.COUNT ? st : (win.a > st ? win.a : st);
    if (o.COUNT) { for (let d = new Date(st); d <= end && n < +o.COUNT; d = K.addDays(d, 1)) if (matchDay(d, st, o)) { n++; push(d); } }
    else for (let d = new Date(startScan); d <= end; d = K.addDays(d, 1)) { if (until && K.ymd(d) > until) break; if (matchDay(d, st, o)) push(d); }
    function push(d) { const ds = K.ymd(d); if (exd.includes(ds) || ds < K.ymd(win.a)) return; const span = base.edate ? Math.round((K.parse(base.edate) - st) / 864e5) : 0;
      out.push(Object.assign({}, base, { id: base.id + "x" + ds.replace(/-/g, ""), date: ds, edate: span ? K.ymd(K.addDays(d, span)) : undefined, lock: true })); }
  }
  overrides.forEach(v => { const e = conv(v, { lock: true }); if (e) out.push(e); });
  return out;
}
function groupByUid(vs) { const g = {}; vs.forEach(v => { const u = (v.p.UID && v.p.UID.v) || Math.random(); (g[u] = g[u] || []).push(v); }); return Object.values(g); }

/* ---------- iCalendar schreiben ---------- */
const icsEsc = t => String(t || "").replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/([,;])/g, "\\$1");
function fold(line) { const out = []; let s = line; while (s.length > 73) { out.push(s.slice(0, 73)); s = " " + s.slice(73); } out.push(s); return out.join("\r\n"); }
const VTZ_ZRH = ["BEGIN:VTIMEZONE", "TZID:Europe/Zurich", "BEGIN:DAYLIGHT", "TZOFFSETFROM:+0100", "TZOFFSETTO:+0200", "TZNAME:CEST", "DTSTART:19700329T020000", "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU", "END:DAYLIGHT",
  "BEGIN:STANDARD", "TZOFFSETFROM:+0200", "TZOFFSETTO:+0100", "TZNAME:CET", "DTSTART:19701025T030000", "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU", "END:STANDARD", "END:VTIMEZONE"];
const pad = n => String(n).padStart(2, "0");
const dOnly = ds => ds.replace(/-/g, "");
function utcStamp(d) { return d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) + "T" + pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds()) + "Z"; }
function dtLine(name, ds, t) {
  if (LOCAL_TZ === "Europe/Zurich") return `${name};TZID=Europe/Zurich:${dOnly(ds)}T${t.replace(":", "")}00`;
  const [h, m] = t.split(":").map(Number), d = K.parse(ds); d.setHours(h, m, 0, 0); return `${name}:${utcStamp(d)}`;
}
function buildICS(e) {
  const uid = e.uid || (e.id + "@kachelkalender");
  const L = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Kachelkalender//Kachelkalender 0.1//DE", "CALSCALE:GREGORIAN"];
  if (!e.allDay && LOCAL_TZ === "Europe/Zurich") L.push(...VTZ_ZRH);
  L.push("BEGIN:VEVENT", "UID:" + uid, "DTSTAMP:" + utcStamp(new Date()));
  if (e.allDay) { L.push("DTSTART;VALUE=DATE:" + dOnly(e.date), "DTEND;VALUE=DATE:" + dOnly(K.ymd(K.addDays(K.parse(e.edate || e.date), 1)))); }
  else { L.push(dtLine("DTSTART", e.date, e.start), dtLine("DTEND", e.date, e.end)); }
  L.push("SUMMARY:" + icsEsc(e.title));
  if (e.loc) L.push("LOCATION:" + icsEsc(e.loc));
  if (e.notes) L.push("DESCRIPTION:" + icsEsc(e.notes));
  if (e.free) L.push("TRANSP:TRANSPARENT");
  if (e.rep) {
    const RR = { d: "FREQ=DAILY", wd: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR", w: "FREQ=WEEKLY", w2: "FREQ=WEEKLY;INTERVAL=2", m: "FREQ=MONTHLY", y: "FREQ=YEARLY" }[e.rep.f];
    if (RR) {
      let u = "";
      if (e.rep.until) u = e.allDay ? ";UNTIL=" + dOnly(e.rep.until) : ";UNTIL=" + (() => { const d = K.parse(e.rep.until); d.setHours(23, 59, 59); return utcStamp(d); })();
      L.push("RRULE:" + RR + u);
      (e.rep.ex || []).forEach(ds => L.push(e.allDay ? "EXDATE;VALUE=DATE:" + dOnly(ds) : dtLine("EXDATE", ds, e.start)));
    }
  }
  if (e.remind != null && e.remind >= 0) L.push("BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:" + icsEsc(e.title), "TRIGGER:-PT" + e.remind + "M", "END:VALARM");
  L.push("END:VEVENT", "END:VCALENDAR");
  return L.map(fold).join("\r\n") + "\r\n";
}
const sig = e => JSON.stringify([e.title, e.date, e.edate || "", !!e.allDay, e.start || "", e.end || "", e.loc || "", e.notes || "", e.rep || null, e.remind == null ? null : e.remind, e.cal, !!e.free]);

/* ---------- Kalender hinzufügen ---------- */
window.KK_connect = async ({ type, name, color, f }) => {
  if (type === "ms") throw new Error(window.KK_note(type, {}));
  const S = K.S;
  if (type === "ics") {
    let url = (f.url || "").trim().replace(/^webcal:\/\//i, "https://");
    if (!/^https:\/\//i.test(url)) throw new Error("Bitte einen Link einfügen, der mit https:// oder webcal:// beginnt.");
    const cal = { id: "c" + K.uid(), name, src: K.SRC.ics, type: "ics", color, on: true, ro: true, url };
    const n = await pullIcs(cal, true);
    S.cals.push(cal); K.save(); K.render(); status();
    return `${name}: ${n} Termine geladen`;
  }
  const server = (f.server || SERVERS[type] || "").trim();
  if (!/^https:\/\//i.test(server)) throw new Error("Bitte die Server-Adresse mit https:// angeben.");
  if (!f.user || !f.pass) throw new Error("Bitte Benutzername und App-Passwort eingeben.");
  const acct = "a" + K.uid(), all = sec(); all[acct] = { user: f.user, pass: f.pass, server }; setSec(all);
  let found;
  try { found = await discover(server, acct); }
  catch (e) { const a = sec(); delete a[acct]; setSec(a); throw e; }
  const used = S.cals.map(c => c.color);
  const added = found.map((c, i) => {
    const col = i === 0 ? color : (K.PALETTE.find(p => !used.includes(p) && p !== color) || c.color || color); used.push(col);
    return { id: "c" + K.uid(), name: found.length === 1 ? name : c.name, src: K.SRC[type] + (c.ro ? " · nur lesen" : ""), type, acct, url: c.url, color: col, on: true, ro: c.ro };
  });
  S.cals.push(...added); K.save();
  for (const cal of added) { try { await pullDav(cal); } catch (e) { lastErr = cal.name + ": " + e.message; } }
  K.save(); K.render(); status();
  return found.length === 1 ? `${name} ist verbunden` : `${found.length} Kalender gefunden: ${found.map(c => c.name).join(", ")}`;
};

/* ---------- Abgleich ---------- */
const win = () => ({ a: K.addDays(new Date(), -120), b: K.addDays(new Date(), 400) });
function keepLocal(oldList, fresh) { // Hervorhebungen bleiben erhalten
  const hl = new Set(oldList.filter(e => e.hl).map(e => e.id));
  fresh.forEach(e => { if (hl.has(e.id)) e.hl = true; });
}
async function pullIcs(cal, first) {
  let r;
  try { r = await hfetch(cal.url, { method: "GET", headers: { Accept: "text/calendar" } }); }
  catch (e) { throw new Error("Der Abo-Link ist nicht erreichbar."); }
  if (r.status >= 400) throw new Error("Der Abo-Link antwortet mit Fehler " + r.status + ".");
  const t = await r.text();
  if (!/BEGIN:VCALENDAR/i.test(t)) throw new Error("Unter diesem Link ist kein Kalender (.ics).");
  const w = win(), fresh = [];
  groupByUid(parseICS(t)).forEach(g => fresh.push(...toEvents(g, cal, null, w)));
  const S = K.S, old = S.ev.filter(e => e.cal === cal.id);
  keepLocal(old, fresh);
  S.ev = S.ev.filter(e => e.cal !== cal.id).concat(fresh);
  return fresh.length;
}
const REPORT = (a, b) => `<?xml version="1.0"?><c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:getetag/><c:calendar-data/></d:prop><c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"><c:time-range start="${a}" end="${b}"/></c:comp-filter></c:comp-filter></c:filter></c:calendar-query>`;
async function pullDav(cal) {
  const w = win(), r = await dav("REPORT", cal.url, cal.acct, REPORT(utcStamp(w.a), utcStamp(w.b)), 1);
  const S = K.S, fresh = [], seen = new Set();
  tags(xml(r.text), "response").forEach(resp => {
    const data = txt(resp, "calendar-data"); if (!data) return;
    const href = abs(r.url, txt(resp, "href")), etag = txt(resp, "getetag");
    seen.add(href);
    groupByUid(parseICS(data)).forEach(g => toEvents(g, cal, { rh: href, et: etag, rcal: cal.id }, w).forEach(e => { e.rsig = sig(e); fresh.push(e); }));
  });
  const mine = S.ev.filter(e => e.cal === cal.id || e.rcal === cal.id);
  const dirty = mine.filter(e => !e.rh || e.rsig !== sig(e));          // lokale Änderungen, die noch hochgeladen werden
  const dirtyHref = new Set(dirty.map(e => e.rh).filter(Boolean));
  const keep = fresh.filter(e => !dirtyHref.has(e.rh));
  keepLocal(mine, keep);
  S.ev = S.ev.filter(e => !(e.cal === cal.id || e.rcal === cal.id)).concat(keep, dirty);
  cal.known = [...seen];
}
async function pushDav() {
  const S = K.S;
  for (const cal of S.cals.filter(c => c.acct && !c.ro)) {
    const known = new Set(cal.known || []), alive = new Set();
    for (const e of S.ev.filter(x => x.cal === cal.id && !x.lock)) {
      if (e.rh && e.rcal === cal.id && e.rsig === sig(e)) { alive.add(e.rh); continue; }
      if (e.rh && e.rcal && e.rcal !== e.cal) { // in einen anderen Kalender verschoben: dort löschen
        const old = S.cals.find(c => c.id === e.rcal); if (old && old.acct) { try { await dav("DELETE", e.rh, old.acct, null, null, e.et ? { "If-Match": e.et } : {}); } catch (err) { if (!err.conflict) throw err; } }
        delete e.rh; delete e.et;
      }
      const href = e.rh || (cal.url.replace(/\/?$/, "/") + encodeURIComponent((e.uid || e.id + "@kachelkalender").replace(/[^\w@.-]/g, "_")) + ".ics");
      const hdr = { "Content-Type": "text/calendar; charset=utf-8" };
      if (e.rh && e.et) hdr["If-Match"] = e.et; else if (!e.rh) hdr["If-None-Match"] = "*";
      try {
        const r = await dav("PUT", href, cal.acct, buildICS(e), null, hdr);
        if (!e.uid) e.uid = e.id + "@kachelkalender";
        e.rh = href; e.et = r.etag || ""; e.rcal = cal.id; e.rsig = sig(e); alive.add(href);
      } catch (err) {
        if (err.conflict) { e.rsig = sig(e); K.toast("Termin wurde woanders geändert", e.title + ": die Version vom Server gilt"); }
        else throw err;
      }
    }
    // lokal gelöschte Termine auch beim Anbieter löschen
    const still = new Set(S.ev.filter(x => x.rh).map(x => x.rh));
    for (const h of known) if (!still.has(h)) { await dav("DELETE", h, cal.acct, null, null, {}); }
    cal.known = [...new Set([...alive, ...[...known].filter(h => still.has(h))])];
  }
}
function forget() { // Zugangsdaten entfernter Kalender löschen
  const S = K.S, used = new Set(S.cals.map(c => c.acct).filter(Boolean)), a = sec();
  let ch = false; Object.keys(a).forEach(k => { if (!used.has(k)) { delete a[k]; ch = true; } }); if (ch) setSec(a);
}
function queue(job) { busy = busy.then(job, job); return busy; }
let pushT = 0, saving = false;
window.KK_onSave = () => {
  if (!K || saving) return;
  clearTimeout(pushT);
  pushT = setTimeout(() => queue(async () => {
    forget();
    if (!K.S.cals.some(c => c.acct && !c.ro)) { scheduleReminders(); return; }
    try { await pushDav(); lastErr = null; lastSync = new Date(); }
    catch (e) { lastErr = e.message; }
    saving = true; K.save(); saving = false; status(); scheduleReminders();
  }), 1200);
};
async function syncAll(manual) {
  return queue(async () => {
    if (!navigator.onLine) { offline = true; status(); return; }
    offline = false;
    const S = K.S, errs = [];
    try { if (S.cals.some(c => c.acct && !c.ro)) await pushDav(); } catch (e) { errs.push(e.message); }
    for (const cal of S.cals) {
      try { if (cal.type === "ics" && cal.url) await pullIcs(cal); else if (cal.acct) await pullDav(cal); }
      catch (e) { errs.push(cal.name + ": " + e.message); }
    }
    lastErr = errs[0] || null; lastSync = new Date();
    saving = true; K.save(); saving = false; K.render(); status(); scheduleReminders();
    if (manual) K.toast(errs.length ? "Abgleich mit Fehlern" : "Alles abgeglichen", errs[0] || null);
  });
}

/* ---------- Anzeige unten in der Seitenleiste ---------- */
function status() {
  const dot = document.getElementById("net-dot"), t = document.getElementById("net-text"); if (!dot || !t) return;
  const remote = K.S.cals.some(c => c.acct || c.url);
  dot.classList.toggle("off", offline || !!lastErr);
  t.textContent = offline ? "Offline · Änderungen werden später übertragen"
    : lastErr ? "⚠ " + lastErr
    : !remote ? "Nur auf diesem Gerät · tippe «+ Kalender hinzufügen»"
    : lastSync ? `Abgeglichen ${pad(lastSync.getHours())}:${pad(lastSync.getMinutes())} · tippen zum Aktualisieren` : "Wird abgeglichen …";
}

/* ---------- Erinnerungen ---------- */
const fired = new Set();
function upcoming(hours) {
  const S = K.S, now = Date.now(), lim = now + hours * 36e5, out = [];
  K.visible().forEach(e => {
    if (e.allDay) return;
    const r = e.remind != null ? e.remind : S.set.remind; if (r == null || r < 0) return;
    const [h, m] = (e.start || "0:0").split(":").map(Number), d = K.parse(e.date); d.setHours(h, m, 0, 0);
    const at = d.getTime() - r * 6e4; if (at > now - 6e4 && at <= lim) out.push({ e, at, start: d });
  });
  return out.sort((a, b) => a.at - b.at);
}
const body = x => `${x.e.start}–${x.e.end}${x.e.loc ? " · " + x.e.loc : ""}`;
let remT = 0;
async function scheduleReminders() {
  if (!IS_ANDROID || !T.notification) return;
  clearTimeout(remT);
  remT = setTimeout(async () => {
    try {
      await T.notification.cancelAll();
      upcoming(24 * 7).slice(0, 60).forEach((x, i) => {
        if (x.at <= Date.now()) return;
        T.notification.sendNotification({ id: 1000 + i, title: x.e.title, body: body(x), schedule: { at: { date: new Date(x.at), repeating: false, allowWhileIdle: true }, interval: undefined, every: undefined } });
      });
    } catch (e) { /* Erinnerungen sind optional */ }
  }, 800);
}
function desktopTick() {
  if (IS_ANDROID || !T.notification) return;
  upcoming(0.05).forEach(x => {
    const k = x.e.id + "|" + x.at; if (fired.has(k) || x.at > Date.now()) return; fired.add(k);
    try { T.notification.sendNotification({ title: x.e.title, body: body(x) }); } catch (e) {}
  });
}

/* ---------- Start ---------- */
window.KK_APP = k => {
  K = k;
  const sync = document.querySelector(".sync"); if (sync) { sync.style.cursor = "pointer"; sync.title = "Jetzt abgleichen"; sync.addEventListener("click", () => syncAll(true)); }
  const prot = document.querySelector(".proto"); if (prot) prot.remove();
  status();
  (async () => { try { if (T.notification && !(await T.notification.isPermissionGranted())) await T.notification.requestPermission(); } catch (e) {} })();
  setTimeout(() => syncAll(false), 600);
  setInterval(() => syncAll(false), 15 * 60e3);
  setInterval(desktopTick, 30e3);
  addEventListener("online", () => syncAll(false));
  addEventListener("offline", () => { offline = true; status(); });
  document.addEventListener("visibilitychange", () => { if (!document.hidden && (!lastSync || Date.now() - lastSync > 5 * 60e3)) syncAll(false); });
  scheduleReminders();
};

// für Tests ohne App
window.KK_TEST = { parseICS, toEvents, groupByUid, buildICS, matchDay, ruleOf, simpleRep, sig, setK: k => K = k, K: () => K, sync: m => syncAll(m) };
})();
