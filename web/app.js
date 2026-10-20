import { report } from "./lib/report.js";
import { geocode } from "./lib/data.js";
import { templateAnswer, modelMessages, grounded, placeIn } from "./lib/advisor.js";
import { Helper, supported } from "./lib/helper.js";

const $ = (s) => document.querySelector(s);
const BANDS = [
  { max: 30, en: "Good", hi: "अच्छा", color: "#2e7d32" },
  { max: 60, en: "Satisfactory", hi: "संतोषजनक", color: "#7cb342" },
  { max: 90, en: "Moderate", hi: "मध्यम", color: "#fbc02d" },
  { max: 120, en: "Poor", hi: "खराब", color: "#f57c00" },
  { max: 250, en: "Very Poor", hi: "बहुत खराब", color: "#d32f2f" },
  { max: Infinity, en: "Severe", hi: "गंभीर", color: "#6a1b9a" },
];
const bandOf = (pm) => BANDS.find((b) => pm <= b.max);

const params = new URLSearchParams(location.search);
let lang = params.get("lang") || localStorage.getItem("lang") || ((navigator.language || "").startsWith("hi") ? "hi" : "en");
if (!["en", "hi"].includes(lang)) lang = "en";
let current = null; // { place, lat, lon }
let lastReport = null;
let map, layers;

const T = {
  loading: { en: "Fetching fires, winds and forecasts…", hi: "आग, हवा और पूर्वानुमान लाए जा रहे हैं…" },
  failed: { en: "Could not get data right now. Try again in a minute.", hi: "अभी डेटा नहीं मिल पाया। एक मिनट बाद फिर कोशिश करें।" },
  now: { en: "Right now about", hi: "अभी लगभग" },
  next: { en: "Next 24 h, if today's fires repeat:", hi: "अगले 24 घंटे, अगर आज जैसी आग रही:" },
  fires: { en: "fire detections in North India and Pakistan Punjab in the last 24 h", hi: "पिछले 24 घंटे में उत्तर भारत और पाकिस्तान पंजाब में आग" },
  outside: { en: "Outside the region the smoke model covers (24–34°N, 70–86°E).", hi: "यह जगह स्मोक मॉडल के क्षेत्र से बाहर है।" },
  today: { en: "Today", hi: "आज" },
  tomorrow: { en: "Tomorrow", hi: "कल" },
  worst: { en: "Worst around", hi: "सबसे खराब लगभग" },
  none: { en: "No daylight hours left today.", hi: "आज दिन के घंटे बाकी नहीं।" },
  thinking: { en: "Checking the numbers…", hi: "आँकड़े देखे जा रहे हैं…" },
  aiOff: { en: "Answers come from fixed templates. Turn on the on-device AI for more natural replies. It runs in your browser, so your questions never leave this device. The first load downloads about 1 GB.", hi: "जवाब तय टेम्पलेट से आते हैं। ज़्यादा स्वाभाविक जवाबों के लिए डिवाइस पर चलने वाला AI चालू करें। यह आपके ब्राउज़र में चलता है, इसलिए आपके सवाल इस डिवाइस से बाहर नहीं जाते। पहली बार लगभग 1 GB डाउनलोड होगा।" },
  aiBtn: { en: "Turn on on-device AI", hi: "डिवाइस AI चालू करें" },
  aiLoading: { en: "Loading the on-device model", hi: "डिवाइस मॉडल लोड हो रहा है" },
  aiOn: { en: "On-device AI is on. Numbers are checked against SkyWatch's data before they are shown.", hi: "डिवाइस AI चालू है। दिखाने से पहले हर आँकड़ा SkyWatch के डेटा से मिलाया जाता है।" },
  aiNoGpu: { en: "This browser has no WebGPU, so the on-device AI cannot run here. Template answers still work.", hi: "इस ब्राउज़र में WebGPU नहीं है, इसलिए डिवाइस AI यहाँ नहीं चल सकता। टेम्पलेट जवाब काम करते रहेंगे।" },
  aiFail: { en: "The model did not load. Template answers still work.", hi: "मॉडल लोड नहीं हुआ। टेम्पलेट जवाब काम करते रहेंगे।" },
  basis: { en: "From SkyWatch's data", hi: "SkyWatch के डेटा से" },
  chips: {
    en: ["Can my kids play outside this evening?", "When should I go for a morning walk tomorrow?", "Do I need a mask today?", "How much of this smoke is from stubble burning?"],
    hi: ["क्या बच्चे आज शाम बाहर खेल सकते हैं?", "कल सुबह टहलने का सबसे अच्छा समय क्या है?", "क्या आज मास्क पहनना चाहिए?", "इस धुएँ में पराली का कितना हिस्सा है?"],
  },
};
const t = (k) => T[k][lang];

