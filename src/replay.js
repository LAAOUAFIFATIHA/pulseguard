// Session replay: plays a saved session like a video. The heart-rate chart
// shows the real saved values; the ECG trace is an illustration rebuilt from
// them (raw ECG is never uploaded).
import { EcgChart } from "./chart.js";
import { EcgSimulator, SCENARIOS } from "./ecg.js";
import { clock, formatDuration } from "./sessions.js";

const $ = (id) => document.getElementById(id);
const LABELS = Object.fromEntries(Object.entries(SCENARIOS).map(([k, s]) => [k, s.label]));

export function createReplay() {
  const ecg = new EcgChart($("rp-ecg"), { sampleRate: 250, seconds: 4 });
  const canvas = $("rp-chart");
  let session = null;
  let offsets = [];
  let duration = 0;
  let t = 0;
  let playing = false;
  let timer = null;
  let lastTick = 0;
  let sim = null;

  new ResizeObserver(() => drawChart()).observe(canvas);

  const indexAt = (time) => {
    let i = 0;
    while (i + 1 < offsets.length && offsets[i + 1] <= time) i++;
    return i;
  };

  function setPlaying(on) {
    playing = on;
    clearInterval(timer);
    $("rp-play").innerHTML = `<svg><use href="#i-${on ? "pause" : "play"}" /></svg>`;
    $("rp-play").setAttribute("aria-label", on ? "Pause" : "Play");
    if (on) {
      if (t >= duration) t = 0;
      lastTick = performance.now();
      timer = setInterval(tick, 50);
    }
  }

  function tick() {
    const now = performance.now();
    const dt = Math.min(0.5, (now - lastTick) / 1000);
    lastTick = now;
    t = Math.min(duration, t + dt * Number($("rp-speed").value));
    feedEcg(dt);
    render();
    if (t >= duration) setPlaying(false);
  }

  function feedEcg(dt) {
    const w = session.windows[indexAt(t)];
    const hr = w.avgHr ?? 0;
    sim.scenario = {
      ...sim.scenario,
      hr: hr || 60,
      irregular: w.label === "irregular" || (w.rrCv ?? 0) > 0.15,
      noSignal: !hr,
    };
    ecg.push(sim.generate(dt));
    ecg.draw();
  }

  function render() {
    const w = session.windows[indexAt(t)];
    $("rp-time").textContent = `${clock(t)} / ${clock(duration)}`;
    $("rp-seek").value = String(Math.round(t));
    $("rp-hr").textContent = w.avgHr == null ? "--" : `${Math.round(w.avgHr)} bpm`;
    $("rp-activity").textContent = w.motion === "moving" ? "Moving" : w.activity === "exercise" ? "Exercise" : "Rest";
    $("rp-temp").textContent = w.avgTempC == null ? "--" : `${w.avgTempC.toFixed(1)} °C`;
    const alert = w.alerts?.length > 0;
    $("rp-status").textContent = alert ? "Alert" : w.avgHr == null ? "No signal" : "Normal";
    $("rp-status").dataset.state = alert ? "alert" : "normal";
    drawChart();
  }

  function drawChart() {
    if (!session) return;
    const dpr = window.devicePixelRatio || 1;
    const { width, height } = canvas.getBoundingClientRect();
    if (!width) return;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);
    const css = getComputedStyle(canvas);
    const color = (name, fallback) => css.getPropertyValue(name).trim() || fallback;

    const pad = { l: 40, r: 12, t: 10, b: 22 };
    const w = width - pad.l - pad.r;
    const h = height - pad.t - pad.b;
    const hrs = session.windows.map((x) => x.avgHr).filter((x) => x != null);
    const lo = Math.floor((Math.min(...hrs, 60) - 10) / 10) * 10;
    const hi = Math.ceil((Math.max(...hrs, 100) + 10) / 10) * 10;
    const x = (sec) => pad.l + (duration ? (sec / duration) * w : 0);
    const y = (bpm) => pad.t + h - ((bpm - lo) / (hi - lo)) * h;

    ctx.clearRect(0, 0, width, height);
    ctx.font = "11px system-ui, sans-serif";
    ctx.fillStyle = color("--muted", "#3f7e77");
    ctx.strokeStyle = color("--border", "#dbe7e5");
    ctx.lineWidth = 1;
    for (let bpm = lo; bpm <= hi; bpm += (hi - lo) / 4) {
      ctx.beginPath();
      ctx.moveTo(pad.l, Math.round(y(bpm)) + 0.5);
      ctx.lineTo(pad.l + w, Math.round(y(bpm)) + 0.5);
      ctx.stroke();
      ctx.fillText(String(Math.round(bpm)), 6, y(bpm) + 4);
    }
    ctx.fillText("0:00", pad.l, height - 6);
    const endLabel = clock(duration);
    ctx.fillText(endLabel, pad.l + w - ctx.measureText(endLabel).width, height - 6);

    // alert bands
    ctx.fillStyle = color("--band", "rgba(220,38,38,.12)");
    session.windows.forEach((win, i) => {
      if (win.alerts?.length) ctx.fillRect(x(offsets[i]), pad.t, x(offsets[i] + win.seconds) - x(offsets[i]), h);
    });

    // heart rate: one step per 10 s block (each value is a block average)
    ctx.strokeStyle = color("--accent", "#d62839");
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    ctx.beginPath();
    let pen = false;
    session.windows.forEach((win, i) => {
      if (win.avgHr == null) return (pen = false);
      const py = y(win.avgHr);
      pen ? ctx.lineTo(x(offsets[i]), py) : ctx.moveTo(x(offsets[i]), py);
      ctx.lineTo(x(offsets[i] + win.seconds), py);
      pen = true;
    });
    ctx.stroke();

    // playhead
    ctx.strokeStyle = color("--text-h", "#0f5e55");
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x(t), pad.t);
    ctx.lineTo(x(t), pad.t + h);
    ctx.stroke();
  }

  $("rp-play").onclick = () => session && setPlaying(!playing);
  $("rp-seek").oninput = (e) => {
    t = Number(e.target.value);
    render();
  };
  $("replay-close").onclick = () => {
    setPlaying(false);
    $("replay-card").hidden = true;
    session = null;
  };

  return {
    open(s) {
      setPlaying(false);
      session = s;
      offsets = [];
      duration = 0;
      for (const w of s.windows) {
        offsets.push(duration);
        duration += w.seconds;
      }
      t = 0;
      sim = new EcgSimulator({ scenario: "rest", seed: 7 });
      ecg.clear();
      $("rp-seek").max = String(Math.round(duration));
      $("replay-title").textContent = `Session of ${new Date(s.startMs).toLocaleString()}`;
      $("replay-meta").textContent =
        `${formatDuration(s.seconds)} · ${s.labels.map((l) => LABELS[l] ?? l).join(", ")}`;
      $("replay-card").hidden = false;
      $("replay-card").scrollIntoView({ behavior: "smooth", block: "start" });
      render();
      feedEcg(0.5);
      setPlaying(true);
    },
    stop: () => setPlaying(false),
  };
}
