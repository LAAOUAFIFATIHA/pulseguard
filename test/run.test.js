import { test } from "node:test";
import assert from "node:assert/strict";
import { formatPace, formatKm, runTotals } from "../src/run.js";
import { SensorSimulator } from "../src/sensors.js";
import { ChunkRecorder } from "../src/recorder.js";
import { summarize } from "../src/summary.js";

test("pace and distance formatting", () => {
  assert.equal(formatPace(10), "6:00 /km");
  assert.equal(formatPace(9.5), "6:19 /km");
  assert.equal(formatPace(0), "--");
  assert.equal(formatKm(840), "0.84 km");
  assert.equal(formatKm(12345), "12.3 km");
});

test("jogging covers about 9.5 km/h; resting covers nothing", () => {
  const run = new SensorSimulator({ seed: 2 });
  const rest = new SensorSimulator({ seed: 2 });
  let ran = 0;
  let rested = 0;
  for (let s = 0; s < 600; s++) {
    ran += run.generate(1, "exercise", { speedKmh: 9.5 }).readings[0].speedKmh / 3.6;
    rested += rest.generate(1, "rest").readings[0].speedKmh / 3.6;
  }
  assert.ok(Math.abs(ran - 1583) < 60, `10 min at 9.5 km/h ≈ 1583 m, got ${ran}`);
  assert.equal(rested, 0);
});

test("each 10 s summary carries its distance", () => {
  const chunks = [];
  const rec = new ChunkRecorder({ sampleRate: 250, onChunk: (c) => chunks.push(c) });
  rec.sensors({ accel: [], readings: Array.from({ length: 10 }, () => ({ tempC: 35, humidity: 60, speedKmh: 9 })) });
  for (let i = 0; i < 2500; i++) rec.push(0, { t: i / 250, label: "exercise", activity: "exercise" });
  assert.equal(summarize({ ...chunks[0], beats: [] }).distanceM, 25);
});

test("session totals: distance, duration and moving pace", () => {
  const t = runTotals([
    { seconds: 10, distanceM: 26 },
    { seconds: 10, distanceM: 0 },
    { seconds: 10, distanceM: 27 },
  ]);
  assert.deepEqual({ seconds: t.seconds, distanceM: t.distanceM }, { seconds: 30, distanceM: 53 });
  assert.ok(Math.abs(t.avgSpeedKmh - 9.54) < 0.01);
});
