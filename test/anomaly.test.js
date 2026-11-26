// End-to-end check of the rules: simulator -> beat detector -> rhythm monitor.
import { test } from "node:test";
import assert from "node:assert/strict";
import { EcgSimulator, SCENARIOS } from "../src/ecg.js";
import { BeatDetector, RhythmMonitor } from "../src/anomaly.js";
import { buildCoachPrompt, buildReportPrompt } from "../src/prompts.js";

const FS = 250;

function run(scenario, seconds = 60, seed = 42) {
  const sim = new EcgSimulator({ sampleRate: FS, scenario, seed });
  const det = new BeatDetector({ sampleRate: FS });
  const mon = new RhythmMonitor();
  let snap;
  for (let s = 0; s < seconds * 2; s++) {
    for (const v of sim.generate(0.5)) {
      const beat = det.push(v);
      if (beat !== null) mon.addBeat(beat);
    }
    snap = mon.update(sim.t, sim.scenario.activity);
  }
  return { snap, sum: mon.summary(), types: new Set(mon.events.map((e) => e.type)) };
}

const expected = {
  rest: { hr: [60, 76], alerts: [] },
  exercise: { hr: [140, 160], alerts: ["aboveZone"] },
  tachy: { hr: [125, 145], alerts: ["tachyRest"] },
  brady: { hr: [36, 48], alerts: ["brady"] },
  irregular: { hr: null, alerts: ["irregular"] },
  electrodeOff: { hr: null, alerts: ["noSignal"] },
};

for (const key of Object.keys(SCENARIOS)) {
  test(`scenario ${key}`, () => {
    for (const seed of [1, 2, 3]) {
      const { snap, types } = run(key, 60, seed);
      const exp = expected[key];
      assert.deepEqual([...types].sort(), [...exp.alerts].sort(), `alerts for seed ${seed}`);
      if (exp.hr) {
        assert.ok(snap.hr >= exp.hr[0] && snap.hr <= exp.hr[1], `hr ${snap.hr} for seed ${seed}`);
      }
    }
  });
}

test("alert closes when the condition ends", () => {
  const sim = new EcgSimulator({ sampleRate: FS, scenario: "tachy", seed: 7 });
  const det = new BeatDetector({ sampleRate: FS });
  const mon = new RhythmMonitor();
  const step = (secs) => {
    for (let s = 0; s < secs * 2; s++) {
      for (const v of sim.generate(0.5)) {
        const b = det.push(v);
        if (b !== null) mon.addBeat(b);
      }
      mon.update(sim.t, sim.scenario.activity);
    }
  };
  step(40);
  sim.setScenario("rest");
  step(60);
  const ev = mon.events.find((e) => e.type === "tachyRest");
  assert.ok(ev && ev.end !== null, "tachy event should be closed");
  assert.equal(mon.snapshot().activeAlerts.length, 0);
});

test("prompts include the measured data", () => {
  const { snap, sum } = run("tachy", 40);
  const coach = buildCoachPrompt(snap);
  assert.match(coach, /Fast heart rate at rest/);
  assert.match(coach, /\d+ bpm/);
  const report = buildReportPrompt(sum);
  assert.match(report, /Alerts \(time from session start\)/);
  assert.match(report, /Fast heart rate at rest/);
  assert.ok(coach.length < 1200, "coach prompt stays short for Gemini Nano");
});
