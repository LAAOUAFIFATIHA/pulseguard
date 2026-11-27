// Automatic safety check. The threshold rules give an immediate verdict; the AI
// is asked automatically and may raise that verdict, never lower it.
// Pure logic plus a small scheduler (no DOM), so it can be tested.

export const LEVELS = ["ok", "watch", "danger"];
/** Alerts serious enough to warn the whole team. */
export const URGENT_ALERTS = ["tachyRest", "brady", "irregular", "dangerHr", "highTemp"];

export const isUrgent = (alerts) => alerts.some((a) => URGENT_ALERTS.includes(a.type));

export function ruleLevel(snap) {
  if (isUrgent(snap.activeAlerts)) return "danger";
  return snap.activeAlerts.length ? "watch" : "ok";
}

/** The model is told to start with OK, WATCH or DANGER. */
export function parseVerdict(text = "") {
  const clean = text.replace(/[*_#`]/g, "").trim();
  const match = clean.match(/^(OK|WATCH|DANGER)\b[\s:.\-–]*/i);
  if (!match) return { level: null, message: clean };
  return { level: match[1].toLowerCase(), message: clean.slice(match[0].length).trim() };
}

export const worst = (a, b) => (LEVELS.indexOf(b) > LEVELS.indexOf(a) ? b : a);

export const FIRST_AFTER_SEC = 15;
export const EVERY_SEC = 180;
export const MIN_GAP_SEC = 20;

/** Decides when to ask the AI again. `now` is in seconds. */
export function createScheduler() {
  let dataSince = null;
  let last = null;
  let seen = "";
  return {
    due(snap, running, now) {
      if (!running || snap.hr == null) {
        dataSince = null;
        return false;
      }
      dataSince ??= now;
      const alerts = snap.activeAlerts.map((a) => a.type).sort().join();
      const newAlert = snap.activeAlerts.some((a) => !seen.split(",").includes(a.type));
      let due;
      if (last === null) due = now - dataSince >= FIRST_AFTER_SEC || newAlert;
      else due = (newAlert && now - last >= MIN_GAP_SEC) || now - last >= EVERY_SEC;
      if (due) {
        last = now;
        seen = alerts;
      }
      return due;
    },
    reset() {
      dataSince = last = null;
      seen = "";
    },
  };
}
