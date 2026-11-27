# PulseGuard rating

A motivational score for runners, inspired by chess ratings. It is **not** a fitness or medical assessment, and while the shirt is simulated every run counts at **50 %**.

Code: [`src/rating.js`](../src/rating.js) (pure functions) · tests: [`test/rating.test.js`](../test/rating.test.js).

## Ranks and divisions

| Rating | Rank |
| --- | --- |
| 0 – 999 | Rookie |
| 1000 – 1999 | Pacer |
| 2000 – 2999 | Racer |
| 3000 – 3999 | Master |
| 4000 – 4999 | Grand Master |
| 5000 + | Legend (no cap) |

Every 100 points is a division: X is the lowest, I the highest (`Master II` = 3800–3899). Above 6000 a Legend has no division. New runners start at **500 (Rookie V)**. Promotion is instant.

## A rated run

A run counts only if it lasts at least **5 minutes**, never goes above **25 km/h**, and the signal was not lost for more than **30 %** of the time. A run with an **urgent alert** never earns rating ("rest is part of training").

```
actual    = 0.35·min(1, km/10) + 0.25·clamp((km/h − 6)/10) + 0.25·(time in zones 2–3) + 0.15·(1 − clamp(drift/20))
expected  = 0.30 + 0.55·min(1, rating/6000)
K         = 40 for the first 20 rated runs, 20 until 60, then 12
gain      = max(0, K·(actual − expected))
          + goal bonus (5K +6, 10K +10, half marathon +18) × max(0.5, 1.5 − rating/4000)
          + plan bonus (up to +4 × plan adherence)
gain      × difficulty (1.0–1.5: +0.15 heat ≥ 28 °C air or ≥ 37 °C skin, +0.10 humidity > 70 %, +0.10 before 6:00 or after 21:00)
          × consistency (1.0–1.2: +0.05 per run per week above 1, over the last 4 weeks)
          × 0.5 for simulated data
delta     = min(60, round(gain))
```

Ratings never go down after a run or a challenge. The only loss is **inactivity**: −5 per week after 14 days without a run, never below the start of the current rank (the **rank shield**).

## Calibration

Simulated with `rateRun` (3 runs a week, real sensor, consistency ×1.15):

| Runner | Reaches 1000 | 2000 | 3000 |
| --- | --- | --- | --- |
| Beginner, 5 km at 8.5 km/h | week 13 | week 54 | week 113 |
| Same beginner, simulated data (×0.5) | week 28 | week 111 | — |
| Regular, 10 km at 11 km/h | week 6 | week 22 | week 49 |

## Challenges

Finisher **+10**, winner **+5** extra, × difficulty × level-gap factor (×0.5 when the ratings differ by more than 300). A runner who does not finish gets nothing, never a loss. See [`src/challenges.js`](../src/challenges.js).

## Enforcement

Security rules accept a rating change only through a rating event that refers to a real saved run (or a challenge the user takes part in), once per run, with |delta| ≤ 60 and the rank shield for decay. They cannot recompute the formula: full server-side enforcement needs a Cloud Function (TODO: `rateRun` is written to be called from one unchanged).
