// Synthetic ECG generator — stands in for the smart T-shirt (Priority 3).
// Each heartbeat is a sum of Gaussian bumps (P, Q, R, S, T waves). The
// simulator only produces a voltage signal; heart rate and anomalies are
// measured from that signal by anomaly.js, exactly as with a real sensor.

export const SCENARIOS = {
  rest: { label: "Resting, normal rhythm", activity: "rest", hr: 68 },
  exercise: { label: "Jogging", activity: "exercise", hr: 150, speedKmh: 9.5 },
  tachy: { label: "Fast heart rate at rest", activity: "rest", hr: 135 },
  brady: { label: "Slow heart rate", activity: "rest", hr: 42 },
  irregular: { label: "Irregular rhythm", activity: "rest", hr: 95, irregular: true },
  overheat: { label: "Running in heat (overheating)", activity: "exercise", hr: 158, heat: true, speedKmh: 8.5 },
  electrodeOff: { label: "Electrode off (no signal)", activity: "rest", hr: 68, noSignal: true },
};

/** Small seeded PRNG so tests are reproducible. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const gauss = (x, mu, sigma, amp) => amp * Math.exp(-((x - mu) ** 2) / (2 * sigma * sigma));

/** Voltage (mV-ish) of one beat at time `dt` seconds relative to its R peak. */
function beatShape(dt, beat) {
  const qtShift = 0.24 * Math.sqrt(beat.rr); // T wave moves closer at high HR (Bazett)
  let v = 0;
  if (beat.hasP) v += gauss(dt, -0.16, 0.025, 0.12);
  v += gauss(dt, -0.03, 0.01, -0.12); // Q
  v += gauss(dt, 0, 0.012, 1.0); // R
  v += gauss(dt, 0.03, 0.012, -0.25); // S
  v += gauss(dt, qtShift, 0.05, 0.3); // T
  return v;
}

export class EcgSimulator {
  constructor({ sampleRate = 250, seed = Date.now(), scenario = "rest" } = {}) {
    this.fs = sampleRate;
    this.rand = mulberry32(seed);
    this.t = 0; // seconds of signal generated so far
    this.carry = 0; // fractional samples carried between generate() calls
    this.beats = []; // scheduled beats near the current time
    this.setScenario(scenario);
    this.hr = this.scenario.hr;
    this.nextR = 0.4;
  }

  setScenario(key) {
    if (!SCENARIOS[key]) throw new Error(`Unknown scenario: ${key}`);
    this.scenarioKey = key;
    this.scenario = SCENARIOS[key];
  }

  /** Next R-R interval in seconds; heart rate eases toward the scenario target. */
  nextRR() {
    const { hr: target, irregular } = this.scenario;
    const base = 60 / this.hr;
    this.hr += (target - this.hr) * Math.min(1, base / 4);
    const rr = 60 / this.hr;
    if (irregular) return rr * (0.6 + 0.8 * this.rand());
    return rr * (1 + (this.rand() - 0.5) * 0.06);
  }

  /** Generate `seconds` of signal; returns an array of samples. */
  generate(seconds) {
    const exact = seconds * this.fs + this.carry;
    const n = Math.floor(exact);
    this.carry = exact - n;
    const out = new Array(n);
    const dt = 1 / this.fs;

    for (let i = 0; i < n; i++) {
      const t = this.t;
      while (this.nextR - t < 0.7) {
        const rr = this.nextRR();
        this.beats.push({ r: this.nextR, rr, hasP: !this.scenario.irregular });
        this.nextR += rr;
      }
      while (this.beats.length && this.beats[0].r < t - 0.7) this.beats.shift();

      let v = 0;
      if (!this.scenario.noSignal) {
        for (const beat of this.beats) {
          const d = t - beat.r;
          if (d > -0.7 && d < 0.7) v += beatShape(d, beat);
        }
        v += 0.05 * Math.sin(2 * Math.PI * 0.25 * t); // breathing baseline wander
      }
      v += (this.rand() - 0.5) * 0.04; // sensor noise
      out[i] = v;
      this.t += dt;
    }
    return out;
  }
}
