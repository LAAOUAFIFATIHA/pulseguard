// "Plan a run" page and live mode (current segment, countdown, voice cues).
import { getCard, getProfile, savePlan, myPlans, sharePlan, deletePlan, friendsPlans } from "./db.js";
import { rulesPlan, validatePlan, planSeconds, createLive, isHot, waterEvery, VOICE_LANG, DISCLAIMER } from "./runplan.js";
import { aiPlan } from "./ai.js";
import { maxHeartRate } from "./runsummary.js";

const $ = (id) => document.getElementById(id);
const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
};
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.max(0, Math.round(s % 60))).padStart(2, "0")}`;
const LABEL = { warmup: "Warm-up", run: "Run", walk: "Walk", rest: "Rest", water: "Water", cooldown: "Cool-down" };

export function initPlanner({ monitor, speakEnabled }) {
  let current = null; // { plan, input, id }
  let active = null; // live session
  let timer = null;

  function input() {
    const p = getProfile() ?? {};
    return {
      minutes: Number($("pl-min").value) || 30,
      level: $("pl-level").value,
      age: Number($("pl-age").value) || p.age || 30,
      restingHr: Number($("pl-rest").value) || p.restingHr || 60,
      weather: { tempC: Number($("pl-temp").value), humidity: Number($("pl-hum").value) },
      startHour: Number(($("pl-time").value || "08:00").split(":")[0]),
      walkBreaks: $("pl-walk").checked,
    };
  }

  function prompt(inp) {
    return `You are a careful running coach. Build a run plan as JSON only.
