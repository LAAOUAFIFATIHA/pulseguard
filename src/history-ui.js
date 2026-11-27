// Recording (10 s summaries + anomaly events to the cloud, raw signal kept in
// this browser for training) and the History page.
import { saveWindow, saveEvent, newEventId, loadWindows } from "./db.js";
import { ChunkRecorder, decodeSamples, CHUNK_SECONDS } from "./recorder.js";
import { summarize } from "./summary.js";
import { groupSessions, formatDuration, sparkline } from "./sessions.js";
import { createReplay } from "./replay.js";
import { SCENARIOS } from "./ecg.js";
import { formatKm, runTotals } from "./run.js";

const $ = (id) => document.getElementById(id);
const MAX_RAW_CHUNKS = 180; // 30 minutes kept in memory
const LABELS = Object.fromEntries(Object.entries(SCENARIOS).map(([k, s]) => [k, s.label]));

export function download(name, data) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: "application/json" }));
  Object.assign(document.createElement("a"), { href: url, download: name }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const newSessionId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export function createHistory({ sampleRate, onShare }) {
  const raw = [];
  let tracked = new Map(); // rhythm event object -> { id, ended }
  let saved = 0;
  let lastWrite = 0;
  let sessionId = newSessionId();
  const saving = () => $("save-history").checked;
  const status = (msg) => ($("save-status").textContent = msg);
  const fail = (err) => {
    console.error(err);
    status(err.code === "permission-denied" ? "Not saved: the database refused the data." : "Not saved: " + err.message);
  };

  const onChunk = (chunk) => {
    raw.push(chunk);
    if (raw.length > MAX_RAW_CHUNKS) raw.shift();
    // only full blocks, at most one write every 9 s
    const now = Date.now();
    if (!saving() || chunk.sampleCount < CHUNK_SECONDS * sampleRate || now - lastWrite < 9000) return;
    lastWrite = now;
    saveWindow({ ...summarize(chunk), sessionId }, now - CHUNK_SECONDS * 1000, fail);
    status(`Saved ${++saved} summary block(s) this visit.`);
  };
  let recorder = new ChunkRecorder({ sampleRate, onChunk });

  /** `list` are the monitor's events; `t` is the session time in seconds. */
  function events(list, t) {
    if (!saving()) return;
    for (const e of list) {
      let entry = tracked.get(e);
      const ended = e.end != null;
      if (entry && (entry.ended || !ended)) continue; // nothing new
      entry ??= { id: newEventId(), startAt: Date.now() - (t - e.start) * 1000 };
      entry.ended = ended;
      tracked.set(e, entry);
      saveEvent(entry.id, { ...e, startAt: entry.startAt, endAt: ended ? Date.now() - (t - e.end) * 1000 : null }, fail);
    }
  }

  $("save-history").onchange = () => status(saving() ? "Saving is on." : "Saving is off.");
  status("Saving is on: one summary every 10 seconds while the monitor runs.");

  $("download-raw").onclick = () => {
    recorder.flush();
    if (!raw.length) return status("Start the live monitor first: nothing recorded yet.");
    download(`pulseguard-raw-${Date.now()}.json`, {
      sessionId: `local-${Date.now()}`,
      chunks: raw.map((c) => ({ ...c, samples: decodeSamples(c.samples), accel: decodeSamples(c.accel) })),
    });
  };

  // ── History page ─────────────────────────────────────────────────────────
  const replay = createReplay();
  const note = (msg) => ($("history-status").textContent = msg);

  function sessionRow(s) {
    const row = document.createElement("article");
    row.className = "session";
    const date = new Date(s.startMs);
    const alerts = s.alertWindows
      ? `<span class="pill bad">${s.alertWindows} alert block${s.alertWindows > 1 ? "s" : ""}</span>`
      : `<span class="pill ok">No alerts</span>`;
    row.innerHTML = `
      <div class="session-date">
        <strong>${date.toLocaleDateString(undefined, { day: "numeric", month: "short" })}</strong>
        <span>${date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}</span>
      </div>
      <div class="session-main">
        <div class="session-stats">
          <span><b>${formatDuration(s.seconds)}</b> duration</span>
          <span><b>${formatKm(runTotals(s.windows).distanceM)}</b> distance</span>
          <span><b>${s.avgHr == null ? "--" : Math.round(s.avgHr)}</b> avg bpm</span>
          <span><b>${s.maxHr == null ? "--" : Math.round(s.maxHr)}</b> max bpm</span>
        </div>
        <div class="session-tags"></div>
      </div>
      ${sparkline(s.windows.map((w) => w.avgHr))}
      <div class="session-side">${alerts}<button type="button" class="btn btn-outline btn-sm" data-act="share">Share</button><button type="button" class="btn btn-primary btn-sm" data-act="replay">Replay</button></div>`;
    const tags = row.querySelector(".session-tags");
    for (const label of s.labels) {
      tags.append(Object.assign(document.createElement("span"), { className: "chip static", textContent: LABELS[label] ?? label }));
    }
    row.querySelector('[data-act="replay"]').onclick = () => replay.open(s);
    row.querySelector('[data-act="share"]').onclick = () => onShare?.(s);
    return row;
  }

  async function refresh() {
    note("Loading…");
    try {
      const windows = (await loadWindows()).map((w) => ({ ...w, startMs: w.startAt.toMillis() }));
      const sessions = groupSessions(windows);
      const list = $("session-list");
      list.replaceChildren(...sessions.map(sessionRow));
      note(
        sessions.length
          ? `${sessions.length} session${sessions.length > 1 ? "s" : ""}, newest first.`
          : "No saved sessions yet. Start the live monitor: a summary is saved every 10 seconds."
      );
    } catch (err) {
      console.error(err);
      note("Could not load your history. Check your connection.");
    }
  }
  $("refresh-history").onclick = refresh;

  window.addEventListener("pagehide", () => recorder.flush());

  return {
    sample: (v, meta) => recorder.push(v, meta),
    sensors: (data) => recorder.sensors(data),
    beat: (t) => recorder.addBeat(t),
    annotate: (snap) => recorder.annotate(snap),
    events,
    pause: () => recorder.flush(),
    restart: () => {
      recorder.flush();
      recorder = new ChunkRecorder({ sampleRate, onChunk });
      tracked = new Map();
      sessionId = newSessionId();
    },
    enterPage: refresh,
    leavePage: () => replay.stop(),
  };
}
