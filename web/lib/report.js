import { liveData, airQuality, BOX } from "./data.js";
import { backTrajectory, smokeIndex, fireShare } from "./smoke.js";
import coeffs from "./coeffs.js";

const H = 3600 * 1000;

// CPCB National AQI breakpoints for PM2.5 (24 h, ug/m3)
export const BANDS = [
  { max: 30, name: "Good", hi: "अच्छा", color: "#2e7d32" },
  { max: 60, name: "Satisfactory", hi: "संतोषजनक", color: "#7cb342" },
  { max: 90, name: "Moderate", hi: "मध्यम", color: "#fbc02d" },
  { max: 120, name: "Poor", hi: "खराब", color: "#f57c00" },
  { max: 250, name: "Very Poor", hi: "बहुत खराब", color: "#d32f2f" },
  { max: Infinity, name: "Severe", hi: "गंभीर", color: "#6a1b9a" },
];
export const band = (pm) => BANDS.find((b) => pm <= b.max);

const inBox = (lat, lon) => lat >= BOX.lat0 && lat <= BOX.lat1 && lon >= BOX.lon0 && lon <= BOX.lon1;

// Smoke arriving at (lat, lon) every 3 h from 24 h ago to 24 h ahead.
// For future arrivals the fires of the last 24 h are assumed to repeat a day later
// (stubble burning follows a strong daily rhythm); the report says so.
async function smoke(lat, lon) {
  const { grid, fires: fl, builtAt } = await liveData();
  const now = Date.now();
  const latest = Math.max(...fl.map((f) => f.when), 0);
  const recent = fl.filter((f) => f.when > latest - 24 * H);
  const firesClock = fl.map((f) => ({ ...f, t: (f.when - grid.origin) / H, future: false }))
    .concat(recent.map((f) => ({ ...f, when: f.when + 24 * H, t: (f.when + 24 * H - grid.origin) / H, future: true })));
  const tNow = Math.floor((now - grid.origin) / H);
  const arrivals = [];
  const contribAll = new Float64Array(firesClock.length);
  for (let dh = -24; dh <= 24; dh += 3) {
    const t0 = tNow + dh;
    if (t0 < 48 || t0 >= grid.nt) continue;
    const path = backTrajectory(grid, lat, lon, t0);
    const { total, contrib } = smokeIndex(path, t0, firesClock);
    if (dh >= -24 && dh <= 0) contrib.forEach((c, i) => (contribAll[i] += c));
    arrivals.push({ at: new Date(grid.origin + t0 * H).toISOString(), hoursFromNow: dh, S: total, share: fireShare(total, coeffs), path: path.map((p) => [+p[1].toFixed(3), +p[2].toFixed(3)]) });
  }
  const past = arrivals.filter((a) => a.hoursFromNow <= 0);
  const next = arrivals.filter((a) => a.hoursFromNow > 0);
  const mean = (xs) => (xs.length ? xs.reduce((s, a) => s + a.share, 0) / xs.length : 0);
  const totalC = contribAll.reduce((s, c) => s + c, 0) || 1;
  const top = [...contribAll.keys()].filter((i) => contribAll[i] > 0 && !firesClock[i].future)
    .sort((a, b) => contribAll[b] - contribAll[a]).slice(0, 400)
    .map((i) => ({ lat: firesClock[i].lat, lon: firesClock[i].lon, frp: firesClock[i].frp, pct: +(100 * contribAll[i] / totalC).toFixed(2) }));
  return {
    shareLast24h: mean(past),
    shareNext24h: mean(next),
    arrivals,
    contributingFires: top,
    allFires: fl.filter((f) => f.when > latest - 48 * H).map((f) => [+f.lat.toFixed(3), +f.lon.toFixed(3), f.frp]),
    firesLast24h: recent.length,
    firesLatest: new Date(latest).toISOString(),
    dataBuiltAt: builtAt,
  };
}

// Cleanest 2 h outdoor window in daylight (06:00 to 21:00 IST) for today and tomorrow.
function windows(aq) {
  const out = [];
  const nowIST = new Date(Date.now() + 5.5 * H).toISOString().slice(0, 13);
  const days = [...new Set(aq.map((h) => h.t.slice(0, 10)))];
  for (const d of days) {
    const hrs = aq.filter((h) => h.t.slice(0, 10) === d && h.t.slice(0, 13) >= nowIST && h.pm25 != null)
      .filter((h) => { const hr = +h.t.slice(11, 13); return hr >= 6 && hr <= 20; });
    if (hrs.length < 2) continue;
    let best = null;
    for (let i = 0; i + 1 < hrs.length; i++) {
      const m = (hrs[i].pm25 + hrs[i + 1].pm25) / 2;
      if (!best || m < best.pm25) best = { from: hrs[i].t, to: hrs[i + 1].t, pm25: m };
    }
    // The hour to avoid must lie clear of the cleanest window and be clearly worse than it.
    const b0 = +best.from.slice(11, 13), b1 = +best.to.slice(11, 13);
    const away = hrs.filter((h) => { const hr = +h.t.slice(11, 13); return hr < b0 - 1 || hr > b1 + 1; });
    const w = away.length ? away.reduce((x, h) => (h.pm25 > x.pm25 ? h : x)) : null;
    const worst = w && w.pm25 > 1.15 * best.pm25 ? { t: w.t, pm25: w.pm25, band: band(w.pm25).name } : null;
    out.push({ date: d, best: { ...best, band: band(best.pm25).name }, worst });
  }
  return out.slice(0, 2);
}

export async function report(lat, lon, place = null) {
  const aq = await airQuality(lat, lon);
  const nowIST = new Date(Date.now() + 5.5 * H).toISOString().slice(0, 13);
  const idx = Math.max(0, aq.findIndex((h) => h.t.slice(0, 13) === nowIST));
  const last24 = aq.slice(Math.max(0, idx - 23), idx + 1).map((h) => h.pm25).filter((x) => x != null);
  const pm24 = last24.reduce((s, x) => s + x, 0) / Math.max(1, last24.length);
  const nowPm = aq[idx]?.pm25;
  const sm = inBox(lat, lon) ? await smoke(lat, lon) : null;
  return {
    place, lat, lon,
    generatedAt: new Date().toISOString(),
    pm25: { now: nowPm, avg24h: pm24, band: band(pm24), bandNow: band(nowPm ?? pm24), source: "CAMS forecast via Open-Meteo" },
    hourly: aq.slice(idx, idx + 48),
    windows: windows(aq),
    smoke: sm,
    model: { c: coeffs.c, S0: coeffs.S0, ci95: coeffs.ci95, calibratedOn: "US Embassy New Delhi PM2.5, Oct-Nov 2022-2025" },
    caveats: [
      "PM2.5 levels are the CAMS model forecast, not a measurement at your street.",
      "The farm-fire share is calibrated on Delhi. Outside Delhi-NCR treat it as a rough guide.",
      "Future smoke assumes the last 24 h of fires repeat tomorrow.",
    ],
  };
}
