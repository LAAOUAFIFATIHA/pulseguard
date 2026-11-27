// Runner rating (Elo-like) with game-style ranks. Pure functions, documented
// in docs/rating.md. Motivational only: not a medical or fitness assessment.

export const START = 500;
export const MAX_DELTA = 60;
export const RANKS = ["Rookie", "Pacer", "Racer", "Master", "Grand Master", "Legend"];
const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];

const clamp = (x, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);

// ── Ranks and divisions ────────────────────────────────────────────────────
/** Every 1000 points a rank, every 100 points a division (X lowest, I highest). */
export function rankOf(rating) {
  const r = Math.max(0, Math.floor(rating));
  const idx = Math.min(5, Math.floor(r / 1000));
  const name = RANKS[idx];
  if (r >= 6000) return { idx, name, division: null, label: name, toNextDivision: null, toNextRank: null, nextRank: null, rankStart: 5000 };
  const division = 10 - Math.floor((r % 1000) / 100);
  return {
    idx,
    name,
    division,
    label: `${name} ${ROMAN[division - 1]}`,
    toNextDivision: 100 - (r % 100),
    toNextRank: idx < 5 ? (idx + 1) * 1000 - r : null,
    nextRank: idx < 5 ? RANKS[idx + 1] : null,
    rankStart: idx * 1000,
  };
}

// ── Inactivity decay with a rank shield ─────────────────────────────────────
export const DECAY_PER_WEEK = 5;
/** -5 per full week after 14 days without a run; never below the start of the current rank. */
export function decayed(rating, lastRunMs, nowMs, alreadyDecayedWeeks = 0) {
  const idleDays = (nowMs - lastRunMs) / 86400000;
  const weeks = Math.max(0, Math.floor((idleDays - 14) / 7) + (idleDays >= 14 ? 1 : 0)) - alreadyDecayedWeeks;
  if (weeks <= 0) return { rating, weeks: 0 };
  const shield = rankOf(rating).rankStart;
  return { rating: Math.max(shield, rating - DECAY_PER_WEEK * weeks), weeks };
}

// ── Run performance ─────────────────────────────────────────────────────────
/** Why a run does not count, or null when it counts. */
export function ineligible(run) {
  if (run.seconds < 300) return "Shorter than 5 minutes";
  if ((run.maxSpeedKmh ?? 0) > 25) return "Impossible running speed";
  if ((run.noSignalPct ?? 0) > 0.3) return "Signal lost for more than 30% of the run";
  return null;
}

/** 0..1 from distance, pace, time in the target zone and heart-rate drift. */
export function performance(run) {
  const km = run.distanceM / 1000;
  const speed = run.seconds ? (run.distanceM / run.seconds) * 3.6 : 0;
  const zones = run.zones ?? [0, 0, 0, 0, 0];
  const total = zones.reduce((a, b) => a + b, 0) || 1;
  const inZone = (zones[1] + zones[2]) / total; // zones 2 and 3: endurance zone
  const drift = clamp((run.driftBpm ?? 0) / 20);
  return 0.35 * clamp(km / 10) + 0.25 * clamp((speed - 6) / 10) + 0.25 * inZone + 0.15 * (1 - drift);
}

export const expected = (rating) => 0.3 + 0.55 * clamp(rating / 6000);
export const kFactor = (runsRated) => (runsRated < 20 ? 40 : runsRated < 60 ? 20 : 12);

/** 1.0 to 1.5, applied to gains only. */
export function difficulty(run) {
  let f = 1;
  if ((run.airTempC ?? run.avgTempC ?? 0) >= (run.airTempC != null ? 28 : 37)) f += 0.15; // air 28 °C, or skin 37 °C
  if ((run.avgHumidity ?? 0) > 70) f += 0.1;
  if (run.startHour != null && (run.startHour < 6 || run.startHour >= 21)) f += 0.1;
  return Math.min(1.5, f);
}

/** Runs per week over the last 4 weeks -> x1.0 .. x1.2 */
export function consistency(runsLast4Weeks) {
  const perWeek = runsLast4Weeks / 4;
  return 1 + clamp(0.05 * (perWeek - 1), 0, 0.2);
}

export const GOALS = [
  [21097, "Half marathon done", 18],
  [10000, "10K done", 10],
  [5000, "5K done", 6],
];

/**
 * Rating change for a finished run. Losses do not exist: only inactivity decay
 * lowers a rating. Returns { delta, reasons[] }.
 */
export function rateRun(run, state, { runsLast4Weeks = 0 } = {}) {
  const why = ineligible(run);
  if (why) return { delta: 0, reasons: [`Not rated: ${why}`] };
  if (run.urgent) return { delta: 0, reasons: ["No gain after an urgent alert: rest is part of training"] };

  const reasons = [];
  const raw = kFactor(state.runsRated) * (performance(run) - expected(state.rating));
  let gain = Math.max(0, raw);
  if (gain > 0) reasons.push(`+${gain.toFixed(1)} performance`);
  const diff = difficulty(run);
  const streak = consistency(runsLast4Weeks);
  const goal = GOALS.find(([m]) => run.distanceM >= m);
  if (goal) {
    const bonus = goal[2] * Math.max(0.5, 1.5 - state.rating / 4000);
    gain += bonus;
    reasons.push(`+${bonus.toFixed(1)} ${goal[1]}`);
  }
  if (run.adherence != null) {
    const bonus = 4 * clamp(run.adherence);
    gain += bonus;
    reasons.push(`+${bonus.toFixed(1)} plan followed`);
  }
  gain *= diff * streak;
  if (diff > 1) reasons.push(`x${diff.toFixed(2)} tough conditions`);
  if (streak > 1) reasons.push(`x${streak.toFixed(2)} streak`);
  if (run.source !== "sensor") {
    gain *= 0.5;
    reasons.push("x0.5 simulated data");
  }
  return { delta: Math.min(MAX_DELTA, Math.round(gain)), reasons };
}

/** New state after a rating change. */
export function applyDelta(state, delta) {
  const rating = Math.max(0, state.rating + delta);
  return { ...state, rating, peak: Math.max(state.peak ?? rating, rating), rank: rankOf(rating).name };
}

// ── Heart-rate zones and endurance score ────────────────────────────────────
/** Seconds in zones 1-5 from a trend of {seconds, hr} blocks and the max heart rate. */
export function zoneSeconds(blocks, maxHr) {
  const z = [0, 0, 0, 0, 0];
  for (const { seconds, hr } of blocks) {
    if (hr == null) continue;
    const p = hr / maxHr;
    const i = p < 0.6 ? 0 : p < 0.7 ? 1 : p < 0.8 ? 2 : p < 0.9 ? 3 : 4;
    z[i] += seconds;
  }
  return z.map(Math.round);
}

/** Average of the last third minus average of the first third. */
export function drift(hrs) {
  const v = hrs.filter((x) => x != null);
  if (v.length < 6) return 0;
  const third = Math.floor(v.length / 3);
  return mean(v.slice(-third)) - mean(v.slice(0, third));
}

/** 0-100: 50% time in zones 2-3, 30% low drift, 20% duration (60 min = full). Motivational, not medical. */
export function enduranceScore({ zones, driftBpm, seconds }) {
  const total = zones.reduce((a, b) => a + b, 0) || 1;
  const inZone = (zones[1] + zones[2]) / total;
  return Math.round(100 * (0.5 * inZone + 0.3 * (1 - clamp(driftBpm / 20)) + 0.2 * clamp(seconds / 3600)));
}