function applyLang() {
  document.documentElement.lang = lang;
  document.querySelectorAll("[data-en]").forEach((el) => (el.textContent = el.dataset[lang]));
  $("#lang").textContent = lang === "en" ? "हिंदी" : "English";
  $("#q").placeholder = lang === "en" ? "Search a city, e.g. Delhi, Lucknow, Ludhiana" : "शहर खोजें, जैसे दिल्ली, लखनऊ, लुधियाना";
  $("#aq").placeholder = T.chips[lang][0];
  $("#chips").innerHTML = "";
  T.chips[lang].forEach((q) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = q;
    b.onclick = () => askQ(q);
    $("#chips").append(b);
  });
  renderAi();
  if (lastReport) render(lastReport);
  if (window.__bt) renderBacktest(window.__bt);
}
$("#lang").onclick = () => { lang = lang === "en" ? "hi" : "en"; localStorage.setItem("lang", lang); applyLang(); };

// search
let timer;
$("#q").addEventListener("input", () => {
  clearTimeout(timer);
  const q = $("#q").value.trim();
  if (q.length < 2) return ($("#sugg").hidden = true);
  timer = setTimeout(async () => {
    const r = await geocode(q).catch(() => []);
    const ul = $("#sugg");
    ul.innerHTML = "";
    (Array.isArray(r) ? r : []).forEach((p) => {
      const li = document.createElement("li");
      li.tabIndex = 0;
      li.textContent = `${p.name}${p.admin ? ", " + p.admin : ""}`;
      li.onclick = li.onkeydown = (e) => { if (e.type === "keydown" && e.key !== "Enter") return; ul.hidden = true; $("#q").value = li.textContent; load({ place: li.textContent, lat: p.lat, lon: p.lon }); };
      ul.append(li);
    });
    ul.hidden = !r.length;
  }, 250);
});
$("#sf").onsubmit = async (e) => {
  e.preventDefault();
  const q = $("#q").value.trim();
  if (!q) return;
  const r = await geocode(q).catch(() => []);
  $("#sugg").hidden = true;
  if (r[0]) load({ place: `${r[0].name}${r[0].admin ? ", " + r[0].admin : ""}`, lat: r[0].lat, lon: r[0].lon });
};
$("#geo").onclick = () => navigator.geolocation?.getCurrentPosition(
  (p) => load({ place: lang === "en" ? "Your location" : "आपकी जगह", lat: p.coords.latitude, lon: p.coords.longitude }),
  () => ($("#status").textContent = lang === "en" ? "Location permission was not given." : "लोकेशन की अनुमति नहीं मिली।"),
);

async function load(p) {
  current = p;
  const u = new URL(location);
  u.searchParams.set("place", p.place); u.searchParams.set("lat", (+p.lat).toFixed(2)); u.searchParams.set("lon", (+p.lon).toFixed(2));
  history.replaceState(null, "", u);
  $("#status").textContent = t("loading");
  try {
    const r = await report(+(+p.lat).toFixed(2), +(+p.lon).toFixed(2), p.place);
    lastReport = r;
    $("#status").textContent = "";
    render(r);
  } catch {
    $("#status").textContent = t("failed");
  }
}

const fmtHour = (s) => {
  const h = +s.slice(11, 13);
  if (lang === "hi") return `${h}:00`;
  return `${h % 12 || 12} ${h < 12 ? "am" : "pm"}`;
};

