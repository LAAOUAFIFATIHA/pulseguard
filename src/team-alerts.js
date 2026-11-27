// Warns every team member, on any page, when a teammate has an urgent alert.
// Works while the app is open (no server push: that would need paid Firebase).
import { auth, getProfile, watchMembers } from "./db.js";
import { currentLocation, distanceMeters, formatDistance, mapLink } from "./location.js";
import { freshAlerts } from "./alerts-logic.js";

const $ = (id) => document.getElementById(id);

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
};

/** "320 m away · open map" for a shared position. */
export function placeLine(location) {
  const line = el("span", "place");
  if (!location) {
    line.textContent = "Location not shared";
    return line;
  }
  const mine = currentLocation();
  const away = mine ? `${formatDistance(distanceMeters(mine, location))} away · ` : "";
  const link = el("a", null, "Open map");
  link.href = mapLink(location);
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  line.append(`${away}±${location.accuracy} m · `, link);
  return line;
}

function beep() {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    osc.frequency.value = 880;
    osc.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.4);
    osc.onended = () => ctx.close();
  } catch {
    // sound is blocked until the user has interacted with the page
  }
}

export function initTeamAlerts() {
  let unsubscribe = null;
  const seen = new Set();
  const dismissed = new Set();
  let urgent = [];

  function render() {
    const shown = urgent.filter((m) => !dismissed.has(m.uid));
    const box = $("team-alert");
    box.hidden = !shown.length;
    $("team-alert-list").replaceChildren(
      ...shown.map((m) => {
        const li = el("li");
        const hr = m.hr == null ? "" : ` · ${Math.round(m.hr)} bpm`;
        li.append(el("strong", null, m.displayName), el("span", null, `${m.alert ?? "Alert"}${hr}`), placeLine(m.location));
        const close = el("button", "btn btn-ghost btn-sm", "Dismiss");
        close.type = "button";
        close.onclick = () => {
          dismissed.add(m.uid);
          render();
        };
        li.append(close);
        return li;
      })
    );
  }

  function onMembers(members) {
    const result = freshAlerts(members, seen, auth.currentUser.uid, Date.now());
    urgent = result.urgent;
    for (const uid of result.cleared) dismissed.delete(uid);
    for (const m of result.fresh) {
      beep();
      if (window.Notification?.permission === "granted") {
        new Notification(`${m.displayName} may need help`, { body: m.alert ?? "Alert", tag: m.uid });
      }
    }
    render();
  }

  $("enable-notifications").onclick = async () => {
    if (!window.Notification) return ($("team-status").textContent = "This browser has no notifications.");
    const answer = await Notification.requestPermission();
    $("team-status").textContent =
      answer === "granted" ? "Notifications on while PulseGuard is open." : "Notifications were not allowed.";
  };

  /** Call again after joining or leaving a team. */
  function restart() {
    unsubscribe?.();
    unsubscribe = null;
    seen.clear();
    dismissed.clear();
    urgent = [];
    render();
    const code = getProfile()?.teamId;
    if (code) unsubscribe = watchMembers(code, onMembers, (err) => console.warn("Team alerts stopped", err.code));
  }

  restart();
  return { restart };
}
