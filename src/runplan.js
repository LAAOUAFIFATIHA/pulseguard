// Run planner (pure, no Firebase): a rules-based plan, a validator for AI
// plans, and the live engine that follows a plan with voice cues.
// General guidance for a demo, not medical advice.

export const SEGMENT_TYPES = ["warmup", "run", "walk", "rest", "water", "cooldown"];
export const DISCLAIMER = "General guidance, not medical advice.";

/** JSON schema the AI must follow (also used to validate). */
export const PLAN_JSON_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    segments: {
      type: "array",
      items: {
        type: "object",
        properties: {
          type: { type: "string", enum: SEGMENT_TYPES },
          startMinute: { type: "number" },
          durationSec: { type: "integer" },
          targetZone: { type: "integer" },
          paceHint: { type: "string" },
          note: { type: "string" },
        },
        required: ["type", "startMinute", "durationSec", "targetZone", "paceHint", "note"],
      },
    },
  },
  required: ["title", "segments"],
};

export const isHot = (w) => (w?.tempC ?? 0) > 28 || (w?.humidity ?? 0) > 70;
/** Longest gap allowed between two water stops, in minutes. */
export const waterEvery = (w) => (isHot(w) ? 12 : 20);

/** Heart-rate zone bounds (bpm) from the maximum heart rate. */
export function zoneBounds(maxHr, zone) {
  const pct = [0.5, 0.6, 0.7, 0.8, 0.9, 1.0];
  return { low: Math.round(maxHr * pct[zone - 1]), high: Math.round(maxHr * pct[zone]) };
}
export const zoneOf = (hr, maxHr) => (hr == null ? null : Math.max(1, Math.min(5, Math.floor((hr / maxHr - 0.5) / 0.1) + 1)));

const LEVEL = {
  starting: { zone: 2, runMin: 3, walkMin: 2, pace: "easy, you can talk" },
  casual: { zone: 2, runMin: 8, walkMin: 1.5, pace: "easy to steady" },
  regular: { zone: 3, runMin: 15, walkMin: 1, pace: "steady" },
  competitive: { zone: 3, runMin: 20, walkMin: 1, pace: "steady, strong finish" },
};

/**
 * A plan from simple rules. input: { minutes, level, age, restingHr, weather:{tempC, humidity}, startHour, walkBreaks }
 */
export function rulesPlan(input) {
  const lv = LEVEL[input.level] ?? LEVEL.casual;
  const hot = isHot(input.weather);
  // heat shortens the plan
  let total = Math.max(20, Math.min(150, Math.round(input.minutes ?? 30)));
  if (hot) total = Math.round(total * 0.8);
  const warm = total >= 45 ? 10 : 5;
  const cool = 5;
  const segs = [];
  let t = 0; // seconds
  const push = (type, sec, zone, paceHint, note) => {
    segs.push({ type, startMinute: Math.round((t / 60) * 10) / 10, durationSec: Math.round(sec), targetZone: zone, paceHint, note });
    t += Math.round(sec);
  };
  push("warmup", warm * 60, 1, "brisk walk then very easy jog", "Loosen up, breathe through the nose.");
  const mainEnd = (total - cool) * 60;
  const gap = waterEvery(input.weather) * 60;
  let lastWater = 0;
  let restDone = false;
  const zone = hot ? Math.max(1, lv.zone - 1) : lv.zone;
  while (t < mainEnd - 30) {
    if (t - lastWater >= gap - 60) {
      push("water", 60, 1, "stop or walk", hot ? "Drink a few sips. Look for shade." : "Drink a few sips.");
      lastWater = t;
      continue;
    }
    if (!restDone && total > 60 && t >= (total / 2) * 60) {
      push("rest", 120, 1, "stand or walk", "Rest stop: check how you feel.");
      restDone = true;
      continue;
    }
    const until = Math.min(mainEnd, lastWater + gap - 60);
    const runSec = Math.min(lv.runMin * 60, until - t);
    if (runSec >= 30) push("run", runSec, zone, lv.pace, `Zone ${zone}.`);
    if (t >= mainEnd - 30) break;
    if (input.walkBreaks !== false && t - lastWater < gap - 120 && t < mainEnd - 90) push("walk", lv.walkMin * 60, 1, "walk", "Walk break.");
    else if (runSec < 30) push("run", Math.max(30, Math.min(until, mainEnd) - t), zone, lv.pace, `Zone ${zone}.`);
  }
  push("cooldown", cool * 60, 1, "easy jog then walk", "Bring your heart rate down slowly.");
  const notes = [DISCLAIMER];
  if (hot) notes.push("Hot or humid: shorter plan, lower zone and more water.");
  if ((input.startHour ?? 12) >= 11 && (input.startHour ?? 12) <= 16 && hot) notes.push("Midday heat: an early morning run is safer.");
  return { title: `${total} min ${hot ? "hot-weather " : ""}${input.level ?? "casual"} run`, segments: segs, source: "rules", notes };
}

