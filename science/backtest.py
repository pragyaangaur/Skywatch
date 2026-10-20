"""Backtest the smoke index against observed PM2.5 at New Delhi, Oct-Nov 2022-2025.

Model (daily, Delhi local days):
    log PM2.5 = met terms + c * log(1 + S / S0)
The meteorology-only model drops the last term. Both are scored leave-one-season-out,
so every season is predicted by a model that never saw it.

From the multiplicative form the farm-fire share of PM2.5 on a day is
    share = 1 - (1 + S / S0) ** (-c)
and that is the number the web app shows.

Run: python -I science/backtest.py   (after fetch.py)
Writes science/data/daily.csv, results.json and coeffs.json, plus web/backtest.json and web/lib/coeffs.js.
"""
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from smoke import back_trajectory, smoke_index  # noqa: E402

HERE = Path(__file__).resolve().parent
RAW = HERE / "data" / "raw"
OUT = HERE / "data"
YEARS = [2022, 2023, 2024, 2025]
DELHI = (28.63576, 77.22445)
START_HOURS_LOCAL = [2, 5, 8, 11, 14, 17, 20, 23]  # 8 arrivals a day
S0 = 50.0


def load_fires(y, t_origin):
    f = pd.concat([pd.read_csv(RAW / f"fires_{y}_{c}.csv") for c in ("India", "Pakistan")], ignore_index=True)
    t = pd.to_datetime(f.acq_date) + pd.to_timedelta(f.acq_time // 100, "h") + pd.to_timedelta(f.acq_time % 100, "m")
    hours = (t - t_origin).dt.total_seconds().to_numpy() / 3600.0
    return f.latitude.to_numpy(), f.longitude.to_numpy(), hours, f.frp.to_numpy()


def season_index(y):
    w = np.load(RAW / f"winds_{y}.npz")
    u, v, lat_g, lon_g = w["u"], w["v"], w["lat"], w["lon"]
    t_origin = pd.Timestamp(str(w["time"][0]))  # UTC
    flat, flon, ft, frp = load_fires(y, t_origin)
    rows = []
    for day in pd.date_range(f"{y}-10-01", f"{y}-11-30"):
        vals = []
        for h in START_HOURS_LOCAL:
            arr_utc = day + pd.Timedelta(hours=h) - pd.Timedelta(hours=5.5)
            t0 = (arr_utc - t_origin).total_seconds() / 3600.0
            ti = int(round(t0))
            path = back_trajectory(u, v, lat_g, lon_g, DELHI[0], DELHI[1], ti)
            s, _ = smoke_index(path, float(ti), flat, flon, ft, frp)
            vals.append(s)
        n_fires = int(((ft >= (day - t_origin).total_seconds() / 3600 - 24) &
                       (ft < (day - t_origin).total_seconds() / 3600)).sum())
        rows.append({"date": day.date(), "S": float(np.mean(vals)), "fires_prev_day_box": n_fires})
    return pd.DataFrame(rows)


def daily_obs(y):
    pm = pd.read_csv(RAW / f"pm25_delhi_{y}.csv")
    pm["date"] = pd.to_datetime(pm.datetime.str[:10]).dt.date
    g = pm.groupby("date").value.agg(["mean", "count"])
    g = g[g["count"] >= 16]
    met = pd.read_csv(RAW / f"met_delhi_{y}.csv")
    met["date"] = pd.to_datetime(met.time).dt.date
    m = met.groupby("date").agg(blh=("boundary_layer_height", "mean"),
                                ws=("wind_speed_10m", "mean"),
                                t2=("temperature_2m", "mean"),
                                rh=("relative_humidity_2m", "mean"),
                                rain=("precipitation", "sum"))
    return g.rename(columns={"mean": "pm25"})[["pm25"]].join(m, how="inner")


def design(d, with_fire):
    doy = pd.to_datetime(d.date).dt.dayofyear.to_numpy()
    cols = [np.ones(len(d)), np.log(d.blh.clip(lower=50)), d.ws, d.t2, d.rh,
            (d.rain > 1).astype(float), (doy - 290) / 30.0]
    if with_fire:
        cols.append(np.log1p(d.S / S0))
    return np.column_stack(cols)


def fit(X, y):
    beta, *_ = np.linalg.lstsq(X, y, rcond=None)
    return beta


def main():
    frames = []
    for y in YEARS:
        print("season", y)
        s = season_index(y)
        o = daily_obs(y).reset_index()
        d = s.merge(o, on="date", how="inner")
        d["season"] = y
        frames.append(d)
    d = pd.concat(frames, ignore_index=True).dropna()
    d.to_csv(OUT / "daily.csv", index=False)
    yl = np.log(d.pm25.to_numpy())

    res = {"n_days": int(len(d)), "by_season": {}}
    preds = {False: np.zeros(len(d)), True: np.zeros(len(d))}
    for y in YEARS:
        test = (d.season == y).to_numpy()
        for wf in (False, True):
            b = fit(design(d[~test], wf), yl[~test])
            preds[wf][test] = design(d[test], wf) @ b

    def r2(p, m=slice(None)):
        return float(1 - np.sum((yl[m] - p[m]) ** 2) / np.sum((yl[m] - yl[m].mean()) ** 2))

    def mape(p, m=slice(None)):
        return float(np.mean(np.abs(np.exp(p[m]) - d.pm25.to_numpy()[m]) / d.pm25.to_numpy()[m]))

    res["loso_r2_met_only"] = r2(preds[False])
    res["loso_r2_met_plus_fire"] = r2(preds[True])
    res["loso_mape_met_only"] = mape(preds[False])
    res["loso_mape_met_plus_fire"] = mape(preds[True])
    for y in YEARS:
        m = (d.season == y).to_numpy()
        res["by_season"][str(y)] = {"r2_met": r2(preds[False], m), "r2_fire": r2(preds[True], m),
                                    "days": int(m.sum()), "mean_pm25": float(d.pm25[m].mean())}

    # final coefficients on all seasons, with a block bootstrap by week for the fire term
    Xf = design(d, True)
    b = fit(Xf, yl)
    c = float(b[-1])
    rng = np.random.default_rng(0)
    weeks = (pd.to_datetime(d.date).dt.isocalendar().week.astype(int) + 100 * d.season).to_numpy()
    uw = np.unique(weeks)
    cs = []
    for _ in range(1000):
        pick = rng.choice(uw, len(uw))
        idx = np.concatenate([np.flatnonzero(weeks == w) for w in pick])
        cs.append(fit(Xf[idx], yl[idx])[-1])
    res["fire_coeff_c"] = c
    res["fire_coeff_ci95"] = [float(np.percentile(cs, 2.5)), float(np.percentile(cs, 97.5))]

    d["pred"] = np.exp(preds[True])
    d["pred_met"] = np.exp(preds[False])
    d["fire_share"] = 1 - (1 + d.S / S0) ** (-c)
    d["fire_share"] = d.fire_share.clip(lower=0)
    res["share_mean_by_season"] = {str(y): float(d.fire_share[d.season == y].mean()) for y in YEARS}
    res["share_peak_by_season"] = {
        str(y): {"date": str(d.date[d.season == y].iloc[int(np.argmax(d.fire_share[d.season == y]))]),
                 "share": float(d.fire_share[d.season == y].max())} for y in YEARS}
    res["corr_S_vs_residual_of_met_model"] = float(np.corrcoef(np.log1p(d.S / S0), yl - preds[False])[0, 1])
    d.to_csv(OUT / "daily.csv", index=False)
    (OUT / "results.json").write_text(json.dumps(res, indent=2))
    (OUT / "coeffs.json").write_text(json.dumps({"c": c, "S0": S0, "ci95": res["fire_coeff_ci95"]}, indent=2))
    pub = HERE.parent / "web" / "backtest.json"
    cols = ["date", "season", "pm25", "pred", "pred_met", "S", "fire_share"]
    daily = d[cols].assign(date=d.date.astype(str)).round(3).to_dict(orient="records")
    pub.write_text(json.dumps({"results": res, "daily": daily}))
    (HERE.parent / "web" / "lib" / "coeffs.js").write_text(
        "// Written by science/backtest.py. Do not edit by hand.\nexport default " + (OUT / "coeffs.json").read_text().replace("\n", "").replace("  ", "") + ";\n")
    print(json.dumps(res, indent=2))


if __name__ == "__main__":
    main()
