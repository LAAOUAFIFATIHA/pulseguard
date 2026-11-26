import "./style.css";
import { ask, report, tagSymptoms, initDeviceModel, checkDeviceModel, InferenceSource } from "./ai.js";
import { createMonitor } from "./monitor.js";
import { appCheckReady } from "./firebase.js";
import { createHistory } from "./history-ui.js";
import { initProfile, readProfile } from "./profile.js";
import { buildCoachPrompt, buildReportPrompt } from "./prompts.js";

const $ = (id) => document.getElementById(id);
const AI_BUTTONS = ["ask", "report", "symptom", "coach-now", "doctor-report"];

// ── Example prompts (free-prompt panel) ─────────────────────────────────────
const EXAMPLES = {
  "ex-coach":
    "My heart rate is 152 bpm during a 20-minute jog and my target zone is 130-145 bpm. " +
    "Give me one short coaching tip, in two sentences.",
  "ex-report":
    "Write a short doctor-ready summary of this 24-hour ECG log, with trends and anything to follow up:\n" +
    "Patient: 34 y/o. Resting HR avg 68 bpm (min 52 asleep, max 171 during exercise). " +
    "Rhythm: sinus throughout. 3 episodes of HR > 120 bpm at rest, each under 40 s, at 02:14, 11:30, 16:05. " +
    "PR 162 ms, QRS 94 ms, QTc 418 ms. No ST changes. 12 isolated PVCs, no couplets.",
  "ex-symptom":
    "Felt my heart racing and a bit light-headed after climbing stairs, lasted about a minute, no chest pain.",
};

// ── Status pills ────────────────────────────────────────────────────────────
function updateNetStatus() {
  const online = navigator.onLine;
  $("net-status").textContent = online ? "Online" : "Offline";
  $("net-status").className = "pill " + (online ? "ok" : "bad");
}
window.addEventListener("online", updateNetStatus);
window.addEventListener("offline", updateNetStatus);

const DEVICE_LABELS = {
  available: "Gemini Nano: ready",
  downloading: "Gemini Nano: downloading…",
  downloadable: "Gemini Nano: not downloaded yet",
  unavailable: "Gemini Nano: this device can't run it (cloud only)",
  unsupported: "Gemini Nano: not supported in this browser (cloud only)",
};

async function showDeviceStatus() {
  const status = await checkDeviceModel();
  $("device-status").textContent = DEVICE_LABELS[status] ?? `Gemini Nano: ${status}`;
  $("device-status").className = "pill " + (status === "available" ? "ok" : "neutral");
  return status;
}

// ── Answer area ─────────────────────────────────────────────────────────────
function resetAnswer() {
  $("error-msg").textContent = "";
  $("error-msg").hidden = true;
  $("badge").className = "";
  $("badge").textContent = "";
  $("answer").textContent = "";
}

function showError(msg) {
  $("error-msg").textContent = msg;
  $("error-msg").hidden = false;
}

function showBadge(source) {
  const onDevice = source === InferenceSource.ON_DEVICE;
  $("badge").textContent = onDevice ? "On device" : "In cloud";
  $("badge").className = onDevice ? "on-device" : "in-cloud";
}

let busy = false;
function setLoading(on) {
  busy = on;
  AI_BUTTONS.forEach((id) => ($(id).disabled = on));
  if (on) $("answer").textContent = "Thinking…";
}

/** Turn SDK / network errors into a message a user can act on. */
function explain(err, kind) {
  const msg = err?.message || String(err);
  if (!navigator.onLine) {
    return kind === "report"
      ? "You're offline and the on-device model isn't ready, so the report can't be written. Reconnect and try again."
      : "You're offline and the on-device model isn't ready. Prepare it while online, or reconnect.";
  }
  if (/app.?check|403|401|PERMISSION_DENIED/i.test(msg)) {
    const fix = import.meta.env.DEV
      ? "Register the debug token printed in the console (Firebase console → App Check → Manage debug tokens)."
      : "This site could not be verified (check the Fraud Defense key in Firebase App Check), then reload the page.";
    return "Request rejected by App Check. " + fix + " " + msg;
  }
  return "Request failed: " + msg;
}

