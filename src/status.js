// Live status derived from the monitor once per second: current state, the
// last heart rate measured while everything was normal, and a short trend.
// Pure logic, so it can be unit-tested.
import { DEFAULT_RULES } from "./rules.js";

export const TREND_EVERY_SEC = 15;
export const TREND_POINTS = 30;

/** Inside the personal limits: not slow, not fast at rest, not above the zone while exercising. */
export function isNormalHr(hr, activity, rules = DEFAULT_RULES) {
  if (hr == null || hr < rules.brady) return false;
  return activity === "exercise" ? hr <= rules.zoneMax : hr <= rules.tachyRest;
}

export function createStatus() {
  const s = { state: "idle", hr: null, alert: null, lastNormalHr: null, lastNormalAt: null, trend: [] };
  let lastTrend = -Infinity;

  /** `snap` is the monitor snapshot; `now` is a time in ms. */
  s.update = (snap, running, now = Date.now(), rules = DEFAULT_RULES) => {
    if (!running || snap.hr == null) {
      s.state = "idle";
      s.hr = null;
      s.alert = null;
      return s;
    }
    s.hr = Math.round(snap.hr);
    const alert = snap.activeAlerts[0];
    s.state = alert ? "alert" : "normal";
    s.alert = alert?.label ?? null;
    if (!alert && isNormalHr(snap.hr, snap.activity, rules)) {
      s.lastNormalHr = s.hr;
      s.lastNormalAt = now;
    }
    if (now - lastTrend >= TREND_EVERY_SEC * 1000) {
      lastTrend = now;
      s.trend = [...s.trend, s.hr].slice(-TREND_POINTS);
    }
    return s;
  };
  return s;
}

/** Newest window with no alert and a heart rate inside the limits. `windows` newest first. */
export function lastNormalWindow(windows, rules = DEFAULT_RULES) {
  return windows.find((w) => !w.alerts?.length && isNormalHr(w.avgHr, w.activity, rules)) ?? null;
}

const UNITS = [
  [86400, "day"],
  [3600, "hour"],
  [60, "minute"],
];

/** "just now", "5 minutes ago", "2 days ago". */
export function timeAgo(ms, now = Date.now()) {
  const sec = Math.max(0, Math.round((now - ms) / 1000));
  if (sec < 45) return "just now";
  for (const [size, name] of UNITS) {
    if (sec >= size) {
      const n = Math.round(sec / size);
      return `${n} ${name}${n > 1 ? "s" : ""} ago`;
    }
  }
  return "1 minute ago";
}

export const initials = (name = "") =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("") || "?";
