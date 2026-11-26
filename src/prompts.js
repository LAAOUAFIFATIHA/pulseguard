// Prompt builders. Coaching prompts stay short and single-turn so Gemini Nano
// can answer them on-device; the report prompt carries the whole session and
// is sent cloud-first.

const fmtTime = (sec) => {
  const s = Math.max(0, Math.round(sec));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};
const bpm = (x) => (x == null ? "unknown" : `${Math.round(x)} bpm`);

const describe = (p) => {
  const parts = [
    p.age && `age ${p.age}`,
    p.sex,
    p.runner && `running level: ${p.runner}`,
    p.heightCm && `${p.heightCm} cm`,
    p.weightKg && `${p.weightKg} kg`,
  ].filter(Boolean);
  return parts.length ? `User: ${parts.join(", ")}.\n` : "";
};

/** Live coaching tip from the current snapshot (on-device). */
export function buildCoachPrompt(snap, profile = {}) {
  const body = [
    snap.motion && `Movement: ${snap.motion}.`,
    snap.tempC != null && `Skin temperature: ${snap.tempC.toFixed(1)} C.`,
    snap.humidity != null && `Humidity under shirt: ${Math.round(snap.humidity)} %.`,
  ]
    .filter(Boolean)
    .join(" ");
  const alerts = snap.activeAlerts.length
    ? snap.activeAlerts.map((a) => a.label).join("; ")
    : "none";
  const rhythm = snap.regular === null ? "not enough data yet" : snap.regular ? "regular" : "irregular";
  const zone = snap.activity === "exercise" ? ` Target zone: ${snap.zone[0]}-${snap.zone[1]} bpm.` : "";

  return (
    "You are PulseGuard, a friendly heart-rate coach in a wellness app. " +
    "You are not a doctor and must not diagnose.\n" +
    describe(profile) +
    (body ? body + "\n" : "") +
    `Activity: ${snap.activity}. Heart rate: ${bpm(snap.hr)}. Rhythm: ${rhythm}.${zone} ` +
    `Active alerts: ${alerts}.\n` +
    "Give one short, practical tip in at most two sentences. " +
    "If an alert is 'Fast heart rate at rest', 'Slow heart rate' or 'Irregular rhythm', " +
    "tell the user to stop, sit down, and contact a doctor or emergency services if they feel unwell."
  );
}

/** Doctor-ready session report (cloud-first). */
export function buildReportPrompt(sum, profile = {}) {
  const line = (name, s) =>
    s ? `- ${name}: average ${bpm(s.avg)}, min ${bpm(s.min)}, max ${bpm(s.max)}` : `- ${name}: no data`;
  const events = sum.events.length
    ? sum.events
        .map(
          (e) =>
            `- ${fmtTime(e.start)} to ${e.end == null ? "still ongoing" : fmtTime(e.end)}: ` +
            `${e.label} (severity ${e.severity}${e.peakHr ? `, extreme ${bpm(e.peakHr)}` : ""})`
        )
        .join("\n")
    : "- none";

  return (
    "You are writing a summary of a wearable ECG session for the user to show their doctor. " +
    "The data comes from a consumer device with simple threshold rules, so do not diagnose; " +
    "describe what was measured and what may be worth discussing.\n\n" +
    describe(profile) +
    (sum.body
      ? `Skin temperature average ${sum.body.avgTempC.toFixed(1)} C, humidity average ${Math.round(sum.body.avgHumidity)} %, moving ${sum.body.movingPercent} % of the time.\n`
      : "") +
    `Session length: ${fmtTime(sum.durationSec)} (mm:ss), ${sum.beats} beats detected.\n` +
    "Heart rate:\n" +
    [line("Overall", sum.overall), line("At rest", sum.rest), line("During exercise", sum.exercise)].join("\n") +
    "\n\nAlerts (time from session start):\n" +
    events +
    "\n\nWrite the summary with these sections: Overview, Heart rate trends, Notable events, " +
    "Questions to discuss with a doctor. Keep it under 200 words. End with a one-line reminder " +
    "that PulseGuard is not a medical device."
  );
}
