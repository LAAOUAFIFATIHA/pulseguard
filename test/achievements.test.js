import { test } from "node:test";
import assert from "node:assert/strict";
import { BADGES, stats, evaluate, newlyEarned, records, longestStreak, mostRunsInAWeek, fastest } from "../src/achievements.js";

const day = (d, hour = 8) => new Date(2026, 10, d, hour).getTime();
const run = (d, extra = {}) => ({
  startMs: day(d, extra.hour ?? 8), startHour: extra.hour ?? 8, distanceM: 5000, seconds: 1800, urgent: false,
  zones: [0, 600, 900, 300, 0], endurance: 60, ...extra,
});
const earned = (runs, social) => new Set(evaluate(stats(runs, social)).filter((b) => b.earned).map((b) => b.id));

test("streaks, weeks and fastest times", () => {
  assert.equal(longestStreak([run(1), run(2), run(3), run(5), run(6)]), 3);
  assert.equal(longestStreak([run(1), run(1, { hour: 18 })]), 1);
  assert.equal(mostRunsInAWeek([run(2), run(3), run(4), run(10)]), 3); // Nov 2-4 2026 is one week
  assert.equal(fastest([run(1, { distanceM: 10000, seconds: 3000 })], 5), 1500);
  assert.equal(fastest([run(1, { distanceM: 4000 })], 5), null);
});

test("each badge condition", () => {
  assert.ok(earned([run(1)]).has("first_run"));
  assert.ok(!earned([]).has("first_run"));
  const week = Array.from({ length: 7 }, (_, i) => run(i + 1));
  assert.ok(earned(week).has("streak7"));
  assert.ok(!earned(week.slice(0, 6)).has("streak7"));
  assert.ok(earned(Array.from({ length: 30 }, (_, i) => run(i + 1))).has("streak30"));
  assert.ok(earned(Array.from({ length: 10 }, (_, i) => run(i + 1))).has("runs10"));
  assert.ok(!earned(Array.from({ length: 49 }, (_, i) => run((i % 28) + 1))).has("runs50"));
  assert.ok(earned(Array.from({ length: 50 }, (_, i) => run((i % 28) + 1))).has("runs50"));
  assert.ok(earned(Array.from({ length: 20 }, (_, i) => run(i + 1))).has("km100")); // 20 x 5 km
  assert.ok(earned([run(1, { hour: 6 })]).has("early_bird"));
  assert.ok(earned([run(1, { hour: 21 })]).has("night_owl"));
  assert.ok(!earned([run(1, { hour: 12 })]).has("night_owl"));
  assert.ok(earned([run(1, { airTempC: 31 })]).has("heat_warrior"));
  assert.ok(!earned([run(1, { airTempC: 31, urgent: true })]).has("heat_warrior")); // never after an urgent alert
  assert.ok(earned([run(1, { zones: [0, 1300, 300, 200, 0] })]).has("zone_master"));
  assert.ok(!earned([run(1, { zones: [0, 1300, 300, 200, 0], seconds: 900 })]).has("zone_master"));
  assert.ok(earned([run(1, { endurance: 82 })]).has("iron_heart"));
  assert.ok(earned([run(1)], { challengesWon: 1 }).has("challenger"));
  assert.ok(earned([run(1)], { friends: 3 }).has("social_runner"));
  assert.ok(earned([run(1, { planId: "p1" })]).has("coach_student"));
});

test("progress bars, rarities, unlock dates kept, newly earned only once", () => {
  const s = stats([run(1), run(2), run(3)]);
  const list = evaluate(s, { streak30: 123 });
  assert.equal(list.length, BADGES.length);
  assert.equal(list.find((b) => b.id === "runs10").progressValue, 0.3);
  assert.equal(list.find((b) => b.id === "streak30").earned, true); // kept once earned
  for (const b of list) assert.ok(["common", "uncommon", "rare", "epic", "legendary"].includes(b.rarity));
  assert.deepEqual(newlyEarned(s, {}), ["first_run"]);
  assert.deepEqual(newlyEarned(s, { first_run: 1 }), []);
});

test("records", () => {
  const r = records([run(1, { distanceM: 12000, seconds: 3900, airTempC: 30 }), run(2, { endurance: 77 }), run(3)], 910);
  assert.equal(r.longestM, 12000);
  assert.equal(r.fastest10k, 3250);
  assert.equal(r.bestEndurance, 77);
  assert.equal(r.longestStreak, 3);
  assert.equal(r.hottestC, 30);
  assert.equal(r.ratingPeak, 910);
});
