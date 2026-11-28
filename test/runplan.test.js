import { test } from "node:test";
import assert from "node:assert/strict";
import { rulesPlan, validatePlan, planSeconds, createLive, zoneBounds, zoneOf, waterEvery, CUES } from "../src/runplan.js";

const mild = { tempC: 18, humidity: 50 };
const hot = { tempC: 31, humidity: 60 };
const base = { minutes: 40, level: "casual", age: 25, restingHr: 60, weather: mild, startHour: 8, walkBreaks: true };

test("rules plan: warm-up, cool-down, water, valid", () => {
  for (const level of ["starting", "casual", "regular", "competitive"]) {
    for (const minutes of [20, 40, 75, 120]) {
      for (const weather of [mild, hot]) {
        const p = rulesPlan({ ...base, level, minutes, weather });
        const v = validatePlan(p, weather);
        assert.ok(v.ok, `${level} ${minutes} ${weather.tempC}: ${v.errors.join(" ")}`);
        assert.equal(p.segments[0].type, "warmup");
        assert.equal(p.segments.at(-1).type, "cooldown");
        assert.ok(p.notes.includes("General guidance, not medical advice."));
      }
    }
  }
});

test("heat: shorter, lower zone, water every 12 min; long runs get a rest stop", () => {
  const cool = rulesPlan(base);
  const warm = rulesPlan({ ...base, weather: hot });
  assert.ok(planSeconds(warm) < planSeconds(cool));
  assert.ok(Math.max(...warm.segments.map((s) => s.targetZone)) <= Math.max(...cool.segments.map((s) => s.targetZone)));
  assert.equal(waterEvery(hot), 12);
  assert.equal(waterEvery({ tempC: 20, humidity: 80 }), 12);
  assert.equal(waterEvery(mild), 20);
  assert.ok(rulesPlan({ ...base, minutes: 90 }).segments.some((s) => s.type === "rest"));
  assert.ok(!rulesPlan({ ...base, minutes: 40 }).segments.some((s) => s.type === "rest"));
});

test("validator rejects unsafe AI plans", () => {
  const ok = rulesPlan(base);
  assert.equal(validatePlan({ segments: [] }).ok, false);
  const noWarm = { segments: ok.segments.slice(1) };
  assert.match(validatePlan(noWarm, mild).errors.join(), /warm-up/);
  const noWater = { segments: [ok.segments[0], { type: "run", startMinute: 5, durationSec: 1800, targetZone: 2 }, { type: "cooldown", startMinute: 35, durationSec: 300, targetZone: 1 }] };
  assert.match(validatePlan(noWater, mild).errors.join(), /Water/);
  const zone9 = structuredClone(ok);
  zone9.segments[1].targetZone = 9;
  assert.match(validatePlan(zone9, mild).errors.join(), /zone/);
  const z4hot = structuredClone(rulesPlan({ ...base, weather: hot }));
  z4hot.segments.find((s) => s.type === "run").targetZone = 4;
  assert.match(validatePlan(z4hot, hot).errors.join(), /heat/);
});

test("zones", () => {
  assert.deepEqual(zoneBounds(190, 2), { low: 114, high: 133 });
  assert.equal(zoneOf(120, 190), 2);
  assert.equal(zoneOf(185, 190), 5);
});

// fake clock: tSec and nowMs are driven by the test
test("live: segments, countdown, cues once, anti-repeat 30 s", () => {
  const plan = rulesPlan(base);
  const live = createLive(plan, { maxHr: 195, lang: "fr" });
  let now = 0;
  const at = (tSec, extra = {}) => live.tick({ tSec, nowMs: (now = tSec * 1000), hr: 110, ...extra });
  const a = at(0);
  assert.equal(a.segment.type, "warmup");
  assert.deepEqual(a.cues, [CUES.fr.warmup]);
  assert.equal(a.remaining, plan.segments[0].durationSec);
  assert.deepEqual(at(10).cues, []);
  const b = at(plan.segments[0].durationSec);
  assert.equal(b.segment.type, plan.segments[1].type);
  assert.equal(b.cues.length, 1);
  const end = at(planSeconds(plan) + 1);
  assert.equal(end.done, true);
  assert.deepEqual(end.cues, [CUES.fr.done]);
});

test("live: heart rate above the zone for 20 s → slow down and +30 s on the next break", () => {
  const plan = rulesPlan(base);
  const live = createLive(plan, { maxHr: 195, lang: "en" });
  const runStart = plan.segments.slice(0, 1).reduce((s, x) => s + x.durationSec, 0);
  const nextBreak = plan.segments.findIndex((s, i) => i > 1 && ["walk", "water", "rest"].includes(s.type));
  const before = plan.segments[nextBreak].durationSec;
  let cues = [];
  for (let t = runStart; t <= runStart + 25; t++) cues.push(...live.tick({ tSec: t, nowMs: t * 1000, hr: 185 }).cues);
  assert.ok(cues.includes(CUES.en.slow));
  assert.equal(cues.filter((c) => c === CUES.en.slow).length, 1); // anti-repeat
  assert.equal(live.segments()[nextBreak].durationSec, before + 30);
  assert.ok(live.adherence() < 0.5);
});

test("live: skin temperature near the limit → find shade and an extra stop", () => {
  const plan = rulesPlan(base);
  const live = createLive(plan, { maxHr: 195, lang: "ar" });
  const t = plan.segments[0].durationSec + 30;
  const r = live.tick({ tSec: t, nowMs: t * 1000, hr: 120, tempC: 38.4 });
  assert.ok(r.cues.includes(CUES.ar.shade));
  assert.equal(live.segments()[r.index + 1].type, "water");
  assert.equal(live.segments()[r.index + 1].extra, true);
  const again = live.tick({ tSec: t + 1, nowMs: (t + 1) * 1000, hr: 120, tempC: 38.6 });
  assert.ok(!again.cues.includes(CUES.ar.shade));
});
