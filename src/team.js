// Team page: create or join with an invite code, see teammates' shared
// summaries live, and publish your own status every 15 s while monitoring.
import {
  auth,
  getProfile,
  getTeam,
  createTeam,
  joinTeam,
  leaveTeam,
  watchMembers,
  removeMember,
  shareStatus,
  TEAM_CODE,
} from "./db.js";
import { timeAgo, initials, TREND_EVERY_SEC } from "./status.js";
import { sparkline, formatDuration } from "./sessions.js";

const $ = (id) => document.getElementById(id);
const STALE_MS = 2 * 60 * 1000;
const ROLE = { athlete: "Athlete", coach: "Coach" };

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
};

export function initTeam({ status, getSession, onTeamChange }) {
  let unsubscribe = null;
  let team = null;
  let lastShared = 0;
  let lastState = null;
  const say = (msg) => ($("team-status").textContent = msg);
  const fail = (err) => {
    console.error(err);
    say(err.code === "permission-denied" ? "Access refused. Check that your email is verified." : "Something went wrong. Try again.");
  };

  function memberCard(m) {
    const me = m.uid === auth.currentUser.uid;
    const updated = m.updatedAt?.toMillis?.() ?? 0;
    const stale = m.state !== "idle" && Date.now() - updated > STALE_MS;
    const state = stale ? "offline" : m.state === "idle" ? "offline" : m.state;

    const card = el("article", `member state-${state}`);
    const head = el("div", "member-head");
    head.append(el("div", "avatar", initials(m.displayName)));
    const who = el("div", "member-who");
    who.append(el("strong", null, m.displayName + (me ? " (you)" : "")), el("span", "muted", ROLE[m.role] ?? m.role));
    head.append(who);
    const pill = el("span", `pill ${state === "alert" ? "bad" : state === "normal" ? "ok" : "neutral"}`);
    pill.textContent = state === "alert" ? "Alert" : state === "normal" ? "Live · Normal" : "Offline";
    head.append(pill);
    card.append(head);

    const body = el("div", "member-body");
    const hr = el("div", "member-hr");
    hr.append(el("strong", null, state === "offline" || m.hr == null ? "--" : String(Math.round(m.hr))), el("span", "unit", "bpm"));
    body.append(hr);
    const spark = el("div", "member-spark");
    spark.innerHTML = sparkline(m.trend ?? []); // numbers only
    body.append(spark);
    card.append(body);

    if (state === "alert" && m.alert) card.append(el("p", "member-alert", m.alert));

    const facts = el("dl", "facts");
    const fact = (label, value) => facts.append(el("dt", null, label), el("dd", null, value));
    const normalAt = m.lastNormalAt?.toMillis?.();
    fact("Last normal", m.lastNormalHr == null ? "--" : `${Math.round(m.lastNormalHr)} bpm · ${timeAgo(normalAt)}`);
    const s = m.session;
    fact(
      "Last session",
      s ? `${formatDuration((s.minutes ?? 0) * 60)} · avg ${s.avgHr ?? "--"} · max ${s.maxHr ?? "--"} · ${s.alerts ?? 0} alert(s)` : "--"
    );
    fact("Updated", updated ? timeAgo(updated) : "--");
    card.append(facts);

    if (!me && team?.ownerUid === auth.currentUser.uid) {
      const remove = el("button", "btn btn-ghost btn-sm", "Remove from team");
      remove.type = "button";
      remove.onclick = async () => {
        if (!confirm(`Remove ${m.displayName} from the team?`)) return;
        await removeMember(team.id, m.uid).catch(fail);
      };
      card.append(remove);
    }
    return card;
  }

  function renderMembers(members) {
    members.sort((a, b) => (a.uid === auth.currentUser.uid ? -1 : b.uid === auth.currentUser.uid ? 1 : a.displayName.localeCompare(b.displayName)));
    $("team-members").replaceChildren(...members.map(memberCard));
    $("team-count").textContent = `${members.length} member${members.length > 1 ? "s" : ""}`;
    if (!members.some((m) => m.uid === auth.currentUser.uid)) say("You were removed from this team.");
  }

  async function render() {
    unsubscribe?.();
    unsubscribe = null;
    const code = getProfile()?.teamId;
    $("team-empty").hidden = !!code;
    $("team-view").hidden = !code;
    if (!code) return;
    try {
      team = await getTeam(code);
      if (!team) {
        $("team-title").textContent = "This team no longer exists";
        $("team-members").replaceChildren();
        return;
      }
      $("team-title").textContent = team.name;
      $("team-code-show").textContent = code;
      unsubscribe = watchMembers(code, renderMembers, fail);
    } catch (err) {
      fail(err);
    }
  }

  $("team-create").onsubmit = async (e) => {
    e.preventDefault();
    say("Creating…");
    try {
      await createTeam($("team-name").value);
      say("Team created. Share the invite code with your teammates.");
      onTeamChange?.();
      await render();
    } catch (err) {
      fail(err);
    }
  };

  $("team-join").onsubmit = async (e) => {
    e.preventDefault();
    const code = $("team-code").value.trim().toUpperCase();
    if (!TEAM_CODE.test(code)) return say("A code has 8 letters and digits, like ABCD2345.");
    try {
      const found = await getTeam(code);
      if (!found) return say("No team with that code.");
      const ok = confirm(
        `Join "${found.name}"?\n\nTeam members will see your name, role, live status, current and last normal heart rate, a short heart-rate trend and your last session summary.`
      );
      if (!ok) return say("");
      await joinTeam(code);
      say(`You joined ${found.name}.`);
      onTeamChange?.();
      await render();
    } catch (err) {
      fail(err);
    }
  };

  $("team-copy").onclick = async () => {
    try {
      await navigator.clipboard.writeText($("team-code-show").textContent);
      say("Invite code copied.");
    } catch {
      say("Copy failed: select the code and copy it.");
    }
  };

  $("team-leave").onclick = async () => {
    if (!confirm("Leave this team? Your teammates will no longer see your status.")) return;
    try {
      await leaveTeam();
      say("You left the team.");
      onTeamChange?.();
      await render();
    } catch (err) {
      fail(err);
    }
  };

  /** Called every second; writes at most every 15 s, or when the state changes. */
  function share() {
    if (!getProfile()?.teamId || !$("team-share").checked) return;
    const now = Date.now();
    const changed = status.state !== lastState;
    if (!changed && now - lastShared < TREND_EVERY_SEC * 1000) return;
    if (!changed && status.state === "idle") return; // nothing new while stopped
    lastShared = now;
    lastState = status.state;
    shareStatus(
      {
        state: status.state,
        hr: status.hr,
        alert: status.alert,
        lastNormalHr: status.lastNormalHr,
        lastNormalAt: status.lastNormalAt,
        trend: status.trend,
        session: getSession(),
      },
      fail
    );
  }

  $("team-share").onchange = () => {
    if (!$("team-share").checked) shareStatus({ state: "idle", hr: null, alert: null }, fail);
    lastState = null;
  };

  return { enter: render, share };
}
