import { test } from "node:test";
import assert from "node:assert/strict";
import { SensorSimulator, MotionDetector } from "../src/sensors.js";
import { ChunkRecorder, decodeSamples } from "../src/recorder.js";
import { buildCoachPrompt } from "../src/prompts.js";

function run(activity, seconds) {
  const sim = new SensorSimulator({ seed: 3 });
  const det = new MotionDetector();
  let motion, last;
  for (let i = 0; i < seconds * 10; i++) {
    const { accel, readings } = sim.generate(0.1, activity);
    motion = det.push(accel);
    last = readings.at(-1) ?? last;
  }
  return { motion, last };
}

test("movement is measured from the accelerometer", () => {
  assert.equal(run("rest", 10).motion, "still");
  assert.equal(run("exercise", 10).motion, "moving");
});

test("temperature and humidity rise during exercise", () => {
  const rest = run("rest", 300).last;
  const ex = run("exercise", 300).last;
  assert.ok(ex.tempC > rest.tempC + 1);
  assert.ok(ex.humidity > rest.humidity + 15);
});

test("chunks carry the body sensors", () => {
  const chunks = [];
  const rec = new ChunkRecorder({ sampleRate: 250, onChunk: (c) => chunks.push(c) });
  rec.sensors({ accel: [1, 1.5], readings: [{ tempC: 33.5, humidity: 50 }] });
  for (let i = 0; i < 2500; i++) rec.push(0, { t: i / 250, label: "rest", activity: "rest" });
  assert.deepEqual(decodeSamples(chunks[0].accel), [1, 1.5]);
  assert.deepEqual(chunks[0].tempC, [33.5]);
  assert.deepEqual(chunks[0].humidity, [50]);
});

test("coach prompt includes profile and body data", () => {
  const snap = { activity: "exercise", hr: 150, regular: true, activeAlerts: [], zone: [130, 145], motion: "moving", tempC: 35.2, humidity: 71 };
  const p = buildCoachPrompt(snap, { age: 24, runner: "regular runner" });
  for (const part of ["age 24", "regular runner", "Movement: moving", "35.2 C", "71 %"]) assert.ok(p.includes(part), part);
});
