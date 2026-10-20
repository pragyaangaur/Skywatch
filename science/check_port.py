"""Check that lib/smoke.js gives the same smoke index as science/smoke.py.

Builds a random but smooth wind field and fire set, runs both, compares.
Run: python -I science/check_port.py
"""
import json
import subprocess
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from smoke import back_trajectory, smoke_index  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
rng = np.random.default_rng(1)
lat = np.arange(24.0, 34.01, 1.0)
lon = np.arange(70.0, 86.01, 1.0)
nt = 96
tt = np.arange(nt)
u = (3 + 2 * np.sin(lat[:, None, None] / 3) + np.cos(tt[None, None, :] / 9)) * np.ones((len(lat), len(lon), nt))
v = (-2 + np.cos(lon[None, :, None] / 4) + 0.5 * np.sin(tt[None, None, :] / 7)) * np.ones((len(lat), len(lon), nt))
n = 3000
fl = rng.uniform(28, 33, n)
fo = rng.uniform(72, 78, n)
ft = rng.uniform(0, nt, n)
fp = rng.gamma(2, 8, n)

cases = [(28.61, 77.21, 80), (26.85, 80.95, 70), (30.9, 75.85, 60)]
py = []
for la, lo, t0 in cases:
    path = back_trajectory(u, v, lat, lon, la, lo, t0)
    py.append(smoke_index(path, float(t0), fl, fo, ft, fp)[0])

payload = {
    "grid": {"lat": lat.tolist(), "lon": lon.tolist(), "nt": nt, "u": u.ravel().tolist(), "v": v.ravel().tolist()},
    "fires": [{"lat": a, "lon": b, "t": c, "frp": d} for a, b, c, d in zip(fl, fo, ft, fp)],
    "cases": cases,
}
js = f"""
import {{ backTrajectory, smokeIndex }} from {json.dumps(str(ROOT / "web" / "lib" / "smoke.js"))};
let s = ""; for await (const c of process.stdin) s += c;
const p = JSON.parse(s);
console.log(JSON.stringify(p.cases.map(([la, lo, t0]) => smokeIndex(backTrajectory(p.grid, la, lo, t0), t0, p.fires).total)));
"""
out = subprocess.run(["node", "--input-type=module", "-e", js], input=json.dumps(payload), capture_output=True, text=True, check=True)
jsv = json.loads(out.stdout)
for (la, lo, _), a, b in zip(cases, py, jsv):
    print(f"{la:6.2f} {lo:6.2f}  python {a:12.4f}  js {b:12.4f}  rel diff {abs(a - b) / max(a, 1e-9):.2e}")
assert all(abs(a - b) <= 1e-9 * max(1, a) for a, b in zip(py, jsv)), "port mismatch"
print("port matches")
