import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRun, maxHeartRate, weekKey } from "../src/runsummary.js";

const data = (extra = {}) => ({
  startedAt: new Date(2026, 10, 27, 7, 30).getTime(),
  seconds: 600,
  distanceM: 1580.4,
  maxSpeedKmh: 10.44,
  avgTempC: 34.26,
  avgHumidity: 61.3,
  hrLog: Array.from({ length: 1200 }, (_, i) => ({ hr: 120 + (i / 1200) * 20 })),
  events: [],
  ...extra,
});

test("a finished run becomes a summary with zones, drift and endurance", () => {
  const r = buildRun(data(), { maxHr: 190 });
  assert.equal(r.seconds, 600);
  assert.equal(r.distanceM, 1580);
  assert.equal(r.startHour, 7);
  assert.equal(r.zones.reduce((a, b) => a + b, 0), 600);
  assert.ok(r.driftBpm > 10);
  assert.ok(r.endurance >= 0 && r.endurance <= 100);
  assert.equal(r.urgent, false);
  assert.equal(r.source, "simulated");
  assert.ok(!("samples" in r) && !("location" in r));
});

test("urgent alerts and lost signal are recorded", () => {
  const r = buildRun(data({ events: [{ type: "tachyRest", start: 10, end: 50 }, { type: "noSignal", start: 100, end: null }] }));
  assert.equal(r.urgent, true);
  assert.equal(r.alerts, 2);
  assert.equal(r.noSignalPct, 0.833);
});

test("plan fields are added only when given", () => {
  assert.ok(!("planId" in buildRun(data())));
  const r = buildRun(data(), { planId: "p1", adherence: 0.876, airTempC: 31 });
  assert.deepEqual([r.planId, r.adherence, r.airTempC], ["p1", 0.88, 31]);
});

test("max heart rate and week keys", () => {
  assert.equal(maxHeartRate(20), 194);
  assert.equal(maxHeartRate(undefined), 190);
  assert.equal(weekKey(new Date(2026, 10, 27)), "2026-W48");
  assert.equal(weekKey(new Date(2027, 0, 1)), "2026-W53");
});
