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
  ms: "Liest und schreibt deinen Outlook-Kalender in beide Richtungen. Die Client-ID bekommst du von deiner IT (siehe E-Mail-Vorlage). Nach «Hinzufügen» zeigt die App einen Code: im Browser auf microsoft.com/devicelogin einfügen und mit deinem Konto anmelden. Zugangsdaten bleiben nur auf diesem Gerät.",
  msr: "Zeigt deinen Outlook-Kalender an (nur lesen). Die Client-ID bekommst du von deiner IT. Nach «Hinzufügen» zeigt die App einen Code: im Browser auf microsoft.com/devicelogin einfügen und anmelden. Wenn die IT später auch das Schreiben freigibt, den Kalender entfernen und als «Microsoft / Outlook» neu hinzufügen.",
  ics: "Nur lesen. Wird beim Öffnen und alle 15 Minuten aktualisiert.",
  local: "Termine bleiben nur auf diesem Gerät."
}[k] || (t.note + " Zugangsdaten bleiben nur auf diesem Gerät."));

/* ---------- Speicher für Zugangsdaten (getrennt von den Terminen) ---------- */
const sec = () => { try { return JSON.parse(localStorage.getItem(SEC)) || {}; } catch (e) { return {}; } };
const setSec = o => { try { localStorage.setItem(SEC, JSON.stringify(o)); } catch (e) {} };

