import { test } from "node:test";
import assert from "node:assert/strict";
import { personalRules, DEFAULT_RULES } from "../src/rules.js";
import { summarize } from "../src/summary.js";
import { authMessage, createThrottle } from "../src/auth-errors.js";

test("missing or silly profile values keep the default thresholds", () => {
  assert.deepEqual(personalRules(), DEFAULT_RULES);
  assert.deepEqual(personalRules({ age: -3, restingHr: 900 }), DEFAULT_RULES);
});

test("age and resting heart rate personalise thresholds", () => {
  const young = personalRules({ age: 20, restingHr: 50 });
  const older = personalRules({ age: 65, restingHr: 50 });
  assert.ok(young.zoneMax > older.zoneMax);
  assert.equal(young.brady, 35);
  assert.equal(young.tachyRest, 100);
  assert.ok(young.zoneMin < young.zoneMax);
});

test("cloud summaries contain no raw signal", () => {
  const s = summarize({
    sampleCount: 2500, sampleRate: 250, label: "rest", activity: "rest", motion: "still",
    beats: [0, 1, 2, 3], tempC: [33, 34], humidity: [40, 50], alerts: ["brady"],
    samples: new Uint8Array(5000), accel: new Uint8Array(500),
  });
  assert.equal(s.avgHr, 60);
  assert.equal(s.avgTempC, 33.5);
  assert.ok(!("samples" in s) && !("accel" in s));
});

test("login errors never reveal whether an account exists", () => {
  const messages = ["auth/user-not-found", "auth/wrong-password", "auth/invalid-credential"].map((code) => authMessage({ code }));
  assert.equal(new Set(messages).size, 1);
  assert.doesNotMatch(authMessage({ code: "auth/email-already-in-use" }), /already (in use|registered|exists)/i);
});

test("repeated failures lock the form for longer each time", () => {
  let now = 0;
  const t = createThrottle({ now: () => now });
  t.fail(); t.fail();
  assert.equal(t.wait(), 0);
  t.fail();
  assert.equal(t.wait(), 15);
  now = 15000;
  t.fail();
  assert.equal(t.wait(), 30);
  t.succeed();
  assert.equal(t.wait(), 0);
});
