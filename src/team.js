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
  listPublicTeams,
  updateTeamListing,
  myRequest,
  requestToJoin,
  cancelRequest,
  watchRequests,
  approveRequest,
  declineRequest,
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
  let unsubscribeRequests = null;
  let directory = [];
  let filter = "all";
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

  const consent = (name) =>
    confirm(
      `Join "${name}"?\n\nTeam members will see your name, role, live status, current and last normal heart rate, a short heart-rate trend and your last session summary.`
    );

  async function enterTeam(code, name) {
    if (!consent(name)) return;
    await joinTeam(code);
    say(`You joined ${name}.`);
    onTeamChange?.();
    await render();
  }

  function button(text, className, action) {
    const b = el("button", `btn btn-sm ${className}`, text);
    b.type = "button";
    b.onclick = async () => {
      b.disabled = true;
      try {
        await action();
      } catch (err) {
        fail(err);
      } finally {
        b.disabled = false;
      }
    };
    return b;
  }

  function directoryCard(t) {
    const premium = t.tier === "premium";
    const card = el("article", `listing-card${premium ? " premium" : ""}`);
    const head = el("div", "member-head");
    head.append(el("div", "avatar", initials(t.name)));
    const who = el("div", "member-who");
    who.append(el("strong", null, t.name), el("span", "muted", `${premium ? "Coached by" : "By"} ${t.ownerName ?? ""}`));
    head.append(who, el("span", `badge ${premium ? "premium-badge" : "on-device"}`, premium ? "Premium" : "Free"));
    card.append(head);
    card.append(el("p", "listing-text", t.description || "No description."));
    if (premium && t.price) card.append(el("p", "listing-price", t.price));

    if (!premium || t.ownerUid === auth.currentUser.uid) {
      card.append(button("Join", "btn-primary", () => enterTeam(t.id, t.name)));
    } else if (t.request === "approved") {
      card.append(button("Approved: join now", "btn-primary", () => enterTeam(t.id, t.name)));
    } else if (t.request === "pending") {
      card.append(
        el("p", "hint", "Waiting for the coach to approve."),
        button("Cancel request", "btn-ghost", async () => {
          await cancelRequest(t.id);
          await loadDirectory();
        })
      );
    } else {
      card.append(
        button("Request to join", "btn-outline", async () => {
          if (!confirm(`Send your display name to the coach of "${t.name}"?`)) return;
          await requestToJoin(t.id);
          say("Request sent.");
          await loadDirectory();
        })
      );
    }
    return card;
  }

  function renderDirectory() {
    const shown = directory.filter((t) => filter === "all" || (t.tier ?? "free") === filter);
    $("team-directory").replaceChildren(
      ...(shown.length
        ? shown.map(directoryCard)
        : [el("p", "muted", "No published teams here yet. Create one and publish it from Directory settings.")])
    );
  }

  async function loadDirectory() {
    try {
      const teams = await listPublicTeams();
      directory = await Promise.all(
        teams.map(async (t) => ({ ...t, request: t.tier === "premium" ? await myRequest(t.id) : null }))
      );
      directory.sort((a, b) => a.name.localeCompare(b.name));
      renderDirectory();
    } catch (err) {
      fail(err);
    }
  }

  for (const chip of document.querySelectorAll("[data-filter]")) {
    chip.onclick = () => {
      filter = chip.dataset.filter;
      for (const c of document.querySelectorAll("[data-filter]")) c.setAttribute("aria-pressed", String(c === chip));
      renderDirectory();
    };
  }

  function renderRequests(requests) {
    $("team-requests").hidden = !requests.length;
    $("request-list").replaceChildren(
      ...requests.map((r) => {
        const li = el("li");
        li.append(
          el("span", null, r.displayName),
          button("Approve", "btn-primary", () => approveRequest(team.id, r.uid)),
          button("Decline", "btn-ghost", () => declineRequest(team.id, r.uid))
        );
        return li;
      })
    );
  }

  /** Owner tools: directory settings and applications. */
  function renderOwnerTools(code) {
    const owner = team.ownerUid === auth.currentUser.uid;
    $("team-listing").hidden = !owner;
    $("team-requests").hidden = true;
    if (!owner) return;
    $("listing-listed").checked = !!team.listed;
    $("listing-tier").value = team.tier ?? "free";
    $("listing-description").value = team.description ?? "";
    $("listing-price").value = team.price ?? "";
    unsubscribeRequests = watchRequests(code, renderRequests, fail);
  }

  $("listing-form").onsubmit = async (e) => {
    e.preventDefault();
    const settings = {
      listed: $("listing-listed").checked,
      tier: $("listing-tier").value,
      description: $("listing-description").value,
      price: $("listing-price").value,
    };
    if (settings.tier === "premium" && getProfile().role !== "coach") {
      return say("Premium teams need the Coach role. Change it on your Profile page.");
    }
    try {
      await updateTeamListing(team.id, settings);
      Object.assign(team, settings);
      say(settings.listed ? "Saved. Your team is in Discover." : "Saved. Your team is private.");
    } catch (err) {
      fail(err);
    }
  };

  async function render() {
    unsubscribe?.();
    unsubscribeRequests?.();
    unsubscribe = unsubscribeRequests = null;
    const code = getProfile()?.teamId;
    $("team-empty").hidden = !!code;
    $("team-view").hidden = !code;
    $("team-discover").hidden = !!code;
    if (!code) return loadDirectory();
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
      renderOwnerTools(code);
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
      if (found.tier === "premium" && found.ownerUid !== auth.currentUser.uid && (await myRequest(code)) !== "approved") {
        if (!confirm(`"${found.name}" is a premium team. Send your display name to the coach?`)) return say("");
        await requestToJoin(code);
        say("Request sent. You can join once the coach approves.");
        return loadDirectory();
      }
      say("");
      await enterTeam(code, found.name);
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
