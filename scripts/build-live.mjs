// Builds web/data/live.json: the last 7 days of VIIRS fires plus the 925 hPa wind grid.
// The GitHub Pages workflow runs this every hour. FIRMS sends no CORS header, so the
// browser cannot fetch fires itself. If the wind fetch fails, the file still ships with
// fires only and the browser fetches the winds from Open-Meteo directly.
import { writeFile, mkdir } from "node:fs/promises";
import { fetchFires, fetchWindGrid } from "../web/lib/data.js";

const out = new URL("../web/data/live.json", import.meta.url);
const fires = await fetchFires();
let grid = null;
try {
  grid = await fetchWindGrid();
} catch (e) {
  console.warn("wind grid skipped:", e.message);
}
await mkdir(new URL("../web/data/", import.meta.url), { recursive: true });
const body = JSON.stringify({
  builtAt: new Date().toISOString(),
  fires: fires.map((f) => ({ lat: +f.lat.toFixed(4), lon: +f.lon.toFixed(4), when: f.when, frp: f.frp })),
  grid,
});
await writeFile(out, body);
console.log(`live.json: ${fires.length} fires, winds ${grid ? "included" : "missing"}, ${(body.length / 1024).toFixed(0)} KB`);
