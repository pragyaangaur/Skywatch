// Live inputs. All open, no keys: Open-Meteo (winds, CAMS air quality, geocoding) and NASA FIRMS.
// This file runs in the browser and in scripts/build-live.mjs under Node.

export const BOX = { lat0: 24, lat1: 34, lon0: 70, lon1: 86, step: 1 };
export const PAST_DAYS = 3;
export const FORECAST_DAYS = 2;
const H = 3600 * 1000;

async function getJSON(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(25000) });
  if (!r.ok) throw new Error(`${r.status} from ${new URL(url).host}`);
  return r.json();
}

// 925 hPa winds on a 1 degree grid, hourly, UTC, from PAST_DAYS ago to FORECAST_DAYS ahead.
export async function fetchWindGrid() {
  const lat = [], lon = [];
  for (let a = BOX.lat0; a <= BOX.lat1; a += BOX.step) lat.push(a);
  for (let b = BOX.lon0; b <= BOX.lon1; b += BOX.step) lon.push(b);
  const pts = [];
  for (const a of lat) for (const b of lon) pts.push([a, b]);
  const nt = 24 * (PAST_DAYS + FORECAST_DAYS);
  const u = new Array(pts.length * nt).fill(0), v = new Array(pts.length * nt).fill(0);
  let origin = null;
  for (let s = 0; s < pts.length; s += 100) {
    const chunk = pts.slice(s, s + 100);
    const url = "https://api.open-meteo.com/v1/forecast?" +
      `latitude=${chunk.map((p) => p[0]).join(",")}&longitude=${chunk.map((p) => p[1]).join(",")}` +
      `&hourly=wind_speed_925hPa,wind_direction_925hPa&wind_speed_unit=ms&timezone=GMT` +
      `&past_days=${PAST_DAYS}&forecast_days=${FORECAST_DAYS}`;
    let res = await getJSON(url);
    if (!Array.isArray(res)) res = [res];
    res.forEach((r, k) => {
      const h = r.hourly;
      origin = origin || Date.parse(h.time[0] + "Z");
      const base = (s + k) * nt;
      for (let t = 0; t < nt; t++) {
        const sp = h.wind_speed_925hPa[t] ?? 0, d = ((h.wind_direction_925hPa[t] ?? 0) * Math.PI) / 180;
        u[base + t] = +(-sp * Math.sin(d)).toFixed(2);
        v[base + t] = +(-sp * Math.cos(d)).toFixed(2);
      }
    });
  }
  return { lat, lon, u, v, nt, origin };
}

// VIIRS Suomi NPP detections, last 7 days, inside BOX. Same sensor the backtest was fitted on.
// FIRMS sends no CORS header, so browsers get this through data/live.json instead.
export async function fetchFires() {
  const url = "https://firms.modaps.eosdis.nasa.gov/data/active_fire/suomi-npp-viirs-c2/csv/SUOMI_VIIRS_C2_South_Asia_7d.csv";
  const r = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!r.ok) throw new Error(`${r.status} from FIRMS`);
  const lines = (await r.text()).trim().split("\n");
  const head = lines[0].split(",");
  const ix = (n) => head.indexOf(n);
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split(",");
    const lat = +c[ix("latitude")], lon = +c[ix("longitude")];
    if (lat < BOX.lat0 || lat > BOX.lat1 || lon < BOX.lon0 || lon > BOX.lon1) continue;
    if (c[ix("confidence")] === "l") continue;
    const hhmm = c[ix("acq_time")].padStart(4, "0");
    const when = Date.parse(`${c[ix("acq_date")]}T${hhmm.slice(0, 2)}:${hhmm.slice(2)}:00Z`);
    out.push({ lat, lon, when, frp: +c[ix("frp")] });
  }
  return out;
}

// Browser side: fires (and usually winds) come prebuilt in data/live.json, refreshed hourly.
// If the prebuilt winds are missing or too old to cover the next 24 h, fetch them live.
let livePromise = null;
export function liveData(base = "") {
  livePromise = livePromise || (async () => {
    const live = await getJSON(`${base}data/live.json?t=${Math.floor(Date.now() / (15 * 60 * 1000))}`);
    const g = live.grid;
    const coversNextDay = g && Date.now() + 24 * H < g.origin + (g.nt - 1) * H && Date.now() - 24 * H > g.origin + 48 * H;
    const grid = coversNextDay ? g : await fetchWindGrid();
    return { fires: live.fires, grid, builtAt: live.builtAt };
  })();
  livePromise.catch(() => (livePromise = null));
  return livePromise;
}

const aqCache = new Map();
// CAMS PM2.5 at a point, hourly, local time.
export function airQuality(lat, lon) {
  const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  if (!aqCache.has(key)) {
    const url = "https://air-quality-api.open-meteo.com/v1/air-quality?" +
      `latitude=${lat}&longitude=${lon}&hourly=pm2_5,pm10&past_days=1&forecast_days=3&timezone=Asia/Kolkata`;
    const p = getJSON(url).then((r) => r.hourly.time.map((t, i) => ({ t, pm25: r.hourly.pm2_5[i], pm10: r.hourly.pm10[i] })));
    p.catch(() => aqCache.delete(key));
    aqCache.set(key, p);
  }
  return aqCache.get(key);
}

export async function geocode(name) {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=5&countryCode=IN&language=en`;
  const r = await getJSON(url);
  return (r.results || []).map((p) => ({ name: p.name, admin: p.admin1 || "", lat: p.latitude, lon: p.longitude }));
}
