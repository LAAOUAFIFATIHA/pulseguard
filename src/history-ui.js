// Cloud history (10 s summaries + anomaly events), a raw recording that stays
// in this browser for training, and the settings actions.
import {
  saveWindow,
  saveEvent,
  newEventId,
  recentEvents,
  exportAll,
  signOutAndClear,
  deleteAccount,
  usesPassword,
  auth,
} from "./db.js";
import { ChunkRecorder, decodeSamples, CHUNK_SECONDS } from "./recorder.js";
import { summarize } from "./summary.js";

const $ = (id) => document.getElementById(id);
const MAX_RAW_CHUNKS = 180; // 30 minutes kept in memory

function download(name, data) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: "application/json" }));
  Object.assign(document.createElement("a"), { href: url, download: name }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function createHistory({ sampleRate }) {
  const raw = [];
  let tracked = new Map(); // rhythm event object -> { id, ended }
  let saved = 0;
  let lastWrite = 0;
  const saving = () => $("save-history").checked;
  const status = (msg) => ($("history-status").textContent = msg);
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
    saveWindow(summarize(chunk), now - CHUNK_SECONDS * 1000, fail);
    status(`Saved ${++saved} summary block(s).`);
  };
  let recorder = new ChunkRecorder({ sampleRate, onChunk });

  /** `events` are the monitor's events; `t` is the session time in seconds. */
  function events(list, t) {
    if (!saving()) return;
    for (const e of list) {
      let entry = tracked.get(e);
      const ended = e.end != null;
      if (entry && (entry.ended || !ended)) continue; // nothing new
      entry ??= { id: newEventId(), startAt: Date.now() - (t - e.start) * 1000 };
      entry.ended = ended;
      tracked.set(e, entry);
      saveEvent(
        entry.id,
        { ...e, startAt: entry.startAt, endAt: ended ? Date.now() - (t - e.end) * 1000 : null },
        fail
      );
    }
  }

  async function refresh() {
    try {
      const list = $("sessions");
      const found = await recentEvents();
      list.replaceChildren();
      const add = (text) => list.append(Object.assign(document.createElement("li"), { textContent: text }));
      if (!found.length) add("No saved anomaly events yet.");
      for (const e of found) {
        const peak = e.peakHr ? ` · ${e.peakHr} bpm` : "";
        add(`${e.startAt.toDate().toLocaleString()} · ${e.type}${peak}`);
      }
    } catch (err) {
      fail(err);
    }
  }
  $("refresh-history").onclick = refresh;
  $("save-history").onchange = () => status(saving() ? "Saving is on." : "Saving is off.");
  status("Saving is on: one summary every 10 seconds.");

  $("download-raw").onclick = () => {
    recorder.flush();
    if (!raw.length) return status("Start the ECG first: nothing recorded yet.");
    download(`pulseguard-raw-${Date.now()}.json`, {
      sessionId: `local-${Date.now()}`,
      chunks: raw.map((c) => ({ ...c, samples: decodeSamples(c.samples), accel: decodeSamples(c.accel) })),
    });
  };

  // ── Settings ────────────────────────────────────────────────────────────
  const note = (msg) => ($("settings-status").textContent = msg);
  $("account-email").textContent = auth.currentUser.email;
  $("delete-password-row").hidden = !usesPassword();
  $("header-email").textContent = auth.currentUser.email;
  $("sign-out").onclick = $("header-signout").onclick = () => signOutAndClear().catch((err) => note(err.message));
  $("export-data").onclick = async () => {
    try {
      note("Preparing your data…");
      download("pulseguard-my-data.json", await exportAll());
      note("Downloaded.");
    } catch (err) {
      console.error(err);
      note("Export failed. Check your connection.");
    }
  };
  $("delete-account").onclick = async () => {
    if (!navigator.onLine) return note("Connect to the internet to delete your account.");
    if (usesPassword() && !$("delete-password").value) return note("Type your password to confirm.");
    if (!confirm("Delete all your data and your account? This cannot be undone.")) return;
    try {
      note("Deleting…");
      $("save-history").checked = false; // no new writes while deleting
      await deleteAccount($("delete-password").value);
    } catch (err) {
      console.error(err);
      note(/credential|password/.test(err.code) ? "Wrong password." : "Deletion failed. Please try again.");
    }
  };

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
    },
  };
}
