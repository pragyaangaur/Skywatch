import { test } from "node:test";
import assert from "node:assert/strict";
import { backTrajectory, smokeIndex, fireShare } from "../web/lib/smoke.js";
import { band } from "../web/lib/report.js";

// uniform 5 m/s wind from the north-west on a small grid
function grid(u, v, nt = 72) {
  const lat = [24, 26, 28, 30, 32, 34], lon = [70, 72, 74, 76, 78, 80, 82];
  const n = lat.length * lon.length * nt;
  return { lat, lon, nt, u: new Float64Array(n).fill(u), v: new Float64Array(n).fill(v) };
}

test("trajectory runs upwind", () => {
  const g = grid(3.5, -3.5); // blowing towards the south-east
  const p = backTrajectory(g, 28.6, 77.2, 60);
  const [, la, lo] = p[p.length - 1];
  assert.ok(la > 28.6 && lo < 77.2, "start of path should be north-west of Delhi");
  assert.equal(p.length, 49);
});

test("a fire on the path counts, a fire off it does not", () => {
  const g = grid(3.5, -3.5);
  const p = backTrajectory(g, 28.6, 77.2, 60);
  const [ago, la, lo] = p[12];
  const on = smokeIndex(p, 60, [{ lat: la, lon: lo, t: 60 - ago, frp: 100 }]).total;
  const off = smokeIndex(p, 60, [{ lat: 25, lon: 81, t: 60 - ago, frp: 100 }]).total;
  const late = smokeIndex(p, 60, [{ lat: la, lon: lo, t: 60 - ago + 30, frp: 100 }]).total;
  assert.ok(on > 1);
  assert.ok(off < 1e-6);
  assert.equal(late, 0);
});

test("fire share is 0 with no smoke and rises with it", () => {
  const c = { c: 0.3, S0: 50 };
  assert.equal(fireShare(0, c), 0);
  assert.ok(fireShare(100, c) < fireShare(1000, c));
  assert.ok(fireShare(1e9, c) < 1);
});

test("CPCB PM2.5 bands", () => {
  assert.equal(band(30).name, "Good");
  assert.equal(band(31).name, "Satisfactory");
  assert.equal(band(121).name, "Very Poor");
  assert.equal(band(400).name, "Severe");
});
