// Profile page: identity, current status, last normal heart rate, personal
// thresholds and the edit form. The profile lives in users/{uid}.
import { getProfile, saveProfile, loadWindows } from "./db.js";
import { personalRules } from "./rules.js";
import { lastNormalWindow, timeAgo, initials } from "./status.js";

const FIELDS = ["displayName", "role", "age", "restingHr", "sex", "runner", "heightCm", "weightKg"];
const $ = (id) => document.getElementById(id);
const ROLE = { athlete: "Athlete", coach: "Coach" };

/** Profile data that may be put in AI prompts: never the name or team. */
export function readProfile() {
  const { displayName, consentAt, updatedAt, teamId, ...rest } = getProfile() ?? {};
  return rest;
}

export function initProfile({ onChange, status }) {
  let savedNormal = null; // from Firestore, when nothing live yet

  function fillForm() {
    for (const f of FIELDS) $("profile-" + f).value = getProfile()?.[f] ?? "";
  }

  function renderIdentity() {
    const p = getProfile() ?? {};
    const letters = initials(p.displayName);
    $("pf-avatar").textContent = $("side-avatar").textContent = letters;
    $("pf-name").textContent = $("side-name").textContent = p.displayName ?? "";
    $("pf-role").textContent = ROLE[p.role] ?? "";
    $("pf-team").textContent = p.teamId ? "In a team" : "No team";
    const r = personalRules(readProfile());
    $("pf-zone").textContent = `${r.zoneMin}–${r.zoneMax} bpm`;
    $("pf-limits").textContent = `< ${r.brady} · > ${r.tachyRest} bpm`;
  }

  function renderStatus() {
    const box = $("pf-current-box");
    box.dataset.state = status.state;
    if (status.state === "idle") {
      $("pf-current").textContent = "Not monitoring";
      $("pf-current-sub").textContent = "Start the live monitor to see it here.";
    } else {
      $("pf-current").textContent = `${status.hr} bpm`;
      $("pf-current-sub").textContent = status.state === "alert" ? status.alert : "Normal";
    }
    const normal = status.lastNormalAt ? { hr: status.lastNormalHr, at: status.lastNormalAt } : savedNormal;
    $("pf-normal").textContent = normal ? `${normal.hr} bpm` : "--";
    $("pf-normal-sub").textContent = normal
      ? `${timeAgo(normal.at)} · ${new Date(normal.at).toLocaleString()}`
      : "No normal reading saved yet.";
  }

  async function loadSavedNormal() {
    try {
      const w = lastNormalWindow(await loadWindows(60), personalRules(readProfile()));
      savedNormal = w ? { hr: Math.round(w.avgHr), at: w.startAt.toMillis() } : null;
      renderStatus();
    } catch (err) {
      console.warn("Could not load the last normal reading", err);
    }
  }

  $("profile-form").onsubmit = async (e) => {
    e.preventDefault();
    const input = Object.fromEntries(FIELDS.map((f) => [f, $("profile-" + f).value]));
    $("profile-status").textContent = "Saving…";
    try {
      const saved = saveProfile(input);
      renderIdentity();
      onChange?.(readProfile());
      await saved;
      $("profile-status").textContent = "Saved. New thresholds apply now.";
    } catch (err) {
      console.error(err);
      $("profile-status").textContent = "Not saved. Check the values.";
    }
  };

  fillForm();
  renderIdentity();
  renderStatus();

  return {
    renderStatus,
    renderIdentity,
    enter() {
      fillForm();
      renderIdentity();
      renderStatus();
      loadSavedNormal();
    },
  };
}
