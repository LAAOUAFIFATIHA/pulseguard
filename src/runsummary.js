// Builds the saved summary of a finished run from the live monitor data.
// Pure logic (tested). Never contains raw ECG, accelerometer or location.
import { zoneSeconds, drift, enduranceScore } from "./rating.js";
import { URGENT_ALERTS } from "./healthcheck.js";

const round = (x, d = 0) => (x == null ? null : Math.round(x * 10 ** d) / 10 ** d);

/** Tanaka estimate of maximum heart rate, 190 when the age is unknown. */
export const maxHeartRate = (age) => (Number.isFinite(age) && age > 0 ? Math.round(208 - 0.7 * age) : 190);

export function buildRun(data, { maxHr = 190, planId = null, adherence = null, airTempC = null, source = "simulated" } = {}) {
  const seconds = Math.max(1, data.seconds);
  const hrs = data.hrLog.map((h) => h.hr).filter((x) => x != null);
  const blocks = data.hrLog.map((h) => ({ seconds: 0.5, hr: h.hr }));
  const zones = zoneSeconds(blocks, maxHr);
  const driftBpm = round(drift(hrs), 1);
  const noSignal = data.events
    .filter((e) => e.type === "noSignal")
    .reduce((s, e) => s + ((e.end ?? seconds) - e.start), 0);
  const run = {
    startAt: new Date(data.startedAt ?? Date.now()),
    seconds: Math.round(seconds),
    distanceM: Math.round(data.distanceM),
    avgHr: hrs.length ? Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length) : null,
    maxHr: hrs.length ? Math.round(Math.max(...hrs)) : null,
    alerts: data.events.length,
    urgent: data.events.some((e) => URGENT_ALERTS.includes(e.type)),
    noSignalPct: round(Math.min(1, noSignal / seconds), 3),
    maxSpeedKmh: round(data.maxSpeedKmh, 1),
    avgTempC: round(data.avgTempC, 1),
    avgHumidity: round(data.avgHumidity),
    zones,
    driftBpm,
    endurance: enduranceScore({ zones, driftBpm: driftBpm ?? 0, seconds }),
    source,
    startHour: new Date(data.startedAt ?? Date.now()).getHours(),
  };
  if (planId) run.planId = planId;
  if (adherence != null) run.adherence = round(adherence, 2);
  if (airTempC != null) run.airTempC = airTempC;
  return run;
}

/** Year and week number, e.g. "2026-W48" (weeks start on Monday). */
export function weekKey(date = new Date()) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}