/* ---------- Netzwerk ---------- */
// Links aus Terminen im Browser bzw. in der passenden App öffnen (Teams, Zoom, E-Mail …)
window.KK_openUrl = u => { if (T.opener && T.opener.openUrl) return T.opener.openUrl(u); window.open(u, "_blank", "noopener"); };
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
    if (p.URL && p.URL.v) ev.url = unesc(p.URL.v);
    if (!s.t) { ev.allDay = true; ev.start = ""; ev.end = ""; const ed = e && e.d > s.d ? K.ymd(K.addDays(K.parse(e.d), -1)) : s.d; if (ed > s.d) ev.edate = ed; }
    else {
      ev.start = s.t;
      if (!e) ev.end = K.toMin(Math.min(24 * 60 - 1, K.mins(s.t) + 60));
      else if (e.d > s.d) { if (e.t === "00:00" && K.ymd(K.addDays(K.parse(s.d), 1)) === e.d) ev.end = "23:59"; else { ev.end = e.t; ev.edate = e.d; } }
      else ev.end = e.t;
      if (!ev.edate && K.mins(ev.end) <= K.mins(ev.start)) ev.end = K.toMin(Math.min(24 * 60 - 1, K.mins(ev.start) + 15));
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
  else { L.push(dtLine("DTSTART", e.date, e.start), dtLine("DTEND", e.edate && e.edate > e.date ? e.edate : e.date, e.end)); }
  L.push("SUMMARY:" + icsEsc(e.title));
  if (e.loc) L.push("LOCATION:" + icsEsc(e.loc));
  if (e.notes) L.push("DESCRIPTION:" + icsEsc(e.notes));
  if (e.url) L.push("URL:" + e.url);
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
  if (type === "ms" || type === "msr") return connectMs({ name, color, f, ro: type === "msr" });
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
function keepLocal(oldList, fresh) { // Hervorhebungen und zweite Erinnerung bleiben erhalten
  const hl = new Set(oldList.filter(e => e.hl).map(e => e.id)), r2 = new Map(oldList.filter(e => e.remind2 != null).map(e => [e.id, e.remind2]));
  fresh.forEach(e => { if (hl.has(e.id)) e.hl = true; if (r2.has(e.id)) e.remind2 = r2.get(e.id); });
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
  for (const cal of S.cals.filter(c => c.acct && !c.ro && c.type !== "ms")) {
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
/* ---------- Microsoft 365 / Outlook (Microsoft Graph) ----------
   Anmeldung mit Code (Device Code Flow): Die App zeigt einen Code, du meldest dich im Browser bei Microsoft an.
   Danach spricht die App direkt mit Microsoft (graph.microsoft.com). Kein eigener Server dazwischen.
   Berechtigungen: nur der eigene Kalender (Calendars.ReadWrite), Anmeldung (User.Read), angemeldet bleiben (offline_access). */
const MS_SCOPE = "offline_access User.Read Calendars.ReadWrite";
const msAuth = t => `https://login.microsoftonline.com/${encodeURIComponent(t)}/oauth2/v2.0/`;
const form = o => Object.entries(o).map(([k, v]) => encodeURIComponent(k) + "=" + encodeURIComponent(v)).join("&");
function msErr(j) {
  const d = (j && (j.error_description || j.error)) || "";
  if (/AADSTS700016/.test(d)) return "Diese Client-ID kennt die Organisation nicht. Bitte bei der IT nachfragen.";
  if (/AADSTS7000218|AADSTS70002\b/.test(d)) return "Die IT muss in der App-Registrierung «Öffentliche Clientflows zulassen» einschalten.";
  if (/AADSTS65001|AADSTS90094|AADSTS90008|AADSTS50105|consent/i.test(d)) return "Die IT muss die App noch freigeben (Administratorzustimmung).";
  if (/AADSTS50059|AADSTS90002|AADSTS900023/.test(d)) return "Die Organisation wurde nicht gefunden. Stimmt die E-Mail-Adresse?";
  if (/AADSTS53003|AADSTS53000/.test(d)) return "Die Organisation erlaubt die Anmeldung von diesem Gerät nicht (Richtlinie der IT).";
  if (j && j.error === "expired_token") return "Der Code ist abgelaufen. Bitte nochmals «Hinzufügen» tippen.";
  if (j && j.error === "authorization_declined") return "Die Anmeldung wurde abgebrochen.";
  return "Microsoft meldet: " + (d.split(/\r?\n/)[0] || "unbekannter Fehler");
}
async function msPost(url, body) {
  let r;
  try { r = await hfetch(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form(body) }); }
  catch (e) { throw new Error("Keine Verbindung zu Microsoft."); }
  let j = {}; try { j = await r.json(); } catch (e) {}
  return { ok: r.status < 400, j };
}
async function msToken(acct) {
  const a = sec()[acct]; if (!a || !a.rt) throw new Error("Bitte das Microsoft-Konto neu verbinden.");
  if (a.at && a.exp > Date.now() + 60e3) return a.at;
  const { ok, j } = await msPost(msAuth(a.tenant) + "token", { client_id: a.client, grant_type: "refresh_token", refresh_token: a.rt, scope: a.scope || MS_SCOPE });
  if (!ok) throw new Error(j.error === "invalid_grant" && !/AADSTS65001/.test(j.error_description || "") ? "Microsoft-Anmeldung abgelaufen. Bitte den Kalender entfernen und neu verbinden." : msErr(j));
  const all = sec(); Object.assign(all[acct], { at: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1e3, rt: j.refresh_token || a.rt }); setSec(all);
  return j.access_token;
}
async function graph(acct, method, path, body) {
  const url = /^https:/.test(path) ? path : "https://graph.microsoft.com/v1.0" + path;
  const go = async tok => {
    try { return await hfetch(url, { method, headers: { Authorization: "Bearer " + tok, "Content-Type": "application/json", Prefer: 'outlook.timezone="UTC"' }, body: body ? JSON.stringify(body) : undefined }); }
    catch (e) { throw new Error("Keine Verbindung zu Microsoft."); }
  };
  let r = await go(await msToken(acct));
  if (r.status === 401) { const all = sec(); if (all[acct]) { all[acct].exp = 0; setSec(all); } r = await go(await msToken(acct)); }
  if (method === "DELETE" && (r.status === 404 || r.status === 410)) return null;
  if (r.status === 403) throw new Error("Kein Zugriff auf den Outlook-Kalender. Die IT muss die App freigeben.");
  if (r.status >= 400) { let j = {}; try { j = await r.json(); } catch (e) {} throw new Error("Microsoft meldet Fehler " + r.status + (j.error && j.error.message ? ": " + j.error.message : "") + "."); }
  if (r.status === 204 || r.status === 202) return null;
  try { return await r.json(); } catch (e) { return null; }
}
function showMsCode(code, uri, email) {
  const n = document.getElementById("cal-note"); if (!n) return;
  const host = String(uri || "https://microsoft.com/devicelogin").replace(/^https?:\/\//, "");
  n.innerHTML = `<div class="mscode"><span>1. Dieser Code ist schon kopiert:</span><b class="num">${code}</b>
    <span>2. Im Browser öffnen: <b>${host}</b></span><span>3. Code einfügen und mit <b>${String(email).replace(/[<>&"]/g, "")}</b> anmelden. Danach hierher zurückkommen, der Rest geht automatisch.</span>
    <button type="button" class="btn" id="ms-copy">Code nochmals kopieren</button></div>`;
  const b = document.getElementById("ms-copy");
  if (b) b.onclick = async () => { try { await navigator.clipboard.writeText(code); b.textContent = "Kopiert ✓"; } catch (e) { b.textContent = "Code: " + code; } };
  const s = document.getElementById("cal-save"); if (s) s.textContent = "Warte auf Anmeldung …";
}
const MS_SCOPE_RO = "offline_access User.Read Calendars.Read";
async function connectMs({ name, color, f, ro }) {
  const scope = ro ? MS_SCOPE_RO : MS_SCOPE;
  const email = (f.user || "").trim(), client = (f.client || "").replace(/[\s\u200b-\u200d\ufeff{}]/g, "").replace(/[‐-―−]/g, "-");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("Bitte deine E-Mail-Adresse eingeben.");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(client)) {
    const parts = client.split("-"), want = [8, 4, 4, 4, 12], names = ["erste", "zweite", "dritte", "vierte", "fünfte"];
    let why = "";
    if (!client) why = "Das Feld ist leer.";
    else if (/[^0-9a-f-]/i.test(client)) why = "Sie enthält Zeichen, die nicht passen (nur 0–9 und a–f sind erlaubt): «" + client.replace(/[0-9a-f-]/gi, "") + "».";
    else if (parts.length !== 5) why = "Sie hat " + parts.length + " statt 5 Teile.";
    else { const i = parts.findIndex((x, k) => x.length !== want[k]); if (i >= 0) why = "Der " + names[i] + " Teil «" + parts[i] + "» hat " + parts[i].length + " statt " + want[i] + " Zeichen."; }
    throw new Error("Die Client-ID stimmt nicht. " + why + " Richtig ist 8-4-4-4-12 Zeichen, z. B. 1a2b3c4d-1234-5678-9abc-1234567890ab. Am besten aus der E-Mail der IT kopieren und einfügen.");
  }
  const tenant = /@(outlook|hotmail|live|msn)\./i.test(email) ? "consumers" : email.split("@")[1].toLowerCase();
  const dc = await msPost(msAuth(tenant) + "devicecode", { client_id: client, scope });
  if (!dc.ok) throw new Error(msErr(dc.j));
  const { device_code, user_code, verification_uri, interval = 5, expires_in = 900 } = dc.j;
  try { await navigator.clipboard.writeText(user_code); } catch (e) {}
  showMsCode(user_code, verification_uri, email);
  const until = Date.now() + expires_in * 1e3, scrim = document.getElementById("cal-scrim");
  let wait = interval, tok = null;
  while (Date.now() < until) {
    await new Promise(r => setTimeout(r, wait * 1e3));
    if (scrim && scrim.hidden) throw new Error("Abgebrochen.");
    const t = await msPost(msAuth(tenant) + "token", { grant_type: "urn:ietf:params:oauth:grant-type:device_code", client_id: client, device_code });
    if (t.ok) { tok = t.j; break; }
    if (t.j.error === "authorization_pending") continue;
    if (t.j.error === "slow_down") { wait += 5; continue; }
    throw new Error(msErr(t.j));
  }
  if (!tok) throw new Error("Der Code ist abgelaufen. Bitte nochmals «Hinzufügen» tippen.");
  const acct = "a" + K.uid(), all = sec();
  all[acct] = { type: "ms", user: email, client, tenant, scope, rt: tok.refresh_token, at: tok.access_token, exp: Date.now() + (tok.expires_in || 3600) * 1e3 }; setSec(all);
  const s = document.getElementById("cal-save"); if (s) s.textContent = "Lade Kalender …";
  let list;
  try { list = ((await graph(acct, "GET", "/me/calendars?$top=50&$select=id,name,canEdit,isDefaultCalendar")) || {}).value || []; }
  catch (e) { const a = sec(); delete a[acct]; setSec(a); throw e; }
  if (!list.length) { const a = sec(); delete a[acct]; setSec(a); throw new Error("Keine Kalender in diesem Konto gefunden."); }
  list.sort((a, b) => (b.isDefaultCalendar ? 1 : 0) - (a.isDefaultCalendar ? 1 : 0));
  const S = K.S, used = S.cals.map(c => c.color);
  const added = list.map((c, i) => {
    const col = i === 0 ? color : (K.PALETTE.find(p => !used.includes(p) && p !== color) || color); used.push(col);
    return { id: "c" + K.uid(), name: i === 0 ? name : name + " · " + c.name, src: K.SRC.ms + (c.canEdit && !ro ? "" : " · nur lesen"), type: "ms", acct, gcal: c.id, color: col, on: i === 0, ro: ro || !c.canEdit };
  });
  S.cals.push(...added); K.save();
  try { await pullMs(added[0]); lastErr = null; } catch (e) { lastErr = added[0].name + ": " + e.message; }
  K.save(); K.render(); status();
  return added.length === 1 ? `${name} ist verbunden` : `${name} ist verbunden. ${added.length - 1} weitere Kalender sind ausgeblendet und lassen sich in der Leiste einschalten.`;
}
function msToEv(g, cal) {
  const ev = { id: "m" + hash(cal.id + "|" + g.id), gid: g.id, cal: cal.id, rcal: cal.id, title: g.subject || "(ohne Titel)",
    loc: (g.location && g.location.displayName) || "", notes: (g.bodyPreview || "").trim() };
  if (g.onlineMeeting && g.onlineMeeting.joinUrl) ev.url = g.onlineMeeting.joinUrl;
  if (g.isAllDay) {
    ev.allDay = true; ev.start = ""; ev.end = ""; ev.date = g.start.dateTime.slice(0, 10);
    const ed = K.ymd(K.addDays(K.parse(g.end.dateTime.slice(0, 10)), -1)); if (ed > ev.date) ev.edate = ed;
  } else {
    const s = new Date(g.start.dateTime.slice(0, 19) + "Z"), e = new Date(g.end.dateTime.slice(0, 19) + "Z");
    ev.date = K.ymd(s); ev.start = K.toMin(s.getHours() * 60 + s.getMinutes());
    const em = e.getHours() * 60 + e.getMinutes();
    if (K.ymd(e) > ev.date) { if (em === 0 && K.ymd(K.addDays(K.parse(ev.date), 1)) === K.ymd(e)) ev.end = "23:59"; else { ev.end = K.toMin(em); ev.edate = K.ymd(e); } }
    else ev.end = K.toMin(em);
    if (!ev.edate && K.mins(ev.end) <= K.mins(ev.start)) ev.end = K.toMin(Math.min(24 * 60 - 1, K.mins(ev.start) + 15));
  }
  ev.remind = g.isReminderOn ? (g.reminderMinutesBeforeStart || 0) : -1;
  if (g.showAs === "free") ev.free = true;
  if (cal.ro) ev.lock = true;
  ev.rnotes = ev.notes; ev.rsig = sig(ev);
  return ev;
}
async function pullMs(cal) {
  const w = win(), S = K.S, fresh = [], seen = new Set();
  let url = `/me/calendars/${encodeURIComponent(cal.gcal)}/calendarView?startDateTime=${w.a.toISOString()}&endDateTime=${w.b.toISOString()}&$top=500&$select=id,subject,start,end,isAllDay,location,bodyPreview,onlineMeeting,isReminderOn,reminderMinutesBeforeStart,showAs,isCancelled`;
  while (url) {
    const j = (await graph(cal.acct, "GET", url)) || {};
    (j.value || []).forEach(g => { if (g.isCancelled) return; seen.add(g.id); fresh.push(msToEv(g, cal)); });
    url = j["@odata.nextLink"] || null;
  }
  const mine = S.ev.filter(e => e.cal === cal.id || e.rcal === cal.id);
  const dirty = mine.filter(e => e.cal === cal.id ? (!e.gid || e.rcal !== cal.id || e.rsig !== sig(e)) : true); // lokale Änderungen und weggezogene Termine behalten
  const dg = new Set(dirty.map(e => e.gid).filter(Boolean));
  const keep = fresh.filter(e => !dg.has(e.gid));
  keepLocal(mine, keep);
  S.ev = S.ev.filter(e => !(e.cal === cal.id || e.rcal === cal.id)).concat(keep, dirty);
  cal.known = [...seen];
}
const MSREP = { d: { type: "daily", interval: 1 }, wd: { type: "weekly", interval: 1, daysOfWeek: ["monday", "tuesday", "wednesday", "thursday", "friday"] },
  w: { type: "weekly", interval: 1 }, w2: { type: "weekly", interval: 2 }, m: { type: "absoluteMonthly", interval: 1 }, y: { type: "absoluteYearly", interval: 1 } };
const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
function msBody(e, full) {
  const b = { subject: e.title, isAllDay: !!e.allDay, location: { displayName: e.loc || "" }, showAs: e.free ? "free" : "busy" };
  const iso = (ds, t) => { const [h, m] = t.split(":").map(Number), d = K.parse(ds); d.setHours(h, m, 0, 0); return d.toISOString().slice(0, 19); };
  if (e.allDay) { b.start = { dateTime: e.date + "T00:00:00", timeZone: "UTC" }; b.end = { dateTime: K.ymd(K.addDays(K.parse(e.edate || e.date), 1)) + "T00:00:00", timeZone: "UTC" }; }
  else { b.start = { dateTime: iso(e.date, e.start), timeZone: "UTC" }; b.end = { dateTime: iso(e.edate && e.edate > e.date ? e.edate : e.date, e.end), timeZone: "UTC" }; }
  const r = e.remind == null ? K.S.set.remind : e.remind; b.isReminderOn = r >= 0; if (r >= 0) b.reminderMinutesBeforeStart = r;
  if (full || (e.notes || "") !== (e.rnotes || "")) b.body = { contentType: "text", content: e.notes || "" };
  if (e.rep && MSREP[e.rep.f]) {
    const d = K.parse(e.date), p = Object.assign({}, MSREP[e.rep.f]);
    if (p.type === "weekly" && !p.daysOfWeek) p.daysOfWeek = [DAYS[d.getDay()]];
    if (p.type === "absoluteMonthly") p.dayOfMonth = d.getDate();
    if (p.type === "absoluteYearly") { p.dayOfMonth = d.getDate(); p.month = d.getMonth() + 1; }
    b.recurrence = { pattern: p, range: e.rep.until ? { type: "endDate", startDate: e.date, endDate: e.rep.until } : { type: "noEnd", startDate: e.date } };
  }
  return b;
}
async function pushMs() {
  const S = K.S, again = [];
  for (const cal of S.cals.filter(c => c.type === "ms" && c.acct && !c.ro)) {
    const known = new Set(cal.known || []), alive = new Set();
    for (const e of S.ev.filter(x => x.cal === cal.id && !x.lock)) {
      if (e.gid && e.rcal === cal.id && e.rsig === sig(e)) { alive.add(e.gid); continue; }
      if (e.rh && e.rcal && e.rcal !== cal.id) { // aus einem CalDAV-Kalender hierher verschoben: dort löschen
        const old = S.cals.find(c => c.id === e.rcal); if (old && old.acct && old.type !== "ms") { try { await dav("DELETE", e.rh, old.acct, null, null, {}); } catch (x) {} }
        delete e.rh; delete e.et;
      }
      if (e.gid && e.rcal === cal.id) await graph(cal.acct, "PATCH", "/me/events/" + encodeURIComponent(e.gid), msBody(e, false));
      else { const j = await graph(cal.acct, "POST", `/me/calendars/${encodeURIComponent(cal.gcal)}/events`, msBody(e, true)); e.gid = j.id; }
      if (e.rep) again.push(cal);
      e.rcal = cal.id; e.rnotes = e.notes; e.rsig = sig(e); alive.add(e.gid);
    }
    // lokal gelöschte oder weggezogene Termine auch in Outlook löschen
    const still = new Set(S.ev.filter(x => x.cal === cal.id && x.gid).map(x => x.gid));
    for (const g of known) if (!still.has(g)) await graph(cal.acct, "DELETE", "/me/events/" + encodeURIComponent(g));
    cal.known = [...new Set([...alive, ...[...known].filter(g => still.has(g))])];
  }
  for (const cal of new Set(again)) await pullMs(cal); // Serien: einzelne Termine von Outlook holen
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
    try { await pushDav(); await pushMs(); lastErr = null; lastSync = new Date(); }
    catch (e) { lastErr = e.message; }
    saving = true; K.save(); saving = false; status(); scheduleReminders();
  }), 1200);
};
async function syncAll(manual) {
  return queue(async () => {
    if (!navigator.onLine) { offline = true; status(); return; }
    offline = false;
    const S = K.S, errs = [];
    try { if (S.cals.some(c => c.acct && !c.ro && c.type !== "ms")) await pushDav(); } catch (e) { errs.push(e.message); }
    try { if (S.cals.some(c => c.type === "ms" && !c.ro)) await pushMs(); } catch (e) { errs.push(e.message); }
    for (const cal of S.cals) {
      try { if (cal.type === "ics" && cal.url) await pullIcs(cal); else if (cal.type === "ms" && cal.acct) await pullMs(cal); else if (cal.acct) await pullDav(cal); }
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
    // Ganztägige Termine: Erinnerung bezieht sich auf 08:00 Uhr am Tag
    const [h, m] = (e.allDay ? "08:00" : (e.start || "0:0")).split(":").map(Number), d = K.parse(e.date); d.setHours(h, m, 0, 0);
    const r1 = e.remind != null ? e.remind : S.set.remind;
    [...new Set([r1, e.remind2])].forEach(r => {
      if (r == null || r < 0 || isNaN(r)) return;
      if (e.allDay && r < 60) r = 0; // ganztägig: kurze Vorlaufzeiten = um 08:00
      const at = d.getTime() - r * 6e4; if (at > now - 6e4 && at <= lim) out.push({ e, at, start: d, r });
    });
  });
  return out.sort((a, b) => a.at - b.at);
}
const ahead = r => r >= 1440 ? (r === 1440 ? "Morgen" : `In ${Math.round(r / 1440)} Tagen`) : r >= 60 ? `In ${Math.round(r / 60)} Std.` : r > 0 ? `In ${r} Min.` : "Jetzt";
const body = x => `${ahead(x.r)} · ${x.e.allDay ? "ganztägig" : x.e.start + "–" + x.e.end}${x.e.loc ? " · " + x.e.loc : ""}`;
let remT = 0;
async function scheduleReminders() {
  if (!IS_ANDROID || !T.notification) { writeWidget(); return; }
  clearTimeout(remT);
  remT = setTimeout(async () => {
    try {
      await T.notification.cancelAll();
      upcoming(24 * 14).slice(0, 60).forEach((x, i) => {
        if (x.at <= Date.now()) return;
        T.notification.sendNotification({ id: 1000 + i, title: x.e.title, body: body(x), schedule: { at: { date: new Date(x.at), repeating: false, allowWhileIdle: true }, interval: undefined, every: undefined } });
      });
    } catch (e) { /* Erinnerungen sind optional */ }
    writeWidget();
  }, 800);
}
/* Startbildschirm-Widget: die nächsten Termine (14 Tage) in eine kleine Datei der App */
async function writeWidget() {
  if (!IS_ANDROID || !T.core || !T.core.invoke) return;
  try {
    const now = Date.now(), today = K.ymd(new Date()), tom = K.ymd(K.addDays(new Date(), 1)), WD = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"], MO = ["Jan.", "Feb.", "März", "Apr.", "Mai", "Juni", "Juli", "Aug.", "Sep.", "Okt.", "Nov.", "Dez."];
    const list = [];
    for (let i = 0; i < 14; i++) {
      const d = K.addDays(new Date(), i), ds = K.ymd(d);
      K.visible().filter(e => e.date === ds || (e.edate && e.date < ds && e.edate >= ds)).forEach(e => {
        const end = K.parse(e.edate && e.edate > e.date ? e.edate : e.date); if (e.allDay) end.setHours(23, 59); else { const [h, m] = e.end.split(":").map(Number); end.setHours(h, m); }
        if (end.getTime() < now) return;
        list.push({ day: ds === today ? "Heute" : ds === tom ? "Morgen" : `${WD[d.getDay()]}, ${d.getDate()}. ${MO[d.getMonth()]}`, ds, time: e.allDay ? "ganztägig" : (e.date < ds ? "00:00" : e.start), title: e.title, color: K.calOf(e.cal).color, end: end.getTime() });
      });
    }
    list.sort((a, b) => a.ds.localeCompare(b.ds) || (a.time === "ganztägig" ? -1 : b.time === "ganztägig" ? 1 : a.time.localeCompare(b.time)));
    await T.core.invoke("widget_data", { json: JSON.stringify(list.slice(0, 40)) });
  } catch (e) { /* Widget ist optional */ }
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
window.KK_TEST = { msToEv, msBody, pushMs, pullMs, connectMs, parseICS, toEvents, groupByUid, buildICS, matchDay, ruleOf, simpleRep, sig, setK: k => K = k, K: () => K, sync: m => syncAll(m) };
})();