function render(r) {
  $("#cards").hidden = false;
  const b = bandOf(r.pm25.avg24h);
  $("#pm").textContent = Math.round(r.pm25.avg24h);
  $("#bandchip").innerHTML = `<i style="background:${b.color}"></i>${b[lang]} <span class="unit">(CPCB)</span>`;
  $("#pmnow").textContent = r.pm25.now != null ? `${t("now")} ${Math.round(r.pm25.now)} µg/m³ · ${r.place}` : r.place;
  if (r.smoke) {
    $("#share").textContent = `${Math.round(100 * r.smoke.shareLast24h)}%`;
    $("#sharenext").textContent = `${t("next")} ${Math.round(100 * r.smoke.shareNext24h)}%`;
    $("#firecount").textContent = `${r.smoke.firesLast24h} ${t("fires")}`;
  } else {
    $("#share").textContent = "–";
    $("#sharenext").textContent = t("outside");
    $("#firecount").textContent = "";
  }
  const days = [t("today"), t("tomorrow")];
  $("#windows").innerHTML = r.windows.length ? r.windows.map((w, i) => `
    <div class="win"><span>${days[i] || w.date}</span>
      <b>${fmtHour(w.best.from)} – ${fmtHour(w.best.to.slice(0, 11) + String(+w.best.to.slice(11, 13) + 1).padStart(2, "0"))}</b>
      <span>PM2.5 ≈ ${Math.round(w.best.pm25)} (${bandOf(w.best.pm25)[lang]}) · ${t("worst")} ${fmtHour(w.worst.t)}: ${Math.round(w.worst.pm25)}</span></div>`).join("") : `<p class="sub">${t("none")}</p>`;
  renderMap(r);
  renderForecast(r);
}

function renderMap(r) {
  $("#mapwrap").hidden = false;
  if (!map) {
    map = L.map("map", { scrollWheelZoom: false }).setView([r.lat, r.lon], 6);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors', maxZoom: 12,
    }).addTo(map);
  }
  if (layers) layers.remove();
  layers = L.layerGroup().addTo(map);
  const css = getComputedStyle(document.documentElement);
  const s1 = css.getPropertyValue("--s1").trim(), s2 = css.getPropertyValue("--s2").trim();
  const bounds = [[r.lat, r.lon]];
  if (r.smoke) {
    for (const f of r.smoke.allFires) L.circleMarker([f[0], f[1]], { radius: 1.5, stroke: false, fillColor: "#9a9893", fillOpacity: 0.6 }).addTo(layers);
    const maxPct = Math.max(...r.smoke.contributingFires.map((f) => f.pct), 0.01);
    for (const f of r.smoke.contributingFires) {
      L.circleMarker([f.lat, f.lon], { radius: 3 + 9 * Math.sqrt(f.pct / maxPct), color: "#fff", weight: 1, fillColor: s2, fillOpacity: 0.85 })
        .bindTooltip(`${f.pct}% of the smoke reaching ${r.place}<br>Fire power ${f.frp} MW`).addTo(layers);
      if (f.pct > 0.3 * maxPct) bounds.push([f.lat, f.lon]);
    }
    for (const a of r.smoke.arrivals.filter((a) => a.hoursFromNow <= 0)) {
      L.polyline(a.path, { color: s1, weight: 2, opacity: 0.35 + 0.5 * (1 + a.hoursFromNow / 24) }).addTo(layers);
    }
  }
  L.circleMarker([r.lat, r.lon], { radius: 8, color: "#fff", weight: 2, fillColor: "#0b0b0b", fillOpacity: 1 }).bindTooltip(r.place).addTo(layers);
  map.fitBounds(bounds, { padding: [30, 30], maxZoom: 7 });
}

// --- charts (plain SVG) ---
const NS = "http://www.w3.org/2000/svg";
function el(tag, attrs, parent) {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (parent) parent.append(e);
  return e;
}
function tooltip(container) {
  let tip = container.querySelector(".tip");
  if (!tip) { tip = document.createElement("div"); tip.className = "tip"; tip.hidden = true; container.append(tip); }
  return tip;
}

