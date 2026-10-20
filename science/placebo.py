"""Placebo test: is the smoke index only a calendar effect?

Fires and smog both peak in early November, so any fire count would track PM2.5.
Here each season gets the smoke index of the same calendar day in a different season.
That keeps the seasonal shape and breaks the link between that day's winds and fires.
If the real index is doing physical work, the placebo should help much less.

Run after backtest.py: python -I science/placebo.py
"""
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from backtest import YEARS, design, fit  # noqa: E402

HERE = Path(__file__).resolve().parent
d = pd.read_csv(HERE / "data" / "daily.csv")
d["md"] = d.date.str[5:]
yl = np.log(d.pm25.to_numpy())


def loso_r2(frame):
    p = np.zeros(len(frame))
    for y in YEARS:
        test = (frame.season == y).to_numpy()
        b = fit(design(frame[~test], True), yl[~test])
        p[test] = design(frame[test], True) @ b
    return float(1 - np.sum((yl - p) ** 2) / np.sum((yl - yl.mean()) ** 2))


real = loso_r2(d)
lookup = d.set_index(["season", "md"]).S
out = {"real": real, "placebo": {}}
for shift in (1, 2, 3):
    pl = d.copy()
    donor = [YEARS[(YEARS.index(s) + shift) % len(YEARS)] for s in pl.season]
    pl["S"] = [lookup.get((y, md), np.nan) for y, md in zip(donor, pl.md)]
    pl["S"] = pl.S.fillna(pl.S.median())
    out["placebo"][f"shift_{shift}"] = loso_r2(pl)
met_only = json.loads((HERE / "data" / "results.json").read_text())["loso_r2_met_only"]
out["met_only"] = met_only
out["placebo_mean"] = float(np.mean(list(out["placebo"].values())))
(HERE / "data" / "placebo.json").write_text(json.dumps(out, indent=2))
pub = HERE.parent / "web" / "backtest.json"
bt = json.loads(pub.read_text())
bt["results"]["placebo_r2"] = out["placebo_mean"]
pub.write_text(json.dumps(bt))
print(json.dumps(out, indent=2))
