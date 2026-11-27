import { test } from "node:test";
import assert from "node:assert/strict";
import { createStatus, lastNormalWindow, timeAgo, initials } from "../src/status.js";
import { groupSessions, formatDuration, sparkline } from "../src/sessions.js";

const snap = (hr, alert, activity = "rest") => ({ hr, activity, activeAlerts: alert ? [{ label: alert }] : [] });

test("status keeps the last normal heart rate through an alert", () => {
  const s = createStatus();
  s.update(snap(70), true, 1000);
  s.update(snap(135, "Fast heart rate at rest"), true, 20000);
  assert.equal(s.state, "alert");
  assert.equal(s.hr, 135);
  assert.equal(s.lastNormalHr, 70);
  assert.equal(s.lastNormalAt, 1000);
  s.update(snap(132), true, 25000); // rising, alert not confirmed yet: not "normal"
  assert.equal(s.lastNormalHr, 70);
  s.update(snap(150, null, "exercise"), true, 26000); // above the default exercise zone (145)
  assert.equal(s.lastNormalHr, 70);
  s.update(snap(140, null, "exercise"), true, 27000);
  assert.equal(s.lastNormalHr, 140);
  s.update(snap(135), false, 30000);
  assert.equal(s.state, "idle");
  assert.equal(s.lastNormalHr, 140);
});

test("trend adds one point every 15 s and keeps 30", () => {
  const s = createStatus();
  for (let i = 0; i < 100; i++) s.update(snap(60 + i), true, i * 5000);
  assert.equal(s.trend.length, 30);
  assert.equal(s.trend.at(-1), 159);
});

test("last normal window skips alerts and empty heart rates", () => {
  const w = lastNormalWindow([
    { avgHr: 130, alerts: ["tachyRest"] },
    { avgHr: null, alerts: [] },
    { avgHr: 125, alerts: [], activity: "rest" },
    { avgHr: 66, alerts: [], activity: "rest" },
  ]);
  assert.equal(w.avgHr, 66);
  assert.equal(lastNormalWindow([]), null);
});

test("sessions group by id, and by time gaps for old data", () => {
  const w = (startMs, sessionId, avgHr = 70, alerts = []) => ({ startMs, seconds: 10, sessionId, avgHr, maxHr: avgHr, alerts, label: "rest" });
  const sessions = groupSessions([
    w(0, "a"), w(10_000, "a", 90, ["brady"]), w(20_000, "b"),
    w(500_000, undefined), w(510_000, undefined), w(900_000, undefined),
  ]);
  assert.equal(sessions.length, 4);
  assert.equal(sessions[0].startMs, 900_000); // newest first
  const a = sessions.find((s) => s.id === "a");
  assert.equal(a.seconds, 20);
  assert.equal(a.avgHr, 80);
  assert.equal(a.alertWindows, 1);
  assert.equal(sessions.find((s) => s.startMs === 500_000).windows.length, 2);
});

test("formatting helpers", () => {
  assert.equal(formatDuration(40), "40 s");
  assert.equal(formatDuration(720), "12 min");
  assert.equal(formatDuration(3900), "1 h 05 min");
  assert.equal(timeAgo(0, 10_000), "just now");
  assert.equal(timeAgo(0, 5 * 60_000), "5 minutes ago");
  assert.equal(timeAgo(0, 2 * 86_400_000), "2 days ago");
  assert.equal(initials("fatiha laaouafi"), "FL");
  assert.equal(initials(""), "?");
  assert.equal(sparkline([70]), "");
  assert.match(sparkline([70, 80, 75]), /^<svg class="spark"/);
});