function renderForecast(r) {
  $("#chartwrap").hidden = false;
  const box = $("#chart");
  box.innerHTML = "";
  const hrs = r.hourly.filter((h) => h.pm25 != null);
  if (!hrs.length) return;
  const W = 960, H = 280, m = { l: 44, r: 96, t: 12, b: 28 };
  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "PM2.5 forecast for the next 48 hours" }, box);
  const ymax = Math.max(130, ...hrs.map((h) => h.pm25)) * 1.08;
  const x = (i) => m.l + (i / (hrs.length - 1)) * (W - m.l - m.r);
  const y = (v) => H - m.b - (v / ymax) * (H - m.t - m.b);
  let lo = 0;
  for (const b of BANDS) {
    const hi = Math.min(b.max, ymax);
    if (lo >= ymax) break;
    el("rect", { x: m.l, width: W - m.l - m.r, y: y(hi), height: y(lo) - y(hi), fill: b.color, opacity: 0.09 }, svg);
    const tx = el("text", { x: W - m.r + 6, y: (y(hi) + y(lo)) / 2 + 4 }, svg);
    tx.textContent = b[lang];
    lo = b.max;
  }
  for (const w of r.windows) {
    const i0 = hrs.findIndex((h) => h.t === w.best.from), i1 = hrs.findIndex((h) => h.t === w.best.to);
    if (i0 < 0 || i1 < 0) continue;
    el("rect", { x: x(i0), width: Math.max(4, x(i1) - x(i0)), y: m.t, height: H - m.t - m.b, fill: "var(--s1)", opacity: 0.12 }, svg);
    const tx = el("text", { x: x(i0) + 3, y: m.t + 12 }, svg);
    tx.textContent = lang === "en" ? "cleanest" : "सबसे साफ़";
  }
  for (const v of [0, 60, 120, 250].filter((v) => v < ymax)) {
    el("line", { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), stroke: "var(--line)" }, svg);
    const tx = el("text", { x: m.l - 6, y: y(v) + 4, "text-anchor": "end" }, svg);
    tx.textContent = v;
  }
  hrs.forEach((h, i) => {
    if (+h.t.slice(11, 13) % 6 !== 0) return;
    const tx = el("text", { x: x(i), y: H - 8, "text-anchor": "middle" }, svg);
    tx.textContent = h.t.slice(11, 13) === "00" ? h.t.slice(5, 10) : fmtHour(h.t);
  });
  el("path", { d: hrs.map((h, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(h.pm25).toFixed(1)}`).join(""), fill: "none", stroke: "var(--ink)", "stroke-width": 2, "stroke-linejoin": "round" }, svg);
  const cross = el("line", { y1: m.t, y2: H - m.b, stroke: "var(--ink2)", "stroke-dasharray": "3 3", visibility: "hidden" }, svg);
  const dot = el("circle", { r: 4, fill: "var(--ink)", stroke: "var(--surface)", "stroke-width": 2, visibility: "hidden" }, svg);
  const tip = tooltip(box);
  svg.addEventListener("pointermove", (e) => {
    const pt = svg.getBoundingClientRect();
    const sx = ((e.clientX - pt.left) / pt.width) * W;
    const i = Math.max(0, Math.min(hrs.length - 1, Math.round(((sx - m.l) / (W - m.l - m.r)) * (hrs.length - 1))));
    const h = hrs[i];
    cross.setAttribute("x1", x(i)); cross.setAttribute("x2", x(i)); cross.setAttribute("visibility", "visible");
    dot.setAttribute("cx", x(i)); dot.setAttribute("cy", y(h.pm25)); dot.setAttribute("visibility", "visible");
    tip.hidden = false;
    tip.innerHTML = `${h.t.slice(5, 10)} ${fmtHour(h.t)}<br><b>${Math.round(h.pm25)}</b> µg/m³ · ${bandOf(h.pm25)[lang]}`;
    tip.style.left = `${Math.min((x(i) / W) * pt.width + 12, pt.width - 150)}px`;
    tip.style.top = `${(y(h.pm25) / H) * pt.height - 10}px`;
  });
  svg.addEventListener("pointerleave", () => { tip.hidden = true; cross.setAttribute("visibility", "hidden"); dot.setAttribute("visibility", "hidden"); });
}

// --- ask ---
const helper = new Helper((p) => {
  if (p.done) return renderAi();
  $("#aibar").hidden = false;
  $("#aibar").value = p.ratio;
  $("#aistate").textContent = `${t("aiLoading")}… ${Math.round(100 * p.ratio)}%`;
}, { small: params.get("ai") === "small" });
let aiState = "off";
function renderAi() {
  const btn = $("#aibtn");
  btn.textContent = t("aiBtn");
  btn.hidden = aiState !== "off";
  $("#aibar").hidden = aiState !== "loading";
  $("#aistate").textContent = { off: supported() ? t("aiOff") : t("aiNoGpu"), loading: t("aiLoading") + "…", on: t("aiOn"), failed: t("aiFail") }[aiState];
  if (!supported()) btn.hidden = true;
}
$("#aibtn").onclick = async () => {
  aiState = "loading";
  renderAi();
  try {
    await helper.load();
    aiState = "on";
  } catch {
    aiState = "failed";
  }
  renderAi();
};

async function askQ(q) {
  const div = document.createElement("div");
  div.className = "qa";
  div.innerHTML = `<div class="q"></div><div class="a"></div><div class="basis" hidden></div>`;
  div.querySelector(".q").textContent = q;
  const a = div.querySelector(".a");
  a.textContent = t("thinking");
  $("#answers").prepend(div);
  try {
    // A place named in the question wins over the one on the map.
    let r = lastReport;
    const named = placeIn(q);
    if (named) {
      const g = (await geocode(named).catch(() => []))[0];
      if (g) r = await report(+g.lat.toFixed(2), +g.lon.toFixed(2), `${g.name}${g.admin ? ", " + g.admin : ""}`);
    }
    if (!r) r = await report(+(+current.lat).toFixed(2), +(+current.lon).toFixed(2), current.place);
    const plain = templateAnswer(q, r);
    if (!helper.ready) {
      a.textContent = plain;
      return;
    }
    let text = "";
    for await (const piece of helper.answer(modelMessages(q, r))) {
      text += piece;
      a.textContent = text;
    }
    // A reply with a number that is not in SkyWatch's data is not shown.
    if (!text.trim() || !grounded(text, q, r)) a.textContent = plain;
    else {
      const b = div.querySelector(".basis");
      b.hidden = false;
      b.textContent = `${t("basis")}: ${plain}`;
    }
  } catch {
    a.textContent = t("failed");
  }
}
$("#af").onsubmit = (e) => { e.preventDefault(); const q = $("#aq").value.trim(); if (q) { askQ(q); $("#aq").value = ""; } };

// --- backtest ---
let btSeason = null;
function renderBacktest(bt) {
  const res = bt.results;
  const pct = (x) => `${Math.round(100 * x)}%`;
  const en = `<p>Every 3 hours SkyWatch traces the air arriving at your city 48 hours back through the forecast wind field at about 750 m, the height where stubble smoke travels. Each fire NASA's VIIRS satellite saw near that path, at the time the air passed over it, adds its fire power, weighted by distance and by how long ago it was. That sum is the smoke index.</p>
  <p>We tested this against ${res.n_days} days of measured PM2.5 at the US Embassy monitor in New Delhi over four stubble seasons (October and November, 2022 to 2025). Each season was predicted by a model fitted only on the other three. Weather alone explains ${pct(res.loso_r2_met_only)} of the day-to-day variation in PM2.5. Adding the smoke index raises that to ${pct(res.loso_r2_met_plus_fire)}, and the typical daily error falls from ${pct(res.loso_mape_met_only)} to ${pct(res.loso_mape_met_plus_fire)}. It helped in three of the four seasons and did worse in 2025, a light burning year.${res.placebo_r2 ? ` As a check, we gave each season the smoke index of the same dates in a different year, which keeps the November peak but breaks the link with that day's winds. That placebo only reaches ${pct(res.placebo_r2)}, so the gain comes from the wind and fire physics and not from the calendar.` : ""}</p>
  <p>The fitted farm-fire share in Delhi averaged ${Object.entries(res.share_mean_by_season).map(([y, v]) => `${pct(v)} in ${y}`).join(", ")}, with single days up to about 60%. That is in the range of earlier estimates (SAFAR found peaks of up to 58% on single days; IITM's Decision Support System put 2025 peaks near 31%) and at the high end of it, so read the number as a guide, not a measurement.</p>`;
  const hi = `<p>हर 3 घंटे पर SkyWatch आपके शहर पहुँचने वाली हवा का रास्ता 48 घंटे पीछे तक, लगभग 750 मीटर की ऊँचाई की हवाओं से, खोजता है। इस रास्ते के पास NASA के VIIRS उपग्रह ने जो आग देखी, उसकी ताकत दूरी और समय के हिसाब से जोड़ी जाती है। यही स्मोक इंडेक्स है।</p>
  <p>हमने इसे नई दिल्ली में अमेरिकी दूतावास के मॉनिटर पर चार पराली सीज़न (2022 से 2025, अक्टूबर और नवंबर) के ${res.n_days} दिनों के मापे गए PM2.5 से जाँचा। हर सीज़न का अनुमान बाकी तीन सीज़न पर बने मॉडल से लगाया गया। सिर्फ़ मौसम PM2.5 के रोज़ाना बदलाव का ${pct(res.loso_r2_met_only)} समझाता है; स्मोक इंडेक्स जोड़ने पर यह ${pct(res.loso_r2_met_plus_fire)} हो जाता है, और औसत रोज़ाना गलती ${pct(res.loso_mape_met_only)} से घटकर ${pct(res.loso_mape_met_plus_fire)} हो जाती है। चार में से तीन सीज़न में सुधार हुआ; 2025 में नहीं।${res.placebo_r2 ? ` जाँच के लिए हर सीज़न को किसी दूसरे साल की उन्हीं तारीख़ों का इंडेक्स दिया गया; वह सिर्फ़ ${pct(res.placebo_r2)} तक पहुँचता है, यानी फ़ायदा हवा और आग के असली संबंध से है, कैलेंडर से नहीं।` : ""}</p>`;
  $("#howtext").innerHTML = lang === "en" ? en : hi;

  const seasons = Object.keys(res.by_season);
  btSeason = btSeason || seasons[seasons.length - 1];
  const box = $("#btchart");
  box.innerHTML = "";
  const ctl = document.createElement("div");
  ctl.className = "legend";
  ctl.innerHTML = `<span><i style="background:var(--s1)"></i>${lang === "en" ? "Measured PM2.5" : "मापा गया PM2.5"}</span><span><i style="background:var(--s2)"></i>${lang === "en" ? "Predicted, weather + smoke index" : "अनुमान, मौसम + स्मोक इंडेक्स"}</span><span style="flex:1"></span>` +
    seasons.map((s) => `<button type="button" class="ghost" data-s="${s}" style="padding:4px 10px;${s === btSeason ? "background:var(--line)" : ""}">${s}</button>`).join(" ");
  box.append(ctl);
  ctl.querySelectorAll("button").forEach((b) => (b.onclick = () => { btSeason = b.dataset.s; renderBacktest(bt); }));
  const rows = bt.daily.filter((d) => String(d.season) === btSeason);
  const W = 960, H = 260, m = { l: 44, r: 20, t: 12, b: 28 };
  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": `Measured and predicted PM2.5 in New Delhi, ${btSeason}` }, box);
  const ymax = Math.max(...rows.map((d) => Math.max(d.pm25, d.pred))) * 1.08;
  const x = (i) => m.l + (i / (rows.length - 1)) * (W - m.l - m.r);
  const y = (v) => H - m.b - (v / ymax) * (H - m.t - m.b);
  for (const v of [0, 100, 200, 300, 400, 500].filter((v) => v < ymax)) {
    el("line", { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), stroke: "var(--line)" }, svg);
    el("text", { x: m.l - 6, y: y(v) + 4, "text-anchor": "end" }, svg).textContent = v;
  }
  rows.forEach((d, i) => { if (d.date.endsWith("-01") || d.date.endsWith("-15")) el("text", { x: x(i), y: H - 8, "text-anchor": "middle" }, svg).textContent = d.date.slice(5); });
  const line = (k, c) => el("path", { d: rows.map((d, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(d[k]).toFixed(1)}`).join(""), fill: "none", stroke: c, "stroke-width": 2, "stroke-linejoin": "round" }, svg);
  line("pm25", "var(--s1)");
  line("pred", "var(--s2)");
  const cross = el("line", { y1: m.t, y2: H - m.b, stroke: "var(--ink2)", "stroke-dasharray": "3 3", visibility: "hidden" }, svg);
  const tip = tooltip(box);
  svg.addEventListener("pointermove", (e) => {
    const pt = svg.getBoundingClientRect();
    const sx = ((e.clientX - pt.left) / pt.width) * W;
    const i = Math.max(0, Math.min(rows.length - 1, Math.round(((sx - m.l) / (W - m.l - m.r)) * (rows.length - 1))));
    const d = rows[i];
    cross.setAttribute("x1", x(i)); cross.setAttribute("x2", x(i)); cross.setAttribute("visibility", "visible");
    tip.hidden = false;
    tip.innerHTML = `${d.date}<br>${lang === "en" ? "Measured" : "मापा"} <b>${Math.round(d.pm25)}</b> · ${lang === "en" ? "Predicted" : "अनुमान"} <b>${Math.round(d.pred)}</b><br>${lang === "en" ? "Farm-fire share" : "पराली का हिस्सा"} ${Math.round(100 * d.fire_share)}%`;
    tip.style.left = `${Math.min((x(i) / W) * pt.width + 12, pt.width - 190)}px`;
    tip.style.top = `${40}px`;
  });
  svg.addEventListener("pointerleave", () => { tip.hidden = true; cross.setAttribute("visibility", "hidden"); });

  $("#bttable").innerHTML = `<table><thead><tr><th>${lang === "en" ? "Season" : "सीज़न"}</th><th>${lang === "en" ? "Days" : "दिन"}</th><th>${lang === "en" ? "Mean PM2.5" : "औसत PM2.5"}</th><th>R² ${lang === "en" ? "weather only" : "सिर्फ़ मौसम"}</th><th>R² ${lang === "en" ? "weather + smoke" : "मौसम + धुआँ"}</th><th>${lang === "en" ? "Mean farm-fire share" : "औसत पराली हिस्सा"}</th><th>${lang === "en" ? "Peak day" : "सबसे ज़्यादा"}</th></tr></thead><tbody>` +
    seasons.map((s) => { const b = res.by_season[s], p = res.share_peak_by_season[s]; return `<tr><td>${s}</td><td class="n">${b.days}</td><td class="n">${Math.round(b.mean_pm25)}</td><td class="n">${b.r2_met.toFixed(2)}</td><td class="n">${b.r2_fire.toFixed(2)}</td><td class="n">${pct(res.share_mean_by_season[s])}</td><td class="n">${p.date.slice(5)} · ${pct(p.share)}</td></tr>`; }).join("") + "</tbody></table>";
}

fetch("backtest.json").then((r) => (r.ok ? r.json() : null)).then((bt) => { if (bt) { window.__bt = bt; renderBacktest(bt); } }).catch(() => {});

applyLang();
const start = params.get("lat") && params.get("lon")
  ? { place: params.get("place") || "Selected place", lat: +params.get("lat"), lon: +params.get("lon") }
  : { place: "New Delhi", lat: 28.61, lon: 77.21 };
load(start).then(() => { if (params.get("ask")) askQ(params.get("ask").slice(0, 300)); });
