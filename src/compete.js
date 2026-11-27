// Compete page: runners at your level, friend challenges and leaderboards.
import {
  auth, getCard, getProfile, cardOf, getRatingState, loadRating, listRuns, watchChallenges, createChallenge, acceptChallenge,
  declineChallenge, cancelChallenge, challengeResults, saveChallengeResult, finishChallenge, rateChallenge, addChallengeWin,
  friendCards, followingCards, teamCards, cityCards, runnersAtMyLevel, setLeaderboardOptIn, syncWeekKm, hiddenPeople,
} from "./db.js";
import { TYPES, describe, isExpired, progress, winner, outcome, canCreateRated, tooHard } from "./challenges.js";
import { weekKey } from "./runsummary.js";
import { formatKm } from "./run.js";

const $ = (id) => document.getElementById(id);
const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
};
function button(text, className, action) {
  const b = el("button", `btn btn-sm ${className}`, text);
  b.type = "button";
  b.onclick = async () => {
    b.disabled = true;
    try {
      await action();
    } catch (err) {
      console.error(err);
      alert(err.message ?? String(err));
    } finally {
      b.disabled = false;
    }
  };
  return b;
}
const ms = (t) => t?.toMillis?.() ?? (t instanceof Date ? t.getTime() : t ?? 0);

