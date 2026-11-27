// Simulated body sensors of the T-shirt (later: ESP32 with an accelerometer
// and a temperature/humidity sensor). Movement is measured from the
// accelerometer signal, as it would be on the real device.
import { mulberry32 } from "./ecg.js";

export const ACCEL_RATE = 25; // Hz, magnitude of acceleration in g

export class SensorSimulator {
  constructor({ seed = Date.now() } = {}) {
    this.rand = mulberry32(seed);
    this.tempC = 33.2; // skin temperature
    this.humidity = 45; // % relative humidity under the shirt
    this.t = 0;
    this.carry = 0;
    this.secondCarry = 0;
  }

  /** `activity` is "rest" or "exercise". Returns new accel samples and 1 Hz readings. */
  generate(seconds, activity, { heat = false, speedKmh = 9.5 } = {}) {
    const running = activity === "exercise";
    const accel = [];
    const exact = seconds * ACCEL_RATE + this.carry;
    this.carry = exact - Math.floor(exact);
    for (let i = 0; i < Math.floor(exact); i++) {
      const step = running ? 0.6 * Math.sin(2 * Math.PI * 2.7 * this.t) : 0; // ~160 steps/min
      const noise = (this.rand() - 0.5) * (running ? 0.25 : 0.03);
      accel.push(1 + step + noise);
      this.t += 1 / ACCEL_RATE;
    }

    const readings = [];
    this.secondCarry += seconds;
    while (this.secondCarry >= 1) {
      this.secondCarry -= 1;
      const target = heat ? 38.8 : running ? 36 : 33.2;
      this.tempC += (target - this.tempC) / (heat ? 12 : 120) + (this.rand() - 0.5) * 0.05;
      this.humidity += ((running ? 80 : 45) - this.humidity) / 90 + (this.rand() - 0.5) * 0.6;
      // simulated GPS speed: zero when not running, a little variation when running
      const speed = running ? Math.max(0, speedKmh * (1 + (this.rand() - 0.5) * 0.12)) : 0;
      readings.push({
        tempC: Math.round(this.tempC * 100) / 100,
        humidity: Math.round(this.humidity * 10) / 10,
        speedKmh: Math.round(speed * 10) / 10,
      });
    }
    return { accel, readings };
  }
}

/** "moving" or "still", from the spread of the last 2 s of acceleration. */
export class MotionDetector {
  constructor({ threshold = 0.12 } = {}) {
    this.threshold = threshold;
    this.window = [];
  }

  push(samples) {
    this.window.push(...samples);
    this.window.splice(0, Math.max(0, this.window.length - 2 * ACCEL_RATE));
    if (this.window.length < ACCEL_RATE) return null;
    const mean = this.window.reduce((s, x) => s + x, 0) / this.window.length;
    const std = Math.sqrt(this.window.reduce((s, x) => s + (x - mean) ** 2, 0) / this.window.length);
    return std > this.threshold ? "moving" : "still";
  }
}
