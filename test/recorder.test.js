import { test } from "node:test";
import assert from "node:assert/strict";
import { ChunkRecorder, encodeSamples, decodeSamples } from "../src/recorder.js";

test("samples survive encoding to int16", () => {
  const input = [0, 1, -0.25, 1.234, 0.0004];
  const out = decodeSamples(encodeSamples(input));
  input.forEach((v, i) => assert.ok(Math.abs(out[i] - v) <= 0.0005, `${out[i]} vs ${v}`));
});

test("chunks are 10 s long and never mix labels", () => {
  const chunks = [];
  const rec = new ChunkRecorder({ sampleRate: 250, onChunk: (c) => chunks.push(c) });
  const feed = (secs, label, from) => {
    for (let i = 0; i < secs * 250; i++) rec.push(0.1, { t: from + i / 250, label, activity: "rest" });
  };
  feed(14, "rest", 0);
  rec.addBeat(11);
  feed(3, "tachy", 14);
  rec.flush();
  assert.deepEqual(chunks.map((c) => [c.label, c.sampleCount, c.index]), [
    ["rest", 2500, 0],
    ["rest", 1000, 1],
    ["tachy", 750, 2],
  ]);
  assert.deepEqual(chunks[1].beats, [1]);
  assert.equal(chunks[0].samples.byteLength, 5000);
});

test("fragments under 1 s are dropped", () => {
  const chunks = [];
  const rec = new ChunkRecorder({ sampleRate: 250, onChunk: (c) => chunks.push(c) });
  for (let i = 0; i < 100; i++) rec.push(0, { t: i / 250, label: "rest", activity: "rest" });
  rec.flush();
  assert.equal(chunks.length, 0);
});