/** Read a coaching tip out loud: a runner can't read a screen. */
function speak(text) {
  if (!$("speak").checked || !window.speechSynthesis) return;
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text.replace(/[*_#`]/g, ""));
  utterance.lang = "en-US";
  speechSynthesis.speak(utterance);
}

const seconds = (ms) => (ms == null ? "-" : (ms / 1000).toFixed(1) + " s");

/** Add one line to the request log (source and response time). */
function logRequest(kind, { source, firstMs, totalMs }) {
  const row = document.createElement("tr");
  const cells = [
    new Date().toLocaleTimeString(),
    kind,
    source === InferenceSource.ON_DEVICE ? "On device" : "In cloud",
    seconds(firstMs),
    seconds(totalMs),
  ];
  for (const value of cells) row.append(Object.assign(document.createElement("td"), { textContent: value }));
  $("request-log").prepend(row);
  while ($("request-log").rows.length > 8) $("request-log").lastElementChild.remove();
}

/** Send a prompt to the right model and show the answer + badge. */
async function runAI(kind, prompt) {
  resetAnswer();
  if (!prompt) {
    showError("Type a prompt or pick an example first.");
    return;
  }
  $("last-prompt").textContent = prompt;
  setLoading(true);
  try {
    if (kind === "symptom") {
      // Symptom notes are private: never written to the cloud history.
      const result = await tagSymptoms(prompt, {
        confirmCloud: () =>
          confirm("This note can't be processed on this device. Send it to the cloud model?"),
      });
      $("answer").textContent = JSON.stringify(result.data, null, 2);
      showBadge(result.source);
      logRequest(kind, result);
    } else {
      const onText = (text) => ($("answer").textContent = text);
      const result = await (kind === "report" ? report(prompt, onText) : ask(prompt, onText));
      onText(result.text);
      showBadge(result.source);
      logRequest(kind, result);
      if (kind === "coach") speak(result.text);
      history.saveAnswer({ kind, prompt, text: result.text, source: result.source });
    }
  } catch (err) {
    console.error(err);
    $("answer").textContent = "";
    showError(err.privacy ? err.message : explain(err, kind));
  } finally {
    setLoading(false);
  }
}

// ── Live ECG + AI coach ─────────────────────────────────────────────────────
let lastAutoCoach = -Infinity;
// getSummary is only called while recording, after `monitor` exists.
initProfile({ onChange: (p) => history.profileChanged(p) });
const history = createHistory({ sampleRate: 250, getSummary: () => monitor.summary(), getProfile: readProfile });
const monitor = createMonitor({
  recorder: history,
  onAlert: (fresh, snap) => {
    if (!$("auto-coach").checked || busy || !fresh.length) return;
    if (snap.t - lastAutoCoach < 20) return; // don't flood the model
    lastAutoCoach = snap.t;
    runAI("coach", buildCoachPrompt(snap, readProfile()));
  },
});

$("coach-now").onclick = () => {
  if (!monitor.hasData()) {
    resetAnswer();
    showError("Start the live ECG and wait a few seconds for a heart rate first.");
    return;
  }
  runAI("coach", buildCoachPrompt(monitor.snapshot(), readProfile()));
};

$("doctor-report").onclick = () => {
  if (!monitor.hasData()) {
    resetAnswer();
    showError("Record some ECG first: start the live ECG, try a few scenarios, then ask for the report.");
    return;
  }
  runAI("report", buildReportPrompt(monitor.summary(), readProfile()));
};

$("speak").onchange = (e) => {
  if (!e.target.checked) window.speechSynthesis?.cancel();
};

// ── Free prompts (Part 1 tools) ─────────────────────────────────────────────
$("ask").onclick = () => runAI("coach", $("prompt").value.trim());
$("report").onclick = () => runAI("report", $("prompt").value.trim());
$("symptom").onclick = () => runAI("symptom", $("prompt").value.trim());

for (const [id, text] of Object.entries(EXAMPLES)) {
  $(id).onclick = () => ($("prompt").value = text);
}

// initializeDeviceModel must follow a user click.
$("init").onclick = async () => {
  const status = await checkDeviceModel();
  if (status === "unavailable" || status === "unsupported") {
    $("progress").textContent = DEVICE_LABELS[status] + ". Answers will come from the cloud.";
    return;
  }
  $("init").disabled = true;
  $("progress").textContent = status === "available" ? "Loading model…" : "Starting download…";
  try {
    await initDeviceModel((p) => {
      $("progress").textContent = `Model download: ${Math.round(p * 100)}%`;
    });
    $("progress").textContent = "On-device model ready.";
  } catch (err) {
    $("progress").textContent = "Model setup failed: " + (err?.message || err);
  } finally {
    $("init").disabled = false;
    showDeviceStatus();
  }
};

updateNetStatus();
showDeviceStatus();
if (!appCheckReady) {
  showError("This build has no reCAPTCHA site key, so App Check will reject AI requests. Set VITE_RECAPTCHA_SITE_KEY in .env and rebuild.");
}