export function initCompete() {
  const me = () => auth.currentUser.uid;
  let challenges = [];
  let runsCache = null;
  const settling = new Set();

  const runs = async (fresh = false) => {
    if (!runsCache || fresh) runsCache = await listRuns(200).catch(() => []);
    return runsCache;
  };
  const otherOf = (c) => c.users.find((u) => u !== me());
  const nameIn = (c, u) => c.names?.[u]?.name ?? "Runner";

  // ── Challenge list ──────────────────────────────────────────────────────
  function bar(share) {
    const b = el("div", "progress ch-progress");
    const s = el("span");
    s.style.width = `${Math.round(Math.min(1, share ?? 0) * 100)}%`;
    b.append(s);
    return b;
  }

  async function row(c) {
    const other = otherOf(c);
    const li = el("li", "ch-row");
    const head = el("div", "ch-head");
    head.append(el("strong", null, describe(c)), el("span", `pill ${c.rated ? "ok" : "neutral"}`, c.rated ? "Rated" : "Friendly"));
    li.append(head, el("p", "muted", `${c.names?.[c.from]?.avatar ?? ""} ${nameIn(c, c.from)} vs ${nameIn(c, c.users[1])} · ${c.days} day${c.days > 1 ? "s" : ""}`));
    const acts = el("div", "actions");

    if (c.status === "pending") {
      if (isExpired(c)) li.append(el("p", "muted", "Expired: invites last 48 h."));
      else if (c.users[1] === me()) acts.append(button("Accept", "btn-primary", () => acceptChallenge(c)), button("Decline", "btn-ghost", () => declineChallenge(c)));
      else acts.append(el("span", "pill neutral", "Waiting for an answer"), button("Cancel", "btn-ghost", () => cancelChallenge(c)));
    }

    if (c.status === "accepted" || c.status === "finished") {
      const res = await challengeResults(c);
      for (const u of c.users) {
        const r = res[u];
        const line = el("div", "ch-line");
        const val = r?.value == null ? "no valid run yet" : fmtValue(c, r.value);
        line.append(el("span", null, `${u === me() ? "You" : nameIn(c, u)}: ${r?.finished ? "✓ " : ""}${val}`), bar(r?.share));
        li.append(line);
      }
      if (c.status === "accepted") {
        const left = ms(c.deadline) - Date.now();
        li.append(el("p", "muted", left > 0 ? `Ends in ${Math.ceil(left / 3600000)} h · only runs after acceptance count` : "Time is up"));
        acts.append(button("Update my progress", "btn-outline", () => updateMine(c, true)));
      } else {
        const w = c.winner;
        li.append(el("p", "ch-result", w === "tie" ? "Tie" : w ? `${w === me() ? "You won" : nameIn(c, w) + " won"} 🏆` : "Nobody finished"));
      }
    }
    if (acts.childNodes.length) li.append(acts);
    return li;
  }

  function fmtValue(c, v) {
    if (c.type === "timed") return `${Math.floor(v / 60)}:${String(Math.round(v % 60)).padStart(2, "0")} min`;
    if (c.type === "distance") return `done ${new Date(v).toLocaleDateString()}`;
    if (c.type === "weekDistance") return `${v} km`;
    if (c.type === "activeDays") return `${v} day${v > 1 ? "s" : ""}`;
    return `score ${v}`;
  }

  async function render() {
    const incoming = challenges.filter((c) => c.status === "pending" && !isExpired(c));
    const active = challenges.filter((c) => c.status === "accepted");
    const history = challenges.filter((c) => !incoming.includes(c) && !active.includes(c));
    $("ch-count").textContent = incoming.filter((c) => c.users[1] === me()).length || "";
    for (const [id, list, empty] of [
      ["ch-incoming", incoming, "No invites. Challenge a friend from their profile or with New challenge."],
      ["ch-active", active, "No challenge running."],
      ["ch-history", history, "Finished challenges show here."],
    ]) {
      const rows = await Promise.all(list.map(row));
      $(id).replaceChildren(...(rows.length ? rows : [el("li", "muted empty-line", empty)]));
    }
  }

  /** Writes my progress from my saved runs, then closes the challenge if it is over. */
  async function updateMine(c, fresh = false) {
    const p = progress(c, await runs(fresh));
    if (Date.now() <= ms(c.deadline)) await saveChallengeResult(c, p).catch((e) => console.warn("result", e));
    await settle(c);
    await render();
  }

  async function settle(c) {
    if (settling.has(c.id)) return;
    settling.add(c.id);
    try {
      const res = await challengeResults(c);
      const bothDone = c.users.every((u) => res[u]?.finished);
      if (c.status === "accepted" && (bothDone || Date.now() > ms(c.deadline))) {
        // only goal-type challenges close early; "most …" ones run to the deadline
        const early = c.type === "distance" || c.type === "timed";
        if (bothDone && !early && Date.now() <= ms(c.deadline)) return;
        await finishChallenge(c, winner(c, res));
      }
      if (c.status === "finished" && !localStorage.getItem(`settled_${c.id}_${me()}`)) {
        const ratings = {};
        for (const u of c.users) ratings[u] = u === me() ? getRatingState()?.rating : (await cardOf(u))?.rating;
        const o = outcome(c, res, ratings).results[me()];
        // rated once: the event id is the challenge id
        if (o && c.rated && o.delta > 0) await rateChallenge(c.id, o.delta, o.reasons).catch(() => {});
        if (c.winner === me()) await addChallengeWin().catch(() => {});
        localStorage.setItem(`settled_${c.id}_${me()}`, "1");
      }
    } finally {
      settling.delete(c.id);
    }
  }

  watchChallenges(
    (list) => {
      challenges = list;
      render();
      for (const c of list) if (c.status === "accepted" && Date.now() > ms(c.deadline)) settle(c);
      for (const c of list) if (c.status === "finished") settle(c);
    },
    (err) => console.warn("challenges", err)
  );

  // After every finished run: weekly distance on the card and challenge progress.
  window.addEventListener("run-finished", async () => {
    const all = await runs(true);
    const wk = weekKey(new Date());
    const km = all.filter((r) => weekKey(new Date(r.startMs)) === wk).reduce((s, r) => s + r.distanceM / 1000, 0);
    await syncWeekKm(km, wk).catch(() => {});
    for (const c of challenges.filter((x) => x.status === "accepted")) await updateMine(c);
  });

  // ── New challenge dialog ────────────────────────────────────────────────
  let target = null;
  async function openDialog(friendUid, friendCard) {
    const friends = (await friendCards()).filter((c) => c.uid !== me());
    if (!friends.length) return alert("Challenges are between friends. Add a friend first.");
    $("ch-friend").replaceChildren(...friends.map((f) => new Option(`${f.avatar} ${f.displayName} @${f.handle}`, f.uid)));
    if (friendUid) $("ch-friend").value = friendUid;
    target = friendCard ?? null;
    $("ch-type").replaceChildren(...Object.entries(TYPES).map(([k, v]) => new Option(v.label, k)));
    $("ch-warn").textContent = "";
    delete $("ch-warn").dataset.confirmed;
    syncFields();
    $("challenge-dialog").showModal();
  }
  function syncFields() {
    const needs = TYPES[$("ch-type").value].needs;
    $("ch-km-field").hidden = !needs.includes("km");
    $("ch-min-field").hidden = !needs.includes("minutes");
  }
  $("ch-type").onchange = syncFields;
  $("ch-new").onclick = () => openDialog();
  $("ch-cancel").onclick = () => $("challenge-dialog").close();
  $("ch-form").onsubmit = async (e) => {
    e.preventDefault();
    const friend = $("ch-friend").value;
    const type = $("ch-type").value;
    const needs = TYPES[type].needs;
    const c = {
      users: [me(), friend],
      type,
      target: { km: needs.includes("km") ? Number($("ch-km").value) : undefined, minutes: needs.includes("minutes") ? Number($("ch-min").value) : undefined },
      days: Number($("ch-days").value),
      rated: $("ch-rated").checked,
    };
    if (c.rated) {
      const check = canCreateRated(challenges, friend, me());
      if (!check.ok) return ($("ch-warn").textContent = check.why + " Untick “Rated” for a friendly one.");
    }
    // warn above 130 % of the weaker runner's longest run (mine is known; theirs is not shared)
    const myBest = (await runs()).reduce((m, r) => Math.max(m, r.distanceM / 1000), 0);
    const warn = tooHard(c, myBest);
    if (warn && !$("ch-warn").dataset.confirmed) {
      $("ch-warn").textContent = warn + " Press Send again to keep it.";
      $("ch-warn").dataset.confirmed = "1";
      return;
    }
    delete $("ch-warn").dataset.confirmed;
    const friendCard = target?.uid === friend ? target : await cardOf(friend);
    await createChallenge(friend, friendCard, c);
    $("challenge-dialog").close();
  };

  // ── Runners at your level ───────────────────────────────────────────────
  async function renderLevel() {
    const r = (getRatingState() ?? (await loadRating().catch(() => null)))?.rating ?? getCard()?.rating ?? 500;
    $("level-rating").textContent = r;
    try {
      const { blocked } = await hiddenPeople();
      const list = (await runnersAtMyLevel(r)).filter((c) => !blocked.includes(c.uid));
      $("level-list").replaceChildren(
        ...(list.length
          ? list.map((c) => {
              const li = el("li", "lb-row");
              const n = el("strong", "link-name", `${c.avatar} ${c.displayName}`);
              n.onclick = () => (location.hash = `#/runner/${c.uid}`);
              li.append(n, el("span", "muted", `@${c.handle} · ${c.city ?? ""}`), el("span", "rank-chip", `${c.rank} · ${c.rating}`));
              return li;
            })
          : [el("li", "muted empty-line", "Nobody within ±150 points yet.")])
      );
    } catch (err) {
      console.warn(err);
      $("level-list").replaceChildren(el("li", "muted", "Could not load runners (index still building?)."));
    }
  }

  // ── Leaderboards ────────────────────────────────────────────────────────
  async function renderBoard() {
    const scope = $("lb-scope").value;
    const metric = $("lb-metric").value;
    const card = getCard();
    $("lb-optin").checked = card?.leaderboard === true;
    $("lb-optin-row").hidden = scope !== "city";
    let list = [];
    try {
      if (scope === "friends") list = await friendCards();
      if (scope === "following") list = await followingCards();
      if (scope === "team") list = await teamCards(getProfile()?.teamId);
      if (scope === "city") list = card?.leaderboard ? await cityCards(card.cityKey) : [];
    } catch (err) {
      console.warn(err);
    }
    const wk = weekKey(new Date());
    const val = (c) =>
      metric === "rating" ? c.rating ?? (c.rank ? -1 : 0) : metric === "weekKm" ? (c.weekKey === wk ? c.weekKm ?? 0 : 0) : c.challengesWon ?? 0;
    list.sort((a, b) => val(b) - val(a));
    const fmt = (c) =>
      metric === "rating" ? (c.rating != null ? `${c.rating}` : c.rank ?? "—") : metric === "weekKm" ? formatKm(val(c) * 1000) : `${val(c)} won`;
    const empty =
      scope === "city" && !card?.leaderboard ? "Opt in below to join your city's leaderboard." : scope === "team" && !getProfile()?.teamId ? "Join a team first." : "Nobody here yet.";
    $("lb-list").replaceChildren(
      ...(list.length
        ? list.map((c, i) => {
            const li = el("li", `lb-row${c.uid === me() ? " me" : ""}`);
            const n = el("strong", "link-name", `${c.avatar} ${c.displayName}`);
            n.onclick = () => (location.hash = `#/runner/${c.uid}`);
            li.append(el("span", "lb-pos", `#${i + 1}`), n, el("span", "rank-chip", c.rank ?? "Rookie"), el("span", "lb-val", fmt(c)));
            return li;
          })
        : [el("li", "muted empty-line", empty)])
    );
  }
  $("lb-scope").onchange = renderBoard;
  $("lb-metric").onchange = renderBoard;
  $("lb-optin").onchange = async () => {
    if (!getCard()?.city) {
      $("lb-optin").checked = false;
      return alert("Add your city to your public card first (Profile → Details).");
    }
    await setLeaderboardOptIn($("lb-optin").checked).catch(console.error);
    renderBoard();
  };

  for (const t of document.querySelectorAll('[data-tabs="ch"] [data-tab]')) {
    t.onclick = () => {
      for (const x of document.querySelectorAll('[data-tabs="ch"] [data-tab]')) x.setAttribute("aria-selected", String(x === t));
      for (const p of document.querySelectorAll('[data-panels="ch"] > [data-panel]')) p.hidden = p.dataset.panel !== t.dataset.tab;
    };
  }

  return {
    enter() {
      runsCache = null;
      render();
      renderLevel();
      renderBoard();
    },
    challenge: (uid, card) => openDialog(uid, card),
  };
}
