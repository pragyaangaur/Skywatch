# SkyWatch

SkyWatch tells people in North India how much of the smoke they are breathing comes from farm fires, where those fires are, and which hours of today and tomorrow are cleanest to be outside. It answers questions such as "can my kids play outside this evening?" in Hindi or English.

It is built for the stubble burning season, when October and November smog over Delhi and the Indo-Gangetic plain reaches hundreds of millions of people.

## What it does

You pick a place (search, map link or your location) and SkyWatch shows four things.

1. **Air now.** The 24 hour average PM2.5 from the CAMS forecast, with its category on the CPCB National AQI scale.
2. **From farm fires.** The estimated share of that PM2.5 that is smoke from crop fires, for the last 24 hours and for the next 24.
3. **Cleanest time outside.** The cleanest two daylight hours today and tomorrow, and the worst hour to avoid.
4. **Where the air came from.** A map with the 48 hour back-trajectories of the air reaching you and the fires that fed it, sized by how much of your smoke each one supplied.

You can also ask a question in Hindi or English, such as "can my kids play outside this evening?" or "लखनऊ में हवा कैसी है?". SkyWatch answers from the same numbers, using a template for the kind of question asked. You can turn on an optional language model that runs inside your own browser (Qwen 2.5 through WebLLM and WebGPU) to get more natural replies. The model is downloaded once, about 1 GB, or 400 MB with `?ai=small`. Your questions never leave the device. Every number in a model reply is checked against SkyWatch's data, and a reply with a number that is not in the data is replaced by the template answer.

## How the smoke share is computed

Every three hours the app releases a parcel of air at your location and walks it back 48 hours through the 925 hPa wind field (about 750 m up, inside the daytime mixed layer where stubble smoke travels). Each fire that NASA's VIIRS instrument detected close to that path, at about the time the air passed over it, adds its fire radiative power. The weight falls off with distance from the path (a plume that widens from 20 km by 1.5 km per hour of travel) and with travel time (36 hour decay). The sum is the smoke index S.

The share of PM2.5 from farm fires is then `1 - (1 + S/50)^(-c)`, where c comes from a regression of measured PM2.5 on weather plus `log(1 + S/50)`. The fitted value is c = 0.197 (95% interval 0.140 to 0.247 from a weekly block bootstrap).

## Does it work? The Delhi backtest

The method was tested against 236 days of measured PM2.5 at the US Embassy monitor in New Delhi (OpenAQ archive) across four stubble seasons, 1 October to 30 November in 2022, 2023, 2024 and 2025. Each season was predicted by a model that was fitted only on the other three seasons.

| Season | Days | Mean PM2.5 | R² weather only | R² weather plus smoke index | Mean farm-fire share | Peak day |
| --- | --- | --- | --- | --- | --- | --- |
| 2022 | 61 | 131 | 0.50 | 0.58 | 30% | 4 Nov, 64% |
| 2023 | 61 | 162 | 0.68 | 0.85 | 30% | 7 Nov, 61% |
| 2024 | 61 | 162 | 0.47 | 0.60 | 23% | 19 Nov, 50% |
| 2025 | 53 | 143 | 0.59 | 0.47 | 18% | 10 Nov, 44% |
| All, out of sample | 236 | | 0.56 | 0.62 | | |

The typical daily error falls from 40% to 35%. The index helps in three seasons and hurts in 2025, which was a light burning year.

Fires and smog both peak in early November, so a calendar effect could fake this result. To test that, each season was given the smoke index of the same dates in a different season. This placebo keeps the seasonal shape and breaks the link with the day's real winds and fires. It reaches an R² of 0.57, close to weather alone, while the real index reaches 0.62. Most of the gain therefore comes from the trajectories.

The fitted shares sit inside the range of published estimates and towards the high end. A SAFAR-based study found single-day biomass burning shares of up to 58% depending on the air-mass path, and IITM's Decision Support System forecast about 31% on its worst days in November 2025. A January 2025 study put the overall seasonal share at about 14%. The share here should be read as a guide.

Reproduce it with:

```bash
python -I science/fetch.py
python -I science/backtest.py
python -I science/placebo.py
python -I science/check_port.py
```

`fetch.py` downloads about 250 MB of public data and keeps the filtered parts in `science/data/raw/`. `check_port.py` confirms that the JavaScript used by the site (`web/lib/smoke.js`) gives the same index as the Python reference (`science/smoke.py`) to 1e-14.

## Limits

The PM2.5 numbers are the CAMS model forecast for the grid cell, not a reading at your street. The farm-fire share is calibrated on one Delhi monitor, so in other cities it is a rough guide. Forward-looking shares assume the last 24 hours of fires repeat a day later. VIIRS misses fires under thick cloud and small fires, and fire radiative power is an imperfect proxy for smoke emitted. The regression measures association with a physically motivated index and does not replace a chemical transport model.

## How the site is built

SkyWatch is a static site in `web/`, and all of the computing happens in the browser. The browser reads the CAMS forecast and place search directly from Open-Meteo. NASA FIRMS does not allow browsers to read its files from other sites, so a GitHub Actions workflow runs `scripts/build-live.mjs` every hour. That script writes the last 7 days of fire detections and the 925 hPa wind grid to `web/data/live.json` and then publishes `web/` to GitHub Pages. If the prebuilt winds are too old, the browser fetches them from Open-Meteo itself.

## Running it

You need Node 20 or newer. There are no dependencies to install.

```bash
npm run live    # fetch fires and winds into web/data/live.json
npm run dev     # serve web/ at http://localhost:3000
npm test
```

## Data sources

All inputs are open and need no key.

- Active fires: NASA FIRMS, VIIRS on Suomi NPP (near real time and yearly archives for India and Pakistan).
- Winds at 925 hPa and the CAMS PM2.5 forecast: Open-Meteo.
- Weather for the backtest: ERA5 via the Open-Meteo archive.
- Measured PM2.5: the OpenAQ public archive of the US Embassy New Delhi monitor.
- Place search: Open-Meteo geocoding. Map tiles: OpenStreetMap.

Health guidance follows the CPCB National AQI advisories. SkyWatch is not medical advice.

## Licence

MIT. Built for Code for a Billion 2026 (Code for India).