/**
 * Checks a plan (from the AI or the rules). Returns { ok, errors }.
 */
export function validatePlan(plan, weather) {
  const errors = [];
  const s = plan?.segments;
  if (!Array.isArray(s) || s.length < 3) return { ok: false, errors: ["Not enough segments."] };
  let t = 0;
  for (const [i, x] of s.entries()) {
    if (!SEGMENT_TYPES.includes(x.type)) errors.push(`Segment ${i + 1}: unknown type.`);
    if (!Number.isInteger(x.durationSec) || x.durationSec < 15 || x.durationSec > 3600) errors.push(`Segment ${i + 1}: bad duration.`);
    if (!Number.isInteger(x.targetZone) || x.targetZone < 1 || x.targetZone > 5) errors.push(`Segment ${i + 1}: zone must be 1 to 5.`);
    if (Math.abs((x.startMinute ?? -1) * 60 - t) > 60) errors.push(`Segment ${i + 1}: start does not follow the previous one.`);
    t += x.durationSec ?? 0;
  }
  const first = s[0];
  if (first.type !== "warmup" || first.durationSec < 300 || first.durationSec > 600) errors.push("Start with a 5 to 10 minute warm-up.");
  const last = s[s.length - 1];
  if (last.type !== "cooldown" || last.durationSec < 300) errors.push("End with a cool-down of at least 5 minutes.");
  // water: never longer than the allowed gap (warm-up included)
  let since = 0;
  for (const x of s) {
    if (x.type === "water" || x.type === "rest") since = 0;
    else since += x.durationSec;
    if (since > waterEvery(weather) * 60 + 60 && x !== last) {
      errors.push(`Water at least every ${waterEvery(weather)} minutes.`);
      break;
    }
  }
  if (t > 60 * 60 && !s.some((x) => x.type === "rest")) errors.push("A run longer than 60 minutes needs a rest stop.");
  if (isHot(weather) && s.some((x) => x.targetZone >= 4)) errors.push("No zone 4 or 5 in the heat.");
  return { ok: errors.length === 0, errors };
}

export const planSeconds = (plan) => plan.segments.reduce((a, x) => a + x.durationSec, 0);

// ── Live mode ───────────────────────────────────────────────────────────────
export const CUES = {
  en: {
    warmup: "Warm up: easy pace.", run: (z) => `Run in zone ${z}.`, walk: "Walk break.", rest: "Rest stop.", water: "Water stop: drink a few sips.",
    cooldown: "Cool down: slow and easy.", slow: "Slow down: your heart rate is above the zone.", shade: "It is getting hot: find shade and drink.",
    done: "Plan complete. Well done.",
  },
  fr: {
    warmup: "Échauffement : allure facile.", run: (z) => `Cours en zone ${z}.`, walk: "Pause marche.", rest: "Pause repos.", water: "Pause eau : bois quelques gorgées.",
    cooldown: "Retour au calme : doucement.", slow: "Ralentis : ton cœur est au-dessus de la zone.", shade: "Il fait chaud : trouve de l'ombre et bois.",
    done: "Plan terminé. Bravo.",
  },
  ar: {
    warmup: "إحماء: بوتيرة سهلة.", run: (z) => `اركض في المنطقة ${z}.`, walk: "استراحة مشي.", rest: "توقف للراحة.", water: "توقف للماء: اشرب قليلاً.",
    cooldown: "تهدئة: ببطء وسهولة.", slow: "خفف السرعة: نبضك أعلى من المنطقة.", shade: "الجو حار: ابحث عن الظل واشرب.",
    done: "انتهت الخطة. أحسنت.",
  },
};
export const VOICE_LANG = { en: "en-US", fr: "fr-FR", ar: "ar-SA" };
const ANTI_REPEAT_MS = 30000;
const HIGH_HR_SEC = 20;

