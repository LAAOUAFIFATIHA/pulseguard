import { test } from "node:test";
import assert from "node:assert/strict";
import {
  progress, winner, outcome, difficulty, gapFactor, isExpired, canCreateRated, tooHard, runsInWindow, describe,
} from "../src/challenges.js";

const H = 3600000;
const t0 = Date.UTC(2026, 10, 20, 8);
const base = { users: ["a", "b"], acceptedAt: t0, deadline: t0 + 72 * H, rated: true, status: "accepted", createdAt: t0 - H };
const run = (id, hours, km, minutes, extra = {}) => ({ id, startAt: new Date(t0 + hours * H), distanceM: km * 1000, seconds: minutes * 60, urgent: false, ...extra });

test("only runs between acceptance and the deadline count", () => {
  const runs = [run("before", -1, 10, 50), run("in", 2, 5, 30), run("after", 80, 10, 50)];
  assert.deepEqual(runsInWindow(base, runs).map((r) => r.id), ["in"]);
});

test("distance: earliest finisher; timed: fastest under the limit", () => {
  const c = { ...base, type: "distance", target: { km: 5 } };
  const pa = progress(c, [run("a1", 10, 5.2, 31)]);
  const pb = progress(c, [run("b1", 3, 5.0, 35)]);
  assert.equal(pa.finished && pb.finished, true);
  assert.equal(winner(c, { a: pa, b: pb }), "b");
  const timed = { ...base, type: "timed", target: { km: 5, minutes: 30 } };
  const ta = progress(timed, [run("a", 1, 5, 29)]);
  const tb = progress(timed, [run("b", 1, 5, 31)]);
  assert.equal(tb.finished, false);
  assert.equal(winner(timed, { a: ta, b: tb }), "a");
  assert.ok(progress(timed, [run("x", 1, 2.5, 20)]).share === 0.5);
  assert.equal(describe(timed), "Run 5 km under 30 min");
});

test("weekly distance, active days and endurance: highest wins; urgent runs do not count", () => {
  const w = { ...base, type: "weekDistance" };
  const pa = progress(w, [run("1", 1, 5, 30), run("2", 30, 6, 36)]);
  const pb = progress(w, [run("3", 1, 12, 70, { urgent: true }), run("4", 5, 4, 25)]);
  assert.equal(pa.value, 11);
  assert.equal(pb.value, 4);
  assert.equal(winner(w, { a: pa, b: pb }), "a");
  const d = { ...base, type: "activeDays" };
  assert.equal(progress(d, [run("1", 1, 3, 20), run("2", 2, 3, 20), run("3", 26, 3, 20)]).value, 2);
  const e = { ...base, type: "endurance" };
  assert.equal(progress(e, [run("1", 1, 3, 20, { endurance: 71 }), run("2", 5, 3, 20, { endurance: 64 })]).value, 71);
});

test("the 4 outcomes: both finish, only one, nobody, a tie (never negative)", () => {
  const c = { ...base, type: "distance", target: { km: 5 } };
  const fin = (v) => ({ finished: true, value: v });
  const no = { finished: false, value: null };
  const ratings = { a: 800, b: 820 };
  const d = difficulty(c); // 1.1
  // 1. both finish, a first
  let o = outcome(c, { a: fin(1), b: fin(2) }, ratings);
  assert.equal(o.winner, "a");
  assert.equal(o.results.a.delta, Math.round(15 * d));
  assert.equal(o.results.b.delta, Math.round(10 * d));
  // 2. only b finishes
  o = outcome(c, { a: no, b: fin(5) }, ratings);
  assert.equal(o.winner, "b");
  assert.equal(o.results.a.delta, 0);
  assert.equal(o.results.b.delta, Math.round(15 * d));
  // 3. nobody finishes
  o = outcome(c, { a: no, b: no }, ratings);
  assert.equal(o.winner, null);
  assert.deepEqual([o.results.a.delta, o.results.b.delta], [0, 0]);
  // 4. tie: both get the finisher points only
  o = outcome(c, { a: fin(3), b: fin(3) }, ratings);
  assert.equal(o.winner, "tie");
  assert.equal(o.results.a.delta, o.results.b.delta);
  for (const r of Object.values(o.results)) assert.ok(r.delta >= 0 && r.delta <= 60);
});

test("a stronger runner beating a much weaker one earns less; friendly challenges give nothing", () => {
  assert.equal(gapFactor(200), 1);
  assert.equal(gapFactor(800), 0.5);
  assert.equal(gapFactor(5000), 0.4);
  const c = { ...base, type: "distance", target: { km: 5 } };
  const fin = (v) => ({ finished: true, value: v });
  const strong = outcome(c, { a: fin(1), b: fin(2) }, { a: 2000, b: 900 });
  const even = outcome(c, { a: fin(1), b: fin(2) }, { a: 900, b: 900 });
  assert.ok(strong.results.a.delta < even.results.a.delta);
  assert.equal(strong.results.b.delta, even.results.b.delta); // the weaker one is not penalised
  const friendly = outcome({ ...c, rated: false }, { a: fin(1), b: fin(2) });
  assert.equal(friendly.results.a.delta, 0);
  assert.equal(friendly.results.a.won, true);
});

test("difficulty stays between 1 and 1.5", () => {
  assert.equal(difficulty({ type: "activeDays" }), 1);
  assert.ok(difficulty({ type: "timed", target: { km: 42, minutes: 150 } }) <= 1.5);
  assert.ok(difficulty({ type: "timed", target: { km: 10, minutes: 45 } }) > difficulty({ type: "distance", target: { km: 10 } }));
});

test("invites expire after 48 h; anti-abuse limits; too-hard warning", () => {
  const now = t0 + 50 * H;
  assert.equal(isExpired({ status: "pending", createdAt: t0 }, now), true);
  assert.equal(isExpired({ status: "accepted", createdAt: t0 }, now), false);
  const c = (friend, h) => ({ users: ["me", friend], rated: true, status: "accepted", createdAt: now - h * H });
  assert.equal(canCreateRated([c("x", 5)], "x", "me", now).ok, false); // same friend this week
  assert.equal(canCreateRated([c("x", 5)], "y", "me", now).ok, true);
  assert.equal(canCreateRated([c("x", 5), c("y", 6), c("z", 7)], "w", "me", now).ok, false); // 3 a week
  assert.equal(canCreateRated([c("x", 200)], "x", "me", now).ok, true); // last week
  assert.match(tooHard({ target: { km: 10 } }, 5), /200 %/);
  assert.equal(tooHard({ target: { km: 6 } }, 5), null);
});
