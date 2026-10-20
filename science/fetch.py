"""Download the open data for the Delhi backtest.

Three sources, none of which needs an API key:
  - NASA FIRMS VIIRS (Suomi NPP) yearly active-fire files for India
  - OpenAQ public S3 archive, hourly PM2.5 at the US Embassy New Delhi monitor (location 8118)
  - Open-Meteo historical forecast API, hourly 925 hPa winds on a 1 degree grid
  - Open-Meteo ERA5 archive, boundary layer height, 10 m wind, temperature, humidity and rain at Delhi

Run: python -I science/fetch.py
"""
import gzip
import io
import json
import sys
import time
import urllib.request
from pathlib import Path

import numpy as np
import pandas as pd

RAW = Path(__file__).resolve().parent / "data" / "raw"
RAW.mkdir(parents=True, exist_ok=True)

YEARS = [2022, 2023, 2024, 2025]
SEASON = ("10-01", "11-30")
# fires are counted from 2 days before the season so trajectories on 1 Oct see them
FIRE_START = "09-28"

# Indo-Gangetic plain box used for fires and winds
LAT = np.arange(24.0, 34.01, 1.0)
LON = np.arange(70.0, 86.01, 1.0)

DELHI = (28.63576, 77.22445)
OPENAQ_LOCATION = 8118


def get(url, tries=4):
    for k in range(tries):
        try:
            with urllib.request.urlopen(url, timeout=120) as r:
                return r.read()
        except Exception as e:  # noqa: BLE001
            if k == tries - 1:
                raise
            print("  retry", url[:90], e, file=sys.stderr)
            time.sleep(5 * (k + 1))


def fetch_fires():
    # Pakistan's Punjab burns in the same weeks and sits upwind of Delhi, so both countries count
    for y in YEARS:
        for country in ("India", "Pakistan"):
            out = RAW / f"fires_{y}_{country}.csv"
            if out.exists():
                continue
            print("fires", y, country)
            url = f"https://firms.modaps.eosdis.nasa.gov/data/country/viirs-snpp/{y}/viirs-snpp_{y}_{country}.csv"
            df = pd.read_csv(io.BytesIO(get(url)))
            df = df[(df.acq_date >= f"{y}-{FIRE_START}") & (df.acq_date <= f"{y}-{SEASON[1]}")]
            df = df[df.latitude.between(LAT[0], LAT[-1]) & df.longitude.between(LON[0], LON[-1])]
            df = df[df.confidence != "l"]
            df[["latitude", "longitude", "acq_date", "acq_time", "frp", "daynight"]].to_csv(out, index=False)


def fetch_pm25():
    base = "https://openaq-data-archive.s3.amazonaws.com"
    for y in YEARS:
        out = RAW / f"pm25_delhi_{y}.csv"
        if out.exists():
            continue
        print("pm25", y)
        frames = []
        for day in pd.date_range(f"{y}-{FIRE_START}", f"{y}-{SEASON[1]}"):
            key = (f"records/csv.gz/locationid={OPENAQ_LOCATION}/year={day.year}/month={day.month:02d}/"
                   f"location-{OPENAQ_LOCATION}-{day:%Y%m%d}.csv.gz")
            try:
                raw = get(f"{base}/{key}", tries=2)
            except Exception:  # noqa: BLE001
                continue
            frames.append(pd.read_csv(io.BytesIO(gzip.decompress(raw))))
        df = pd.concat(frames)
        df = df[(df.parameter == "pm25") & (df.value >= 0) & (df.value < 1500)]
        df[["datetime", "value"]].to_csv(out, index=False)


def fetch_winds():
    lats, lons = np.meshgrid(LAT, LON, indexing="ij")
    pts = list(zip(lats.ravel(), lons.ravel()))
    for y in YEARS:
        out = RAW / f"winds_{y}.npz"
        if out.exists():
            continue
        print("winds", y, len(pts), "points")
        u_all, v_all, times = [], [], None
        for i in range(0, len(pts), 50):
            chunk = pts[i:i + 50]
            url = ("https://historical-forecast-api.open-meteo.com/v1/forecast?"
                   f"latitude={','.join(f'{p[0]:.2f}' for p in chunk)}"
                   f"&longitude={','.join(f'{p[1]:.2f}' for p in chunk)}"
                   "&hourly=wind_speed_925hPa,wind_direction_925hPa&wind_speed_unit=ms"
                   f"&start_date={y}-{FIRE_START}&end_date={y}-{SEASON[1]}&timezone=GMT")
            res = json.loads(get(url))
            if isinstance(res, dict):
                res = [res]
            for r in res:
                h = r["hourly"]
                s = np.array(h["wind_speed_925hPa"], dtype=float)
                d = np.deg2rad(np.array(h["wind_direction_925hPa"], dtype=float))
                # meteorological convention: direction the wind blows from
                u_all.append(-s * np.sin(d))
                v_all.append(-s * np.cos(d))
                times = h["time"]
            time.sleep(2)
        u = np.array(u_all).reshape(len(LAT), len(LON), -1)
        v = np.array(v_all).reshape(len(LAT), len(LON), -1)
        np.savez_compressed(out, u=u, v=v, lat=LAT, lon=LON, time=np.array(times))


def fetch_met():
    for y in YEARS:
        out = RAW / f"met_delhi_{y}.csv"
        if out.exists():
            continue
        print("met", y)
        url = ("https://archive-api.open-meteo.com/v1/archive?models=era5"
               f"&latitude={DELHI[0]}&longitude={DELHI[1]}"
               "&hourly=boundary_layer_height,wind_speed_10m,temperature_2m,relative_humidity_2m,precipitation"
               f"&wind_speed_unit=ms&start_date={y}-{FIRE_START}&end_date={y}-{SEASON[1]}&timezone=Asia/Kolkata")
        h = json.loads(get(url))["hourly"]
        pd.DataFrame(h).to_csv(out, index=False)


if __name__ == "__main__":
    fetch_fires()
    fetch_pm25()
    fetch_met()
    fetch_winds()
    print("done")
