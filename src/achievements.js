// Badges and personal records, computed from saved runs (pure: no Firebase).

export const RARITY = {
  common: { label: "Common", color: "#D77A7D" },
  uncommon: { label: "Uncommon", color: "#B23A48" },
  rare: { label: "Rare", color: "#8C2F39" },
  epic: { label: "Epic", color: "#69212D" },
  legendary: { label: "Legendary", color: "#461220" },
};

const ms = (r) => r.startMs ?? (r.startAt?.toMillis?.() ?? new Date(r.startAt).getTime());
const dayKey = (t) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const sum = (a) => a.reduce((s, x) => s + (x ?? 0), 0);

/** Longest run of consecutive days with at least one run. */
export function longestStreak(runs) {
  const days = [...new Set(runs.map((r) => dayKey(ms(r))))].sort();
  let best = 0;
  let cur = 0;
  let prev = null;
  for (const d of days) {
    const t = new Date(d + "T12:00:00").getTime();
    cur = prev != null && Math.round((t - prev) / 86400000) === 1 ? cur + 1 : 1;
    best = Math.max(best, cur);
    prev = t;
  }
  return best;
}

/** Most runs in one Monday-to-Sunday week. */
export function mostRunsInAWeek(runs) {
  const weeks = new Map();
  for (const r of runs) {
    const d = new Date(ms(r));
    const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));
    const k = monday.toDateString();
    weeks.set(k, (weeks.get(k) ?? 0) + 1);
  }
  return Math.max(0, ...weeks.values());
}

/** Fastest time for a distance, from the average pace of runs at least that long. */
export function fastest(runs, km) {
  let best = null;
  for (const r of runs) {
    if ((r.distanceM ?? 0) < km * 1000 || !r.seconds) continue;
    const t = Math.round((r.seconds * km * 1000) / r.distanceM);
    if (best == null || t < best) best = t;
  }
  return best;
}

export function records(runs, ratingPeak = null) {
  const temp = (r) => r.airTempC ?? r.avgTempC ?? null;
  const hottest = runs.reduce((m, r) => (temp(r) != null && (m == null || temp(r) > m) ? temp(r) : m), null);
  return {
    longestM: runs.reduce((m, r) => Math.max(m, r.distanceM ?? 0), 0),
    fastest1k: fastest(runs, 1),
    fastest5k: fastest(runs, 5),
    fastest10k: fastest(runs, 10),
    bestEndurance: runs.reduce((m, r) => Math.max(m, r.endurance ?? 0), 0),
    longestStreak: longestStreak(runs),
    mostRunsWeek: mostRunsInAWeek(runs),
    hottestC: hottest == null ? null : Math.round(hottest * 10) / 10,
    ratingPeak,
  };
}

/** What badges look at: runs plus a few social numbers. */
export function stats(runs, { challengesWon = 0, friends = 0 } = {}) {
  const safe = runs.filter((r) => !r.urgent);
  const zoneShare = (r) => {
    const total = sum(r.zones ?? []);
    return total ? (r.zones[1] ?? 0) / total : 0;
  };
  return {
    runs: runs.length,
    km: sum(runs.map((r) => r.distanceM)) / 1000,
    streak: longestStreak(runs),
    early: runs.some((r) => (r.startHour ?? new Date(ms(r)).getHours()) < 7),
    night: runs.some((r) => (r.startHour ?? new Date(ms(r)).getHours()) >= 21),
    heat: safe.some((r) => (r.airTempC ?? 0) >= 28 || (r.avgTempC ?? 0) >= 37),
    zoneMaster: safe.some((r) => r.seconds >= 1200 && zoneShare(r) >= 0.6),
    ironHeart: safe.some((r) => (r.endurance ?? 0) >= 80),
    planned: runs.some((r) => !!r.planId),
    challengesWon,
    friends,
  };
}

const atLeast = (v, n) => Math.min(1, (v ?? 0) / n);
const yes = (b) => (b ? 1 : 0);

export const BADGES = [
  { id: "first_run", name: "First run", icon: "👟", rarity: "common", desc: "Finish your first run.", progress: (s) => atLeast(s.runs, 1) },
  { id: "streak7", name: "7-day streak", icon: "🔥", rarity: "rare", desc: "Run 7 days in a row.", progress: (s) => atLeast(s.streak, 7) },
  { id: "streak30", name: "30-day streak", icon: "☄️", rarity: "legendary", desc: "Run 30 days in a row.", progress: (s) => atLeast(s.streak, 30) },
  { id: "runs10", name: "10 runs", icon: "🔟", rarity: "common", desc: "Finish 10 runs.", progress: (s) => atLeast(s.runs, 10) },
  { id: "runs50", name: "50 runs", icon: "🏅", rarity: "rare", desc: "Finish 50 runs.", progress: (s) => atLeast(s.runs, 50) },
  { id: "km100", name: "100 km", icon: "💯", rarity: "epic", desc: "Run 100 km in total.", progress: (s) => atLeast(s.km, 100) },
  { id: "early_bird", name: "Early bird", icon: "🌅", rarity: "uncommon", desc: "Start a run before 7:00.", progress: (s) => yes(s.early) },
  { id: "night_owl", name: "Night owl", icon: "🦉", rarity: "uncommon", desc: "Start a run after 21:00.", progress: (s) => yes(s.night) },
  { id: "heat_warrior", name: "Heat warrior", icon: "🌡️", rarity: "rare", desc: "Finish a hot run (28 °C or more) with no urgent alert.", progress: (s) => yes(s.heat) },
  { id: "zone_master", name: "Zone master", icon: "🎯", rarity: "rare", desc: "Spend 60 % of a 20-minute run in zone 2.", progress: (s) => yes(s.zoneMaster) },
  { id: "iron_heart", name: "Iron heart", icon: "❤️‍🔥", rarity: "epic", desc: "Reach an endurance score of 80.", progress: (s) => yes(s.ironHeart) },
  { id: "challenger", name: "Challenger", icon: "⚔️", rarity: "uncommon", desc: "Win a friend challenge.", progress: (s) => atLeast(s.challengesWon, 1) },
  { id: "social_runner", name: "Social runner", icon: "🤝", rarity: "uncommon", desc: "Have 3 friends.", progress: (s) => atLeast(s.friends, 3) },
  { id: "coach_student", name: "Coach student", icon: "📋", rarity: "uncommon", desc: "Finish a run from a plan.", progress: (s) => yes(s.planned) },
];

/** Every badge with its progress; `unlocked` keeps earlier unlock dates. */
export function evaluate(s, unlocked = {}) {
  return BADGES.map((b) => {
    const p = b.progress(s);
    return { ...b, progressValue: p, earned: p >= 1 || !!unlocked[b.id], unlockedAt: unlocked[b.id] ?? null };
  });
}

/** Ids that just became earned. */
export function newlyEarned(s, unlocked = {}) {
  return BADGES.filter((b) => b.progress(s) >= 1 && !unlocked[b.id]).map((b) => b.id);
}
