import { test } from "node:test";
import assert from "node:assert/strict";
import { ruleLevel, parseVerdict, worst, createScheduler, isUrgent } from "../src/healthcheck.js";
import { distanceMeters, formatDistance, mapLink } from "../src/location.js";
import { freshAlerts } from "../src/alerts-logic.js";
import { EcgSimulator } from "../src/ecg.js";
import { SensorSimulator } from "../src/sensors.js";
import { BeatDetector, RhythmMonitor } from "../src/anomaly.js";
import { personalRules } from "../src/rules.js";

const snap = (types = [], hr = 70) => ({ hr, activeAlerts: types.map((type) => ({ type })) });

/** Full pipeline: simulated heart and body sensors -> rules. */
function run(scenario, seconds, rules) {
  const ecg = new EcgSimulator({ scenario, seed: 4 });
  const body = new SensorSimulator({ seed: 4 });
  const det = new BeatDetector();
  const mon = new RhythmMonitor(rules);
  let tempC = null;
  let result;
  for (let s = 0; s < seconds; s++) {
    for (const v of ecg.generate(1)) {
      const beat = det.push(v);
      if (beat !== null) mon.addBeat(beat);
    }
    const { readings } = body.generate(1, ecg.scenario.activity, ecg.scenario);
    tempC = readings.at(-1)?.tempC ?? tempC;
    result = mon.update(ecg.t, ecg.scenario.activity, { tempC });
  }
  return { types: new Set(mon.events.map((e) => e.type)), snap: result };
}

test("overheating during a run raises an urgent alert", () => {
  const { types, snap: s } = run("overheat", 60);
  assert.ok(types.has("highTemp"));
  assert.equal(ruleLevel(s), "danger");
});

test("normal jogging is not urgent", () => {
  const { types } = run("exercise", 90);
  assert.ok(!types.has("highTemp") && !types.has("dangerHr"));
});

test("a heart rate above the personal maximum is dangerous", () => {
  const rules = personalRules({ age: 100 }); // maximum about 134 bpm
  assert.ok(run("exercise", 40, rules).types.has("dangerHr"));
});

test("urgency: minor alerts only warn", () => {
  assert.equal(ruleLevel(snap()), "ok");
  assert.equal(ruleLevel(snap(["aboveZone"])), "watch");
  assert.equal(ruleLevel(snap(["noSignal"])), "watch");
  assert.equal(ruleLevel(snap(["aboveZone", "highTemp"])), "danger");
  assert.ok(!isUrgent([{ type: "aboveZone" }]));
});

test("the AI can raise the verdict but not lower it", () => {
  assert.deepEqual(parseVerdict("**DANGER**: Stop now."), { level: "danger", message: "Stop now." });
  assert.equal(parseVerdict("ok - all fine").level, "ok");
  assert.equal(parseVerdict("I think you are fine").level, null);
  assert.equal(worst("danger", "ok"), "danger");
  assert.equal(worst("ok", "watch"), "watch");
});

test("the check starts by itself, on new alerts, then every 3 minutes", () => {
  const s = createScheduler();
  assert.equal(s.due({ hr: null, activeAlerts: [] }, true, 0), false);
  assert.equal(s.due(snap(), true, 1), false);
  assert.equal(s.due(snap(), true, 16), true);
  assert.equal(s.due(snap(), true, 60), false);
  assert.equal(s.due(snap(["highTemp"]), true, 61), true);
  assert.equal(s.due(snap(["highTemp"]), true, 120), false);
  assert.equal(s.due(snap(["highTemp"]), true, 241), true);
  assert.equal(s.due(snap(), false, 500), false);
});

test("teammates are warned once per urgent episode, never about themselves", () => {
  const member = (uid, urgent) => ({ uid, urgent, state: urgent ? "alert" : "normal" });
  const seen = new Set();
  let r = freshAlerts([member("me", true), member("bob", true), member("amy", false)], seen, "me", 0);
  assert.deepEqual(r.fresh.map((m) => m.uid), ["bob"]);
  r = freshAlerts([member("bob", true)], seen, "me", 0);
  assert.equal(r.fresh.length, 0);
  r = freshAlerts([member("bob", false)], seen, "me", 0);
  assert.deepEqual(r.cleared, ["bob"]);
  assert.equal(freshAlerts([member("bob", true)], seen, "me", 0).fresh.length, 1);
  const old = { ...member("zed", true), updatedAt: { toMillis: () => 0 } };
  assert.equal(freshAlerts([old], new Set(), "me", 10 * 60_000).urgent.length, 0);
});

test("distance and map link", () => {
  const a = { lat: 34.0, lng: -6.84 };
  const b = { lat: 34.009, lng: -6.84 };
  assert.ok(Math.abs(distanceMeters(a, b) - 1000) < 5);
  assert.equal(formatDistance(342), "340 m");
  assert.equal(formatDistance(1530), "1.5 km");
  assert.match(mapLink(a), /^https:\/\/www\.openstreetmap\.org\/\?mlat=34\.00000&mlon=-6\.84000/);
});
