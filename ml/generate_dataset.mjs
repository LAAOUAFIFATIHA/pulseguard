// Writes simulated sessions to ml/data/ in the same JSON format as the app's
// Export button, so train.py reads both.   Run: node ml/generate_dataset.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { EcgSimulator, SCENARIOS, mulberry32 } from "../src/ecg.js";
import { SensorSimulator } from "../src/sensors.js";
import { ChunkRecorder, decodeSamples } from "../src/recorder.js";

const SESSIONS_PER_SCENARIO = 30;
const SECONDS = 120;
const out = new URL("./data/", import.meta.url);
mkdirSync(out, { recursive: true });

let seed = 1;
for (const key of Object.keys(SCENARIOS)) {
  for (let n = 0; n < SESSIONS_PER_SCENARIO; n++, seed++) {
    const rand = mulberry32(seed * 7919);
    const ecg = new EcgSimulator({ scenario: key, seed });
    // each "person" has a slightly different heart rate (+/- 12 %)
    const hr = ecg.scenario.hr * (0.88 + 0.24 * rand());
    ecg.scenario = { ...ecg.scenario, hr };
    ecg.hr = hr;
    const body = new SensorSimulator({ seed });
    const { activity } = ecg.scenario;

    const chunks = [];
    const rec = new ChunkRecorder({ onChunk: (c) => chunks.push(c) });
    let i = 0;
    for (let s = 0; s < SECONDS; s++) {
      rec.sensors(body.generate(1, activity));
      for (const v of ecg.generate(1)) rec.push(v, { t: i++ / 250, label: key, activity });
    }
    rec.flush();

    const session = {
      sessionId: `sim-${key}-${n}`,
      source: "simulator",
      chunks: chunks.map((c) => ({ ...c, samples: decodeSamples(c.samples), accel: decodeSamples(c.accel) })),
    };
    writeFileSync(new URL(`${session.sessionId}.json`, out), JSON.stringify(session));
  }
}
console.log(`Wrote ${seed - 1} sessions to ml/data/`);
