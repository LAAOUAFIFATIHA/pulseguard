import "./style.css";
import { ask, report, tagSymptoms, initDeviceModel, checkDeviceModel, InferenceSource } from "./ai.js";

const $ = (id) => document.getElementById(id);
const ACTION_BUTTONS = ["ask", "report", "symptom"];

// ── Example prompts ─────────────────────────────────────────────────────────
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

function setLoading(on) {
  ACTION_BUTTONS.forEach((id) => ($(id).disabled = on));
  if (on) $("answer").textContent = "Thinking…";
}

/** Turn SDK / network errors into a message a user can act on (Step 8). */
function explain(err, task) {
  const msg = err?.message || String(err);
  if (!navigator.onLine) {
    return task === "report"
      ? "You're offline and the on-device model isn't ready, so the report can't be written. Reconnect and try again."
      : "You're offline and the on-device model isn't ready. Prepare it (step 1) while online, or reconnect.";
  }
  if (/app.?check|403|401|PERMISSION_DENIED/i.test(msg)) {
    return "Request rejected by App Check. Register the debug token printed in the console (Firebase console → App Check → Manage debug tokens). " + msg;
  }
  return "Request failed: " + msg;
}

async function runTask(task) {
  resetAnswer();
  const prompt = $("prompt").value.trim();
  if (!prompt) {
    showError("Type a prompt or pick an example first.");
    return;
  }
  setLoading(true);
  try {
    if (task === "symptom") {
      const { data, source } = await tagSymptoms(prompt);
      $("answer").textContent = JSON.stringify(data, null, 2);
      showBadge(source);
    } else {
      const { text, source } = await (task === "report" ? report(prompt) : ask(prompt));
      $("answer").textContent = text;
      showBadge(source);
    }
  } catch (err) {
    console.error(err);
    $("answer").textContent = "";
    showError(explain(err, task));
  } finally {
    setLoading(false);
  }
}

// ── Wiring ──────────────────────────────────────────────────────────────────
$("ask").onclick = () => runTask("coach");
$("report").onclick = () => runTask("report");
$("symptom").onclick = () => runTask("symptom");

for (const [id, text] of Object.entries(EXAMPLES)) {
  $(id).onclick = () => ($("prompt").value = text);
}

// Step 6: initializeDeviceModel must follow a user click.
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
