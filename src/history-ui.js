// "Save history" switch, session list, dataset export and delete.
import { signIn, openSession, listSessions, exportSession, deleteSession, saveProfile } from "./history.js";
import { ChunkRecorder } from "./recorder.js";

const $ = (id) => document.getElementById(id);
const PREF = "pulseguard.saveHistory";

function explain(err) {
  const code = err?.code ?? "";
  if (/configuration-not-found|operation-not-allowed|admin-restricted/.test(code)) {
    return "Enable Anonymous sign-in in the Firebase console (Authentication).";
  }
  if (/permission-denied/.test(code)) return "Firestore refused access: deploy firestore.rules.";
  return err?.message || String(err);
}

export function createHistory({ sampleRate, getSummary, getProfile }) {
  let recorder = null;
  let session = null;

  const status = (msg) => ($("history-status").textContent = msg);
  const fail = (err) => {
    console.error(err);
    status("Not saved. " + explain(err));
  };

  function newRecording() {
    recorder?.flush();
    session = openSession({ onError: fail, getProfile });
    const target = session;
    recorder = new ChunkRecorder({
      sampleRate,
      onChunk: (chunk) => {
        target.saveChunk(chunk, getSummary());
        status(`Saving: ${chunk.index + 1} block(s) of ECG recorded.`);
      },
    });
  }

  async function enable() {
    try {
      status("Connecting…");
      await signIn();
      saveProfile(getProfile()).catch(fail);
      newRecording();
      status("Saving is on. A block is stored every 10 seconds.");
      await refresh();
    } catch (err) {
      $("save-history").checked = false;
      fail(err);
    }
  }

  function disable() {
    recorder?.flush();
    recorder = session = null;
    status("Saving is off.");
  }

  async function refresh() {
    try {
      await signIn();
      const list = $("sessions");
      const sessions = await listSessions();
      list.replaceChildren();
      if (!sessions.length) list.append(Object.assign(document.createElement("li"), { textContent: "No saved sessions yet." }));
      for (const s of sessions) list.append(row(s));
    } catch (err) {
      fail(err);
    }
  }

  function row(s) {
    const li = document.createElement("li");
    const text = document.createElement("span");
    const hr = s.avgHr == null ? "no HR" : `avg ${Math.round(s.avgHr)} bpm`;
    text.textContent = `${new Date(s.startedAt).toLocaleString()} · ${Math.round(s.durationSec)} s · ${hr} · ${s.alerts?.length ?? 0} alert(s)`;

    const dl = Object.assign(document.createElement("button"), { type: "button", className: "chip", textContent: "Export" });
    dl.onclick = async () => {
      try {
        const data = await exportSession(s.id, s.profile ?? null);
        const url = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: "application/json" }));
        Object.assign(document.createElement("a"), { href: url, download: `pulseguard-${s.id}.json` }).click();
        URL.revokeObjectURL(url);
      } catch (err) {
        fail(err);
      }
    };

    const rm = Object.assign(document.createElement("button"), { type: "button", className: "chip", textContent: "Delete" });
    rm.onclick = async () => {
      if (!confirm("Delete this session permanently?")) return;
      try {
        await deleteSession(s.id);
        await refresh();
      } catch (err) {
        fail(err);
      }
    };

    li.append(text, dl, rm);
    return li;
  }

  $("save-history").onchange = (e) => {
    try {
      localStorage.setItem(PREF, e.target.checked ? "1" : "0");
    } catch {}
    e.target.checked ? enable() : disable();
  };
  $("refresh-history").onclick = refresh;
  window.addEventListener("pagehide", () => recorder?.flush());

  try {
    if (localStorage.getItem(PREF) === "1") {
      $("save-history").checked = true;
      enable();
    }
  } catch {}

  return {
    sensors: (data) => recorder?.sensors(data),
    profileChanged: (profile) => session && saveProfile(profile).catch(fail),
    sample: (v, meta) => recorder?.push(v, meta),
    beat: (t) => recorder?.addBeat(t),
    annotate: (snap) => recorder?.annotate(snap),
    pause: () => recorder?.flush(),
    restart: () => recorder && newRecording(),
    saveAnswer: (a) => session?.saveAnswer(a),
  };
}
