import { DEFAULT_RULES } from "./rules.js";
// Beat detection + threshold anomaly rules. Pure logic (no DOM) so it can be
// unit-tested with `npm test` and reused with a real sensor later.
//
// PulseGuard is a hackathon demo, not a medical device: thresholds are simple
// textbook values, not clinical criteria.

export { DEFAULT_RULES };

export const ALERTS = {
  noSignal: { label: "Signal lost: check the electrodes", severity: "warning" },
  tachyRest: { label: "Fast heart rate at rest", severity: "high" },
  brady: { label: "Slow heart rate", severity: "medium" },
  irregular: { label: "Irregular rhythm", severity: "high" },
  aboveZone: { label: "Above exercise target zone", severity: "info" },
  dangerHr: { label: "Heart rate dangerously high", severity: "high" },
  highTemp: { label: "Body temperature too high", severity: "high" },
};

/** Detects R peaks: rising edge over a threshold, then the local maximum. */
export class BeatDetector {
  constructor({ sampleRate = 250, threshold = 0.5, refractorySec = 0.25 } = {}) {
    this.dt = 1 / sampleRate;
    this.threshold = threshold;
    this.refractory = refractorySec;
    this.t = 0;
    this.lastBeat = -Infinity;
    this.inPeak = false;
    this.peakV = 0;
    this.peakT = 0;
  }

  /** Feed one sample; returns the R-peak time if a beat just completed, else null. */
  push(v) {
    const t = this.t;
    this.t += this.dt;
    if (!this.inPeak) {
      if (v > this.threshold && t - this.lastBeat > this.refractory) {
        this.inPeak = true;
        this.peakV = v;
        this.peakT = t;
      }
      return null;
    }
    if (v > this.peakV) {
      this.peakV = v;
      this.peakT = t;
      return null;
    }
    if (v < this.threshold) {
      this.inPeak = false;
      this.lastBeat = this.peakT;
      return this.peakT;
    }
    return null;
  }
}

const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;

/** Tracks heart rate, rhythm regularity and alerts over a session. */
export class RhythmMonitor {
  constructor(rules = DEFAULT_RULES) {
    this.rules = { ...DEFAULT_RULES, ...rules };
    this.beats = [];
    this.since = {}; // condition -> time it became true
    this.active = {}; // condition -> open event
    this.events = []; // all events, open and closed
    this.hrLog = []; // { t, hr } once per update
    this.t = 0;
    this.activity = "rest";
  }

  addBeat(t) {
    this.beatCount = (this.beatCount ?? 0) + 1;
    this.beats.push(t);
    if (this.beats.length > 40) this.beats.shift();
  }

  rrIntervals(n) {
    const b = this.beats.slice(-(n + 1));
    const rr = [];
    for (let i = 1; i < b.length; i++) rr.push(b[i] - b[i - 1]);
    return rr;
  }

  /** Re-evaluate rules at signal time `t`. Returns the current snapshot. */
  update(t, activity = "rest", { tempC = null } = {}) {
    this.t = t;
    this.activity = activity;
    const r = this.rules;
    const lastBeat = this.beats.at(-1) ?? 0;
    const noSignal = t - lastBeat > r.noSignalSec;

    const rr8 = this.rrIntervals(8);
    const rr12 = this.rrIntervals(12);
    const hr = !noSignal && rr8.length >= 3 ? 60 / mean(rr8) : null;
    let cv = null;
    if (!noSignal && rr12.length >= 8) {
      const m = mean(rr12);
      cv = Math.sqrt(mean(rr12.map((x) => (x - m) ** 2))) / m;
    }

    const conditions = {
      noSignal: noSignal && t > r.noSignalSec,
      tachyRest: hr !== null && activity === "rest" && hr > r.tachyRest,
      brady: hr !== null && hr < r.brady,
      irregular: cv !== null && cv > r.irregularCv,
      aboveZone: hr !== null && activity === "exercise" && hr > r.zoneMax,
      dangerHr: hr !== null && activity === "exercise" && hr > r.maxHr,
      highTemp: tempC !== null && tempC >= r.highTempC,
    };

    for (const [key, on] of Object.entries(conditions)) {
      if (on) {
        this.since[key] ??= t;
        const needed = key === "noSignal" ? 0 : r.sustainSec;
        if (!this.active[key] && t - this.since[key] >= needed) {
          const ev = { type: key, ...ALERTS[key], start: this.since[key], end: null, peakHr: hr };
          this.active[key] = ev;
          this.events.push(ev);
        }
        const ev = this.active[key];
        if (ev && hr !== null) {
          ev.peakHr = key === "brady" ? Math.min(ev.peakHr ?? hr, hr) : Math.max(ev.peakHr ?? hr, hr);
        }
      } else {
        delete this.since[key];
        if (this.active[key]) {
          this.active[key].end = t;
          delete this.active[key];
        }
      }
    }

    if (hr !== null) this.hrLog.push({ t, hr, activity });
    return this.snapshot(hr, cv);
  }

  snapshot(hr = this.lastHr, cv = this.lastCv) {
    this.lastHr = hr;
    this.lastCv = cv;
    return {
      t: this.t,
      activity: this.activity,
      hr,
      cv,
      regular: cv === null ? null : cv <= this.rules.irregularCv,
      activeAlerts: Object.values(this.active),
      zone: [this.rules.zoneMin, this.rules.zoneMax],
    };
  }

  /** Whole-session statistics for the doctor report. */
  summary() {
    const hrs = this.hrLog.map((x) => x.hr);
    const by = (act) => this.hrLog.filter((x) => x.activity === act).map((x) => x.hr);
    const stats = (a) => (a.length ? { avg: mean(a), min: Math.min(...a), max: Math.max(...a) } : null);
    return {
      durationSec: this.t,
      beats: this.beatCount ?? 0,
      overall: stats(hrs),
      rest: stats(by("rest")),
      exercise: stats(by("exercise")),
      events: this.events.map((e) => ({ ...e })),
    };
  }
}
