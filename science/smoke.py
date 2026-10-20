"""Back-trajectories and the farm-fire smoke index.

This is the reference implementation. `web/lib/smoke.js` in the web app is a line-by-line port
and `science/check_port.py` checks that the two agree.

The idea: air arriving at a city at hour t was somewhere upwind at t-1, t-2, ... t-48.
We walk that path backwards through the 925 hPa wind field (about 750 m up, inside the
daytime mixed layer, which is where stubble smoke travels). Every fire that was burning
close to the path at the time the air passed over it adds its radiative power, weighted by
how close the path came and how long ago that was. The sum is the smoke index S.
"""
import numpy as np

HOURS_BACK = 48
STEP_H = 1.0
KM_PER_DEG = 111.2
SIGMA0_KM = 20.0  # plume half-width at the source
SIGMA_GROWTH_KM_PER_H = 1.5  # plume widening with travel time
FIRE_WINDOW_H = 6.0  # a VIIRS detection stands for burning within +-6 h of the overpass
DECAY_H = 36.0  # dilution and deposition along the path


def interp_wind(u, v, lat_grid, lon_grid, lat, lon, ti):
    """Bilinear interpolation of u, v (shape lat x lon x time) at one point and hour index."""
    fi = (lat - lat_grid[0]) / (lat_grid[1] - lat_grid[0])
    fj = (lon - lon_grid[0]) / (lon_grid[1] - lon_grid[0])
    if fi < 0 or fj < 0 or fi > len(lat_grid) - 1 or fj > len(lon_grid) - 1:
        return None
    i0, j0 = min(int(fi), len(lat_grid) - 2), min(int(fj), len(lon_grid) - 2)
    a, b = fi - i0, fj - j0
    w = np.array([(1 - a) * (1 - b), (1 - a) * b, a * (1 - b), a * b])
    uu = np.array([u[i0, j0, ti], u[i0, j0 + 1, ti], u[i0 + 1, j0, ti], u[i0 + 1, j0 + 1, ti]])
    vv = np.array([v[i0, j0, ti], v[i0, j0 + 1, ti], v[i0 + 1, j0, ti], v[i0 + 1, j0 + 1, ti]])
    return float(w @ uu), float(w @ vv)


def back_trajectory(u, v, lat_grid, lon_grid, lat, lon, t0):
    """Walk back HOURS_BACK hours from hour index t0. Returns list of (hours_ago, lat, lon)."""
    path = [(0.0, lat, lon)]
    for k in range(1, int(HOURS_BACK / STEP_H) + 1):
        ti = t0 - (k - 1)
        if ti < 0 or ti >= u.shape[2]:
            break
        w = interp_wind(u, v, lat_grid, lon_grid, lat, lon, ti)
        if w is None:
            break
        uu, vv = w
        dt = STEP_H * 3600.0
        lat = lat - vv * dt / (KM_PER_DEG * 1000.0)
        lon = lon - uu * dt / (KM_PER_DEG * 1000.0 * np.cos(np.deg2rad(lat)))
        path.append((k * STEP_H, lat, lon))
    return path


def smoke_index(path, t0_hours, fire_lat, fire_lon, fire_t, fire_frp):
    """Sum of fire radiative power seen along a path.

    t0_hours: arrival time in hours (same clock as fire_t).
    fire_*: numpy arrays of fire detections, fire_t in hours on the same clock.
    """
    total = 0.0
    contrib = np.zeros(len(fire_frp))
    for hours_ago, plat, plon in path[1:]:
        t = t0_hours - hours_ago
        dt = np.abs(fire_t - t)
        m = dt <= FIRE_WINDOW_H
        if not m.any():
            continue
        dy = (fire_lat[m] - plat) * KM_PER_DEG
        dx = (fire_lon[m] - plon) * KM_PER_DEG * np.cos(np.deg2rad(plat))
        sig = SIGMA0_KM + SIGMA_GROWTH_KM_PER_H * hours_ago
        w = np.exp(-(dx * dx + dy * dy) / (2 * sig * sig))
        w *= np.exp(-hours_ago / DECAY_H) / FIRE_WINDOW_H
        c = fire_frp[m] * w * STEP_H
        contrib[m] += c
        total += c.sum()
    return total, contrib
