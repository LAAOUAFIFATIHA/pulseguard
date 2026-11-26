// Cuts the live ECG into fixed-size labelled chunks for storage and training.
// Pure logic (no Firebase, no DOM) so it can be unit-tested.

import { ACCEL_RATE } from "./sensors.js";

export const CHUNK_SECONDS = 10;
const SCALE = 1000; // samples are stored as int16: millivolts x 1000

/** mV floats -> compact little-endian int16 bytes (2 bytes per sample). */
export function encodeSamples(samples) {
  const view = new DataView(new ArrayBuffer(samples.length * 2));
  samples.forEach((v, i) => {
    const q = Math.max(-32768, Math.min(32767, Math.round(v * SCALE)));
    view.setInt16(i * 2, q, true);
  });
  return new Uint8Array(view.buffer);
}

export function decodeSamples(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = new Array(bytes.byteLength / 2);
  for (let i = 0; i < out.length; i++) out[i] = view.getInt16(i * 2, true) / SCALE;
  return out;
}

/**
 * Collects samples and calls `onChunk` every CHUNK_SECONDS. A chunk never
 * mixes two labels: changing label or activity closes the current chunk.
 */
export class ChunkRecorder {
  constructor({ sampleRate = 250, onChunk }) {
    this.fs = sampleRate;
    this.size = sampleRate * CHUNK_SECONDS;
    this.onChunk = onChunk;
    this.index = 0;
    this.current = null;
    this.pending = { accel: [], tempC: [], humidity: [] };
  }

  /** Accelerometer samples and 1 Hz temperature / humidity readings. */
  sensors({ accel, readings }) {
    this.pending.accel.push(...accel);
    for (const r of readings) {
      this.pending.tempC.push(r.tempC);
      this.pending.humidity.push(r.humidity);
    }
  }

  /** `meta`: { t (signal time of this sample, s), label, activity } */
  push(sample, { t, label, activity }) {
    if (this.current && (this.current.label !== label || this.current.activity !== activity)) this.flush();
    this.current ??= { startSec: t, label, activity, samples: [], beats: [], alerts: new Set(), hr: null };
    this.current.samples.push(sample);
    if (this.current.samples.length >= this.size) this.flush();
  }

  /** R-peak time in session seconds. */
  addBeat(t) {
    this.current?.beats.push(t);
  }

  /** Latest rule results, attached to the open chunk. */
  annotate(snapshot) {
    if (!this.current) return;
    if (snapshot.hr != null) this.current.hr = snapshot.hr;
    if (snapshot.motion) this.current.motion = snapshot.motion;
    for (const a of snapshot.activeAlerts) this.current.alerts.add(a.type);
  }

  /** Emit the open chunk. Fragments under 1 s are dropped. */
  flush() {
    const c = this.current;
    this.current = null;
    const body = this.pending;
    this.pending = { accel: [], tempC: [], humidity: [] };
    if (!c || c.samples.length < this.fs) return;
    this.onChunk({
      index: this.index++,
      startSec: c.startSec,
      sampleRate: this.fs,
      sampleCount: c.samples.length,
      label: c.label,
      activity: c.activity,
      hr: c.hr,
      alerts: [...c.alerts],
      beats: c.beats.map((b) => Math.round((b - c.startSec) * 1000) / 1000),
      samples: encodeSamples(c.samples),
      motion: c.motion ?? null,
      accelRate: ACCEL_RATE,
      accel: encodeSamples(body.accel), // g x 1000
      tempC: body.tempC,
      humidity: body.humidity,
    });
  }
}
