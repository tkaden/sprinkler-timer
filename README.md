# sprinkler-timer

A morning text that tells you whether to water the lawn today, when, and for how long. Built for Olathe, KS.

```
Lawn Fri 11/13: WATER 12 min at ~11am = .10" total (new seed, day 10). Why: keep the top 1/4" damp so seed can germinate. Hi 52/Lo 31F, 10% rain chance. Rain past 24h: .00".
```

```
Lawn Wed 7/15: NO WATER today - rain likely: ~.30" today (80%), ~.50" tomorrow (70%). Hi 88/Lo 68F, 80% rain chance. Rain past 24h: .00".
```

## How it decides

The weather comes from [Open-Meteo](https://open-meteo.com/), which is free and needs no API key. It provides the last 14 days of rain and evapotranspiration (ET₀) plus a 3-day forecast.

| Stage | When | Rule |
|---|---|---|
| **New seed** | Days 0–20 after `SEED_DATE` | Keeps the top ¼" damp with 0.10–0.30" a day. That's 1 cycle on cool days, 2 on warm days, and 3 above 85°F. Skips if ≥ 0.25" fell yesterday or rain is very likely today. |
| **Young grass** | Days 21–41 | Shallow bucket. Waters back up to 0.4" once 0.2" has been used. |
| **Established** | After day 41, or with no `SEED_DATE` | Deep and infrequent. Waters up to 1" once 0.5" has been used. Splits the water into 0.3" cycles so the clay soil can soak it in. |

The established and young stages use a soil "bucket" model. Every day the lawn loses ET₀ × 0.8 (cool-season turf) and gains effective rain (≥ 0.1") plus whatever it told you to water. The script assumes you followed yesterday's advice and records it in `state/history.json`.

It always:
- skips watering when the day's high is below 40°F
- holds off when the forecast rain for today and tomorrow will cover at least half the deficit
- moves watering to late morning after a frosty night

## Setup

1. **Measure your sprinkler.** Set out a few straight-sided cans and run the sprinkler for 15 minutes. Multiply the depth in inches by 4 to get inches per hour.
2. **Repo variables** (Settings → Secrets and variables → Actions → *Variables*):
   - `SPRINKLER_RATE_IN_PER_HR`: for example `0.5` (that's the default)
   - `SEED_DATE`: the day you overseeded, for example `2026-09-15`. Leave it unset for an established lawn.
3. **Delivery secrets** (same page, *Secrets*). Use one or both options:
   - **SMS via Twilio:** `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` (your Twilio number in `+1…` form, or a Messaging Service SID `MG…`), and `SMS_TO` (your cell, `+1…`). US carriers require a registered sender. A Twilio toll-free number with toll-free verification is the easiest route for personal use.
   - **Free push via [ntfy](https://ntfy.sh):** install the ntfy app, subscribe to a hard-to-guess topic name, and set `NTFY_TOPIC` to that name.
4. Run it once by hand: go to Actions → *Daily watering text* → *Run workflow* and tick *dry run* to just see the message.

After that, it runs every morning at about 5:45am CST (6:45am CDT).

## Local use

```bash
npm ci
npm test
SEED_DATE=2026-09-15 npm run notify -- --dry-run
```