Runner: level ${inp.level}, age ${inp.age}, resting heart rate ${inp.restingHr} bpm. Goal: about ${inp.minutes} minutes.
Weather: ${inp.weather.tempC} °C, ${inp.weather.humidity} % humidity. Start time: ${inp.startHour}:00. Walk breaks: ${inp.walkBreaks ? "yes" : "no"}.
Rules you must follow:
- Segments in order, each startMinute equals the sum of the previous durations (in minutes).
- Types: warmup, run, walk, rest, water, cooldown. targetZone 1 to 5 (heart-rate zones).
- First segment: warmup of 300 to 600 seconds. Last: cooldown of at least 300 seconds.
- A water segment (60 s) at least every ${waterEvery(inp.weather)} minutes.
- If the plan is longer than 60 minutes, add a rest segment (about 120 s).
${isHot(inp.weather) ? "- It is hot or humid: shorten the plan by about 20 %, never use zone 4 or 5, mention shade." : ""}
- paceHint: a few words. note: one short sentence. Never give medical advice.`;
  }

  async function generate() {
    const inp = input();
    $("pl-status").textContent = "Planning…";
    $("pl-generate").disabled = true;
    let plan;
    try {
      const res = await aiPlan(prompt(inp));
      const v = validatePlan(res.plan, inp.weather);
      if (!v.ok) throw new Error("AI plan rejected: " + v.errors.join(" "));
      plan = { ...res.plan, source: "ai", notes: [DISCLAIMER, `Made by the AI (${res.source === "on_device" ? "on device" : "cloud"}), checked against the safety rules.`] };
    } catch (err) {
      console.warn("planner fallback:", err.message ?? err);
      plan = rulesPlan(inp);
      plan.notes.push("The AI was not available or its plan broke a safety rule, so this plan comes from simple rules.");
    } finally {
      $("pl-generate").disabled = false;
      $("pl-status").textContent = "";
    }
    current = { plan, input: inp, id: null };
    renderPlan($("pl-result"), plan, true);
  }

  function timeline(plan) {
    const total = planSeconds(plan);
    const bar = el("div", "plan-bar");
    for (const s of plan.segments) {
      const part = el("span", `seg seg-${s.type}`);
      part.style.flexGrow = String(s.durationSec / total);
      part.title = `${LABEL[s.type]} ${mmss(s.durationSec)}`;
      bar.append(part);
    }
    return bar;
  }

  function renderPlan(box, plan, editable) {
    box.hidden = false;
    const head = el("div", "card-head");
    const h = el("div");
    h.append(el("h2", null, plan.title ?? "Run plan"), el("p", "muted", `${Math.round(planSeconds(plan) / 60)} min · ${plan.segments.length} segments`));
    head.append(h, el("span", `pill ${plan.source === "ai" ? "ok" : "neutral"}`, plan.source === "ai" ? "AI plan" : "Rules plan"));
    const list = el("ol", "plan-list");
    for (const s of plan.segments) {
      const li = el("li", `seg-row seg-${s.type}`);
      li.append(el("span", "seg-time", `${mmss(s.startMinute * 60)}`), el("strong", null, LABEL[s.type]), el("span", null, `${mmss(s.durationSec)} · zone ${s.targetZone}`), el("span", "muted", [s.paceHint, s.note].filter(Boolean).join(" — ")));
      list.append(li);
    }
    const notes = el("ul", "plan-notes");
    for (const n of plan.notes ?? [DISCLAIMER]) notes.append(el("li", null, n));
    const acts = el("div", "actions");
    const start = el("button", "btn btn-primary", "Start in live mode");
    start.type = "button";
    start.onclick = () => startLive(plan);
    acts.append(start);
    if (editable) {
      const save = el("button", "btn btn-outline", "Save");
      save.type = "button";
      save.onclick = async () => {
        save.disabled = true;
        current.id = await savePlan(plan, current.input, $("pl-share").checked).catch((e) => (alert(e.message), null));
        save.textContent = current.id ? "Saved ✓" : "Save";
        renderMine();
      };
      const share = el("label", "check");
      share.innerHTML = '<input type="checkbox" id="pl-share" /> <span>Share with my friends</span>';
      acts.append(save, share);
    }
    box.replaceChildren(head, timeline(plan), list, notes, acts);
  }

  async function renderMine() {
    const mine = await myPlans().catch(() => []);
    $("pl-mine").replaceChildren(
      ...(mine.length
        ? mine.map((p) => {
            const li = el("li", "lb-row");
            const name = el("strong", "link-name", p.title);
            name.onclick = () => renderPlan($("pl-result"), p, false);
            const share = el("button", "btn btn-ghost btn-sm", p.shared ? "Shared ✓" : "Share");
            share.type = "button";
            share.onclick = async () => (await sharePlan(p.id, !p.shared), renderMine());
            const del = el("button", "btn btn-ghost btn-sm", "Delete");
            del.type = "button";
            del.onclick = async () => (await deletePlan(p.id), renderMine());
            li.append(name, el("span", "pill neutral", p.source === "ai" ? "AI" : "Rules"), share, del);
            return li;
          })
        : [el("li", "muted", "No saved plans yet.")])
    );
    const theirs = await friendsPlans().catch(() => []);
    $("pl-friends").replaceChildren(
      ...(theirs.length
        ? theirs.map((p) => {
            const li = el("li", "lb-row");
            const name = el("strong", "link-name", p.title);
            name.onclick = () => renderPlan($("pl-result"), p, false);
            li.append(name, el("span", "muted", `${Math.round(planSeconds(p) / 60)} min`));
            return li;
          })
        : [el("li", "muted", "Nothing shared by friends yet.")])
    );
  }

  // ── Weather (Open-Meteo, no key; coordinates rounded) ─────────────────────
  $("pl-weather").onclick = () => {
    if (!navigator.geolocation) return alert("No location on this device: type the weather.");
    $("pl-status").textContent = "Getting local weather…";
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const lat = pos.coords.latitude.toFixed(2);
          const lon = pos.coords.longitude.toFixed(2);
          const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m`).then((x) => x.json());
          $("pl-temp").value = Math.round(r.current.temperature_2m);
          $("pl-hum").value = Math.round(r.current.relative_humidity_2m);
          $("pl-status").textContent = "Weather from Open-Meteo.";
        } catch {
          $("pl-status").textContent = "Could not get the weather: type it.";
        }
      },
      () => ($("pl-status").textContent = "Location refused: type the weather."),
      { timeout: 10000 }
    );
  };
  $("pl-generate").onclick = generate;

  // ── Live mode ─────────────────────────────────────────────────────────────
  function speak(text) {
    if (!speakEnabled() || !window.speechSynthesis) return;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = VOICE_LANG[$("pl-lang").value] ?? "en-US";
    speechSynthesis.speak(u);
  }

  function startLive(plan) {
    stopLive();
    const maxHr = maxHeartRate(Number($("pl-age").value) || getProfile()?.age || 30);
    active = { plan, live: createLive(plan, { maxHr, lang: $("pl-lang").value }), start: null, id: current?.id ?? plan.id ?? null, adherence: null };
    $("plan-live").hidden = false;
    $("pl-live-title").textContent = plan.title ?? "Run plan";
    $("pl-live-seg").textContent = "Press Start to begin the plan";
    $("pl-live-count").textContent = mmss(planSeconds(plan));
    $("pl-live-next").textContent = "";
    location.hash = "#/live";
    timer = setInterval(tick, 500);
  }
  function tick() {
    if (!active || !monitor.isRunning()) return;
    const t = monitor.simSeconds();
    active.start ??= t;
    const snap = monitor.snapshot() ?? {};
    const r = active.live.tick({ tSec: t - active.start, hr: snap.hr ?? null, tempC: snap.tempC ?? null, nowMs: t * 1000 });
    for (const c of r.cues) speak(c);
    if (r.cues.length) $("pl-live-cue").textContent = r.cues.at(-1);
    active.adherence = r.adherence;
    if (r.done) {
      $("pl-live-seg").textContent = "Plan complete";
      $("pl-live-count").textContent = "0:00";
      $("pl-live-next").textContent = "Press Finish run to save it.";
      clearInterval(timer);
      return;
    }
    $("pl-live-seg").textContent = `${LABEL[r.segment.type]} · zone ${r.segment.targetZone}${r.segment.extra ? " (extra stop)" : ""}`;
    $("pl-live-count").textContent = mmss(r.remaining);
    $("pl-live-next").textContent = r.next ? `Next: ${LABEL[r.next.type]} ${mmss(r.next.durationSec)}` : "Next: finish";
    $("pl-live-adh").textContent = r.adherence == null ? "" : `In zone ${Math.round(r.adherence * 100)} %`;
    const total = r.segments.reduce((a, s) => a + s.durationSec, 0);
    $("pl-live-progress").style.width = `${Math.min(100, ((t - active.start) / total) * 100)}%`;
  }
  function stopLive() {
    clearInterval(timer);
    timer = null;
    $("plan-live").hidden = true;
  }
  $("pl-live-stop").onclick = () => {
    active = null;
    stopLive();
  };

  // defaults from the profile and card
  function enter() {
    const p = getProfile() ?? {};
    if (!$("pl-age").value && p.age) $("pl-age").value = p.age;
    if (!$("pl-rest").value && p.restingHr) $("pl-rest").value = p.restingHr;
    const lvl = getCard()?.runnerLevel;
    if (lvl && !$("pl-level").dataset.touched) $("pl-level").value = lvl;
    renderMine();
  }
  $("pl-level").onchange = () => ($("pl-level").dataset.touched = "1");

  return {
    enter,
    /** For the finished run: which plan and how well it was followed. */
    runInfo() {
      if (!active) return {};
      const info = { planId: active.id ?? "unsaved", adherence: active.adherence ?? undefined };
      active = null;
      stopLive();
      return info;
    },
  };
}
