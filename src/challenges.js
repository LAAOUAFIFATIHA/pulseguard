// Friend challenges: pure rules (no Firebase), shared by the app and the tests.
//
// Only runs that start after the challenge was accepted and before its deadline
// count. A rated challenge gives: finisher +10, winner +5 more, times the
// difficulty, times a level-gap factor. It never takes points away.

export const INVITE_TTL_MS = 48 * 3600 * 1000;
export const MAX_RATED_PER_WEEK = 3;
export const MAX_RATED_PER_FRIEND_PER_WEEK = 1;

export const TYPES = {
  distance: { label: "Run X km", needs: ["km"], higherWins: false },
  timed: { label: "Run X km under Y min", needs: ["km", "minutes"], higherWins: false },
  weekDistance: { label: "Most distance this week", needs: [], higherWins: true },
  activeDays: { label: "Most active days", needs: [], higherWins: true },
  endurance: { label: "Best endurance score", needs: [], higherWins: true },
};

const ms = (t) => (t instanceof Date ? t.getTime() : typeof t === "number" ? t : t?.toMillis?.() ?? new Date(t).getTime());

export function describe(c) {
  const t = c.target ?? {};
  if (c.type === "distance") return `Run ${t.km} km`;
  if (c.type === "timed") return `Run ${t.km} km under ${t.minutes} min`;
  return TYPES[c.type]?.label ?? c.type;
}

/** "pending" invites expire after 48 h. */
export function isExpired(c, now = Date.now()) {
  return c.status === "pending" && now - ms(c.createdAt) > INVITE_TTL_MS;
}

/** Runs that count: started after acceptance and before the deadline. */
export function runsInWindow(c, runs) {
  const from = ms(c.acceptedAt);
  const to = ms(c.deadline);
  return runs.filter((r) => {
    const t = ms(r.startAt);
    return Number.isFinite(from) && t >= from && t <= to;
  });
}

/**
 * One runner's progress: value (km, days, score…), whether the goal is met,
 * the run that proves it and a 0–1 share for the progress bar.
 */
export function progress(c, runs) {
  const valid = runsInWindow(c, runs).filter((r) => !r.urgent || c.type === "activeDays");
  const t = c.target ?? {};
  const km = (r) => (r.distanceM ?? 0) / 1000;
  if (c.type === "distance" || c.type === "timed") {
    const ok = valid
      .filter((r) => km(r) >= t.km && (c.type === "distance" || r.seconds <= t.minutes * 60))
      .sort((a, b) => (c.type === "timed" ? a.seconds - b.seconds : ms(a.startAt) - ms(b.startAt)));
    const best = valid.reduce((m, r) => Math.max(m, km(r)), 0);
    if (ok.length) {
      const r = ok[0];
      // distance: earliest finish wins; timed: fastest time wins
      return { value: c.type === "timed" ? r.seconds : ms(r.startAt), finished: true, runId: r.id, share: 1 };
    }
    return { value: null, finished: false, runId: valid[0]?.id ?? null, share: Math.min(1, best / t.km), bestKm: best };
  }
  if (c.type === "weekDistance") {
    const total = valid.reduce((s, r) => s + km(r), 0);
    return { value: Math.round(total * 100) / 100, finished: valid.length > 0, runId: valid[0]?.id ?? null, share: Math.min(1, total / 20) };
  }
  if (c.type === "activeDays") {
    const days = new Set(valid.map((r) => new Date(ms(r.startAt)).toISOString().slice(0, 10))).size;
    return { value: days, finished: days > 0, runId: valid[0]?.id ?? null, share: Math.min(1, days / 7) };
  }
  if (c.type === "endurance") {
    const best = valid.reduce((m, r) => Math.max(m, r.endurance ?? 0), 0);
    const run = valid.find((r) => (r.endurance ?? 0) === best);
    return { value: best, finished: valid.length > 0, runId: run?.id ?? null, share: best / 100 };
  }
  return { value: null, finished: false, runId: null, share: 0 };
}

/** Winner uid, "tie", or null (nobody finished). */
export function winner(c, results) {
  const done = c.users.filter((u) => results[u]?.finished && results[u].value != null);
  if (!done.length) return null;
  if (done.length === 1) return done[0];
  const [a, b] = done;
  const va = results[a].value;
  const vb = results[b].value;
  if (va === vb) return "tie";
  const higher = TYPES[c.type]?.higherWins;
  return (higher ? va > vb : va < vb) ? a : b;
}

/** 1 to 1.5: longer and faster goals are harder. */
export function difficulty(c) {
  const t = c.target ?? {};
  let d = 1;
  if (t.km) d += Math.min(0.3, t.km / 50);
  if (c.type === "timed" && t.km && t.minutes) {
    const pace = t.minutes / t.km; // min per km
    if (pace < 6) d += Math.min(0.2, (6 - pace) * 0.1);
  }
  return Math.min(1.5, Math.round(d * 100) / 100);
}

/** Smaller reward when the two runners are far apart (stronger beating weaker). */
export function gapFactor(gap) {
  const g = Math.abs(gap);
  return g <= 300 ? 1 : Math.max(0.4, Math.round((1 - (g - 300) / 1000) * 100) / 100);
}

/**
 * Rating points for each runner. Never negative, capped at 60.
 * ratings: { uid: rating }.
 */
export function outcome(c, results, ratings = {}) {
  const win = winner(c, results);
  const [a, b] = c.users;
  const gap = (ratings[a] ?? 500) - (ratings[b] ?? 500);
  const out = {};
  for (const u of c.users) {
    const reasons = [];
    let base = 0;
    if (results[u]?.finished) {
      base += 10;
      reasons.push("Finished the challenge (+10)");
    }
    if (win === u) {
      base += 5;
      reasons.push("Won (+5)");
    }
    if (!c.rated) {
      out[u] = { delta: 0, won: win === u, reasons: [...reasons, "Friendly challenge: no rating"] };
      continue;
    }
    const strongerBeatsWeaker = (u === a ? gap : -gap) > 0;
    const f = strongerBeatsWeaker ? gapFactor(gap) : 1;
    if (base && c.rated) reasons.push(`Difficulty ×${difficulty(c)}`);
    if (base && f < 1) reasons.push(`Level gap ×${f}`);
    out[u] = { delta: Math.max(0, Math.min(60, Math.round(base * difficulty(c) * f))), won: win === u, reasons };
  }
  return { winner: win, results: out };
}

const WEEK = 7 * 86400000;
/** Anti-abuse: at most 3 rated challenges a week, and 1 per friend. */
export function canCreateRated(mine, friend, me, now = Date.now()) {
  const recent = mine.filter((c) => c.rated && c.status !== "declined" && now - ms(c.createdAt) < WEEK && !isExpired(c, now));
  if (recent.length >= MAX_RATED_PER_WEEK) return { ok: false, why: `At most ${MAX_RATED_PER_WEEK} rated challenges a week.` };
  if (recent.filter((c) => c.users.includes(friend) && c.users.includes(me)).length >= MAX_RATED_PER_FRIEND_PER_WEEK) {
    return { ok: false, why: "One rated challenge a week with the same friend." };
  }
  return { ok: true };
}

/** Warns when the goal is above 130 % of the weaker runner's best run. */
export function tooHard(c, bestKmOfWeaker) {
  const km = c.target?.km;
  if (!km || !bestKmOfWeaker) return null;
  return km > bestKmOfWeaker * 1.3
    ? `This goal is ${Math.round((km / bestKmOfWeaker) * 100)} % of the weaker runner's longest run. Pick something reachable: rest is part of training.`
    : null;
}
