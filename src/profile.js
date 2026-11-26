// Profile card inside the app. The profile lives in users/{uid}.
import { getProfile, saveProfile } from "./db.js";

const FIELDS = ["displayName", "role", "age", "restingHr", "sex", "runner", "heightCm", "weightKg"];
const $ = (id) => document.getElementById(id);

/** Profile data that may be put in AI prompts: never the name. */
export function readProfile() {
  const { displayName, consentAt, updatedAt, ...rest } = getProfile() ?? {};
  return rest;
}

export function initProfile({ onChange } = {}) {
  const fill = () => {
    for (const f of FIELDS) $("profile-" + f).value = getProfile()?.[f] ?? "";
  };
  fill();
  $("profile-form").onsubmit = async (e) => {
    e.preventDefault();
    const input = Object.fromEntries(FIELDS.map((f) => [f, $("profile-" + f).value]));
    $("profile-status").textContent = "Saving…";
    try {
      const saved = saveProfile(input);
      onChange?.(readProfile());
      await saved;
      $("profile-status").textContent = "Saved. New thresholds apply now.";
    } catch (err) {
      console.error(err);
      $("profile-status").textContent = "Not saved. Check the values.";
    }
  };
}