/**
 * Follows a plan. Call tick({ tSec, hr, tempC, nowMs }) about once a second;
 * it returns the current segment, countdown, next segment and cues to speak.
 */
export function createLive(plan, { maxHr, lang = "en", skinTempLimit = 38.5 } = {}) {
  const segs = plan.segments.map((s) => ({ ...s }));
  const text = CUES[lang] ?? CUES.en;
  const said = new Map(); // cue key -> last time (anti-repeat)
  let index = -1;
  let highSince = null;
  let shadeAdded = false;
  let inZone = 0;
  let counted = 0;

  const starts = () => {
    let t = 0;
    return segs.map((s) => ((t += s.durationSec), t - s.durationSec));
  };
  function say(key, msg, nowMs, out) {
    const last = said.get(key);
    if (last != null && nowMs - last < ANTI_REPEAT_MS) return;
    said.set(key, nowMs);
    out.push(msg);
  }
  const msgFor = (s) => (s.type === "run" ? text.run(s.targetZone) : text[s.type]);

  function tick({ tSec, hr = null, tempC = null, nowMs = Date.now() }) {
    const cues = [];
    const st = starts();
    const total = st[st.length - 1] + segs[segs.length - 1].durationSec;
    if (tSec >= total) {
      if (index !== segs.length) say("done", text.done, nowMs, cues);
      index = segs.length;
      return { done: true, cues, adherence: adherence() };
    }
    const i = st.findLastIndex((x) => x <= tSec);
    if (i !== index) {
      index = i;
      say(`seg${i}`, msgFor(segs[i]), nowMs, cues);
    }
    const seg = segs[i];
    // adherence: share of seconds in (or below) the target zone during run segments
    if (hr != null && maxHr) {
      counted++;
      if (hr <= zoneBounds(maxHr, seg.targetZone).high) inZone++;
      // heart rate above the zone for 20 s → slow down, longer next break
      if (hr > zoneBounds(maxHr, seg.targetZone).high + 3) {
        highSince ??= tSec;
        if (tSec - highSince >= HIGH_HR_SEC) {
          say("slow", text.slow, nowMs, cues);
          const nxt = segs.findIndex((s, k) => k > i && (s.type === "walk" || s.type === "water" || s.type === "rest"));
          if (nxt > 0 && !segs[nxt].extended) {
            segs[nxt].durationSec += 30;
            segs[nxt].extended = true;
          }
          highSince = tSec; // re-arm
        }
      } else highSince = null;
    }
    // temperature near its limit → an extra stop and "find shade"
    if (tempC != null && tempC >= skinTempLimit - 0.3 && !shadeAdded && seg.type === "run") {
      shadeAdded = true;
      say("shade", text.shade, nowMs, cues);
      const end = st[i] + seg.durationSec;
      const cut = Math.max(0, end - tSec - 5);
      if (cut > 0) {
        seg.durationSec -= cut;
        segs.splice(i + 1, 0, { type: "water", durationSec: 90, targetZone: 1, paceHint: "stop in the shade", note: "Extra stop: heat.", extra: true }, { ...seg, durationSec: cut });
      }
    }
    const st2 = starts();
    const remaining = st2[i] + segs[i].durationSec - tSec;
    return { done: false, index: i, segment: segs[i], remaining, next: segs[i + 1] ?? null, cues, segments: segs, adherence: adherence() };
  }
  function adherence() {
    return counted ? Math.round((inZone / counted) * 100) / 100 : null;
  }
  return { tick, adherence, segments: () => segs };
}
