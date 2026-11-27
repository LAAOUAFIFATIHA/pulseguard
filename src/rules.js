// Anomaly thresholds, optionally personalised from age and resting heart rate.
// PulseGuard is a demo, not a medical device: these are simple heuristics.

export const DEFAULT_RULES = {
  tachyRest: 120, // bpm, at rest
  brady: 50, // bpm
  zoneMin: 130, // exercise target zone
  zoneMax: 145,
  maxHr: 185, // during exercise: above this is dangerous
  highTempC: 37.5, // skin temperature
  irregularCv: 0.15, // coefficient of variation of R-R intervals
  sustainSec: 8, // a condition must last this long to raise an alert
  noSignalSec: 3, // no beat for this long = signal lost
};

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const valid = (x, lo, hi) => Number.isFinite(x) && x >= lo && x <= hi;

/** Missing or out-of-range values keep the defaults. */
export function personalRules({ age, restingHr } = {}) {
  const rules = { ...DEFAULT_RULES };
  const hasRest = valid(restingHr, 30, 120);
  if (hasRest) {
    rules.tachyRest = clamp(restingHr + 50, 100, 130);
    rules.brady = clamp(restingHr - 15, 35, 50);
  }
  if (valid(age, 13, 100)) {
    const max = 208 - 0.7 * age; // Tanaka estimate of maximum heart rate
    const rest = hasRest ? restingHr : 70;
    rules.maxHr = Math.round(0.97 * max);
    // 60-70 % of heart-rate reserve (Karvonen)
    rules.zoneMin = Math.round(rest + 0.6 * (max - rest));
    rules.zoneMax = Math.round(rest + 0.7 * (max - rest));
  }
  return rules;
}
