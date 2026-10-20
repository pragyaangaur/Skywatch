// Port of science/smoke.py. Keep the constants and steps identical; science/check_port.py
// compares the two on the same inputs.

export const HOURS_BACK = 48;
export const STEP_H = 1.0;
export const KM_PER_DEG = 111.2;
export const SIGMA0_KM = 20.0;
export const SIGMA_GROWTH_KM_PER_H = 1.5;
export const FIRE_WINDOW_H = 6.0;
export const DECAY_H = 36.0;

const rad = (d) => (d * Math.PI) / 180;

// grid: { lat: [..], lon: [..], u: Float64Array[lat][lon][t] flattened, v: same, nt }
function at(arr, grid, i, j, t) {
  return arr[(i * grid.lon.length + j) * grid.nt + t];
}

export function interpWind(grid, lat, lon, ti) {
  const fi = (lat - grid.lat[0]) / (grid.lat[1] - grid.lat[0]);
  const fj = (lon - grid.lon[0]) / (grid.lon[1] - grid.lon[0]);
  const ni = grid.lat.length, nj = grid.lon.length;
  if (fi < 0 || fj < 0 || fi > ni - 1 || fj > nj - 1) return null;
  const i0 = Math.min(Math.floor(fi), ni - 2), j0 = Math.min(Math.floor(fj), nj - 2);
  const a = fi - i0, b = fj - j0;
  const w = [(1 - a) * (1 - b), (1 - a) * b, a * (1 - b), a * b];
  const pick = (arr) => [at(arr, grid, i0, j0, ti), at(arr, grid, i0, j0 + 1, ti), at(arr, grid, i0 + 1, j0, ti), at(arr, grid, i0 + 1, j0 + 1, ti)];
  const uu = pick(grid.u), vv = pick(grid.v);
  return [w[0] * uu[0] + w[1] * uu[1] + w[2] * uu[2] + w[3] * uu[3], w[0] * vv[0] + w[1] * vv[1] + w[2] * vv[2] + w[3] * vv[3]];
}

export function backTrajectory(grid, lat, lon, t0) {
  const path = [[0, lat, lon]];
  for (let k = 1; k <= HOURS_BACK / STEP_H; k++) {
    const ti = t0 - (k - 1);
    if (ti < 0 || ti >= grid.nt) break;
    const w = interpWind(grid, lat, lon, ti);
    if (!w) break;
    const dt = STEP_H * 3600;
    lat = lat - (w[1] * dt) / (KM_PER_DEG * 1000);
    lon = lon - (w[0] * dt) / (KM_PER_DEG * 1000 * Math.cos(rad(lat)));
    path.push([k * STEP_H, lat, lon]);
  }
  return path;
}

// fires: array of { lat, lon, t (hours on grid clock), frp }
export function smokeIndex(path, t0, fires) {
  let total = 0;
  const contrib = new Float64Array(fires.length);
  for (let p = 1; p < path.length; p++) {
    const [ago, plat, plon] = path[p];
    const t = t0 - ago;
    const sig = SIGMA0_KM + SIGMA_GROWTH_KM_PER_H * ago;
    const coslat = Math.cos(rad(plat));
    const tw = Math.exp(-ago / DECAY_H) / FIRE_WINDOW_H;
    for (let f = 0; f < fires.length; f++) {
      const fr = fires[f];
      if (Math.abs(fr.t - t) > FIRE_WINDOW_H) continue;
      const dy = (fr.lat - plat) * KM_PER_DEG;
      const dx = (fr.lon - plon) * KM_PER_DEG * coslat;
      const c = fr.frp * Math.exp(-(dx * dx + dy * dy) / (2 * sig * sig)) * tw * STEP_H;
      contrib[f] += c;
      total += c;
    }
  }
  return { total, contrib };
}

// Farm-fire share of PM2.5 from the backtest fit: share = 1 - (1 + S/S0)^(-c)
export function fireShare(S, coeffs) {
  return Math.max(0, 1 - Math.pow(1 + S / coeffs.S0, -coeffs.c));
}
