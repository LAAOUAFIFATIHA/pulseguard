// Optional runner profile. No name or contact details are collected.
const KEY = "pulseguard.profile";
const FIELDS = ["age", "sex", "runner", "heightCm", "weightKg"];
const NUMBERS = new Set(["age", "heightCm", "weightKg"]);

const $ = (id) => document.getElementById(id);

export function readProfile() {
  const out = {};
  for (const f of FIELDS) {
    const v = $("profile-" + f).value.trim();
    if (v) out[f] = NUMBERS.has(f) ? Number(v) : v;
  }
  return out;
}

export function initProfile({ onChange } = {}) {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || "{}");
    for (const f of FIELDS) if (saved[f] != null) $("profile-" + f).value = saved[f];
  } catch {}
  for (const f of FIELDS) {
    $("profile-" + f).onchange = () => {
      const profile = readProfile();
      try {
        localStorage.setItem(KEY, JSON.stringify(profile));
      } catch {}
      onChange?.(profile);
    };
  }
}
