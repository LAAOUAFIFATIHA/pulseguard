// Live ECG monitor: runs the simulator in real time, feeds the chart, the beat
// detector and the anomaly rules, and keeps the monitor card up to date.
import { EcgSimulator, SCENARIOS } from "./ecg.js";
import { BeatDetector, RhythmMonitor } from "./anomaly.js";
import { EcgChart } from "./chart.js";
import { SensorSimulator, MotionDetector } from "./sensors.js";
import { formatKm, formatPace } from "./run.js";

const FS = 250;
const $ = (id) => document.getElementById(id);

const fmtTime = (sec) => {
  const s = Math.max(0, Math.floor(sec));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

export function createMonitor({ onAlert, recorder, getRules } = {}) {
  const chart = new EcgChart($("ecg-canvas"), { sampleRate: FS });
  let sim, detector, rhythm, timer, lastTick, lastUpdate, snap;
  let running = false;
  let sensors, motionDetector, body, totals, startedAt = null;

  // scenario picker
  for (const [key, s] of Object.entries(SCENARIOS)) {
    const opt = document.createElement("option");
    opt.value = key;
    opt.textContent = s.label;
    $("scenario").append(opt);
  }

  function reset() {
    recorder?.restart();
    sim = new EcgSimulator({ sampleRate: FS, scenario: $("scenario").value });
    detector = new BeatDetector({ sampleRate: FS });
    rhythm = new RhythmMonitor(getRules?.());
    sensors = new SensorSimulator();
    motionDetector = new MotionDetector();
    body = { motion: null, tempC: null, humidity: null, speedKmh: 0 };
    totals = { n: 0, moving: 0, tempC: 0, humidity: 0, distanceM: 0 };
    snap = rhythm.snapshot(null, null);
    chart.clear();
    chart.draw();
    lastUpdate = 0;
    startedAt = null;
    render();
  }

  function tick() {
    const now = performance.now();
    const dt = Math.min(1, (now - lastTick) / 1000); // cap catch-up when the tab was hidden
    lastTick = now;
    for (const v of sim.generate(dt)) {
      recorder?.sample(v, {
        t: detector.t,
        label: sim.scenarioKey,
        activity: sim.scenario.activity,
      });
      const beat = detector.push(v);
      if (beat !== null) {
        rhythm.addBeat(beat);
        recorder?.beat(beat);
        pulse();
      }
      chart.push([v]);
    }
    chart.draw();

    const { accel, readings } = sensors.generate(dt, sim.scenario.activity, sim.scenario);
    body.motion = motionDetector.push(accel);
    for (const r of readings) {
      Object.assign(body, r);
      totals.n++;
      totals.tempC += r.tempC;
      totals.humidity += r.humidity;
      totals.distanceM += (r.speedKmh ?? 0) / 3.6;
      if (body.motion === "moving") totals.moving++;
    }
    recorder?.sensors({ accel, readings });

    if (sim.t - lastUpdate >= 0.5) {
      lastUpdate = sim.t;
      const before = new Set(snap.activeAlerts.map((a) => a.type));
      snap = Object.assign(rhythm.update(sim.t, sim.scenario.activity, body), body);
      recorder?.annotate(snap);
      recorder?.events(rhythm.events, sim.t);
      const fresh = snap.activeAlerts.filter((a) => !before.has(a.type));
      render();
      if (fresh.length && onAlert) onAlert(fresh, snap);
    }
  }

  function pulse() {
    const el = $("hr-heart");
    el.classList.remove("beat");
    void el.offsetWidth; // restart the CSS animation
    el.classList.add("beat");
  }

  function render() {
    $("temp-value").textContent = body.tempC == null ? "--" : body.tempC.toFixed(1) + " °C";
    $("humidity-value").textContent = body.humidity == null ? "--" : Math.round(body.humidity) + " %";
    $("motion-value").textContent = body.motion == null ? "--" : body.motion === "moving" ? "Moving" : "Still";
    $("distance-value").textContent = totals.n ? formatKm(totals.distanceM) : "--";
    $("pace-value").textContent = formatPace(body.speedKmh);
    $("hr-value").textContent = snap.hr == null ? "--" : Math.round(snap.hr);
    $("session-time").textContent = fmtTime(sim.t);
    $("activity").textContent = snap.activity === "exercise" ? "Exercise" : "Rest";
    $("rhythm").textContent =
      snap.regular === null ? "Rhythm: measuring…" : snap.regular ? "Rhythm: regular" : "Rhythm: irregular";

    const list = $("alerts");
    list.replaceChildren();
    const events = rhythm.events.slice(-6).reverse();
    if (!events.length) {
      const li = document.createElement("li");
      li.className = "muted";
      li.textContent = "No alerts";
      list.append(li);
    }
    for (const e of events) {
      const li = document.createElement("li");
      li.className = `alert sev-${e.severity}${e.end == null ? " open" : ""}`;
      const when = `${fmtTime(e.start)}${e.end == null ? " – now" : ` – ${fmtTime(e.end)}`}`;
      li.textContent = `${when}  ${e.label}`;
      list.append(li);
    }
    $("hr-box").dataset.state = snap.activeAlerts.some((a) => a.severity === "high")
      ? "danger"
      : snap.activeAlerts.length
        ? "warn"
        : "ok";
  }

  function start() {
    if (running) return;
    running = true;
    startedAt ??= Date.now();
    lastTick = performance.now();
    timer = setInterval(tick, 40); // ~25 fps: generate samples, run rules, redraw
    $("start").textContent = "Pause";
  }

  function stop() {
    running = false;
    clearInterval(timer);
    recorder?.pause();
    $("start").textContent = "Resume";
  }

  $("start").onclick = () => (running ? stop() : start());
  $("restart").onclick = () => {
    reset();
    if (!running) start();
  };
  $("scenario").onchange = () => sim.setScenario($("scenario").value);

  reset();

  return {
    start,
    isRunning: () => running,
    startedAt: () => startedAt,
    setRules: (rules) => Object.assign(rhythm.rules, rules),
    rules: () => rhythm.rules,
    snapshot: () => snap,
    summary: () => ({
      ...rhythm.summary(),
      body: totals.n
        ? {
            avgTempC: totals.tempC / totals.n,
            avgHumidity: totals.humidity / totals.n,
            movingPercent: Math.round((100 * totals.moving) / totals.n),
            distanceM: Math.round(totals.distanceM),
          }
        : null,
    }),
    hasData: () => rhythm.hrLog.length > 0,
  };
}
