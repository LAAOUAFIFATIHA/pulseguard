import { test } from "node:test";
import assert from "node:assert/strict";
import {
  rankOf, decayed, rateRun, applyDelta, ineligible, difficulty, consistency, zoneSeconds, drift, enduranceScore, START, MAX_DELTA,
} from "../src/rating.js";

const run = (o = {}) => ({ seconds: 2100, distanceM: 5000, zones: [0, 60, 0, 40, 0], driftBpm: 6, source: "sensor", ...o });
const state = (rating, runsRated = 0) => ({ rating, peak: rating, runsRated });

test("rank and division boundaries", () => {
  assert.equal(rankOf(500).label, "Rookie V");
  assert.equal(rankOf(0).label, "Rookie X");
  assert.equal(rankOf(99).label, "Rookie X");
  assert.equal(rankOf(100).label, "Rookie IX");
  assert.equal(rankOf(999).label, "Rookie I");
  assert.equal(rankOf(1000).label, "Pacer X");
  assert.equal(rankOf(3850).label, "Master II");
  assert.equal(rankOf(3850).toNextRank, 150);
  assert.equal(rankOf(3850).nextRank, "Grand Master");
  assert.equal(rankOf(5999).label, "Legend I");
  assert.equal(rankOf(7400).label, "Legend");
  assert.equal(rankOf(1234).toNextDivision, 66);
});

test("examples table", () => {
  const easy5k = rateRun(run(), state(START));
  assert.ok(easy5k.delta >= 10 && easy5k.delta <= 20, `new runner easy 5K: ${easy5k.delta}`);
  const hot10k = rateRun(run({ seconds: 3300, distanceM: 10000, avgTempC: 37, avgHumidity: 80, startHour: 5 }), state(1200, 40));
  const cool10k = rateRun(run({ seconds: 3300, distanceM: 10000 }), state(1200, 40));
  assert.ok(hot10k.delta > cool10k.delta, "hard hot 10K gains more than the same run in cool weather");
  assert.ok(hot10k.reasons.some((r) => r.includes("tough conditions")));
  const alert = rateRun(run({ urgent: true }), state(START));
  assert.equal(alert.delta, 0);
  assert.match(alert.reasons[0], /rest is part of training/i);
});

test("anti-cheat: short, impossible or signal-lost runs give nothing", () => {
  assert.equal(ineligible(run({ seconds: 240 })), "Shorter than 5 minutes");
  assert.equal(ineligible(run({ maxSpeedKmh: 30 })), "Impossible running speed");
  assert.match(ineligible(run({ noSignalPct: 0.4 })), /Signal lost/);
  assert.equal(rateRun(run({ seconds: 120 }), state(START)).delta, 0);
  assert.equal(ineligible(run()), null);
});

test("simulated runs count half; deltas never exceed 60 or go negative", () => {
  const real = rateRun(run(), state(START)).delta;
  const sim = rateRun(run({ source: "simulated" }), state(START)).delta;
  assert.ok(Math.abs(sim - real / 2) <= 1);
  const huge = rateRun(run({ distanceM: 42195, seconds: 9000, avgTempC: 38, avgHumidity: 90, startHour: 4 }), state(0));
  assert.ok(huge.delta <= MAX_DELTA);
  const weak = rateRun(run({ distanceM: 1500, seconds: 900, zones: [100, 0, 0, 0, 0], driftBpm: 30 }), state(5500, 200));
  assert.equal(weak.delta, 0);
});

test("factors stay in range", () => {
  assert.equal(difficulty(run()), 1);
  assert.equal(difficulty(run({ avgTempC: 38, avgHumidity: 90, startHour: 22, airTempC: 35 })), 1.35);
  assert.equal(consistency(0), 1);
  assert.equal(consistency(40), 1.2);
});

test("inactivity decay with a rank shield", () => {
  const day = 86400000;
  assert.deepEqual(decayed(1234, 0, 10 * day), { rating: 1234, weeks: 0 });
  assert.equal(decayed(1234, 0, 14 * day).rating, 1229);
  assert.equal(decayed(1234, 0, 35 * day).rating, 1214);
  assert.equal(decayed(1012, 0, 200 * day).rating, 1000, "never below the start of Pacer");
  assert.equal(decayed(1234, 0, 35 * day, 3).weeks, 1, "weeks already applied are not counted twice");
});

test("calibration: a consistent beginner reaches 1000 in 10-14 weeks, the next rank takes far longer", () => {
  let s = state(START);
  const weekReached = {};
  for (let i = 1; i <= 600; i++) {
    const { delta } = rateRun(run({ seconds: 2118 }), s, { runsLast4Weeks: 12 });
    s = { ...applyDelta(s, delta), runsRated: s.runsRated + 1 };
    for (const t of [1000, 2000]) if (!weekReached[t] && s.rating >= t) weekReached[t] = Math.ceil(i / 3);
  }
  assert.ok(weekReached[1000] >= 10 && weekReached[1000] <= 14, `week ${weekReached[1000]}`);
  assert.ok(weekReached[2000] > 2.5 * weekReached[1000], `week ${weekReached[2000]}`);
});

test("peak and rank follow the rating", () => {
  const s = applyDelta({ rating: 990, peak: 990 }, 15);
  assert.deepEqual([s.rating, s.peak, s.rank], [1005, 1005, "Pacer"]);
});

test("zones, drift and endurance score", () => {
  assert.deepEqual(zoneSeconds([{ seconds: 10, hr: 100 }, { seconds: 10, hr: 130 }, { seconds: 10, hr: 185 }], 190), [10, 10, 0, 0, 10]);
  assert.equal(drift([140, 140, 141, 150, 150, 152]), 11);
  assert.equal(enduranceScore({ zones: [0, 100, 0, 0, 0], driftBpm: 0, seconds: 3600 }), 100);
  assert.equal(enduranceScore({ zones: [100, 0, 0, 0, 0], driftBpm: 20, seconds: 0 }), 0);
});
