// Friends page, public card editor, privacy setting and group-run invites.
import {
  auth,
  getProfile,
  getCard,
  loadCard,
  saveCard,
  handleOwner,
  searchCards,
  cardOf,
  watchConnections,
  sendFriendRequest,
  acceptFriend,
  removeConnection,
  sendRunInvite,
  sentInvite,
  watchRunInvites,
  answerRunInvite,
  joinTeam,
  leaveTeam,
} from "./db.js";
import { normalizeHandle, sortConnections, otherUid, isExpired, AVATARS, RUNNER_LEVELS } from "./social.js";

const $ = (id) => document.getElementById(id);
const me = () => auth.currentUser.uid;

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
    } finally {
      b.disabled = false;
    }
  };
  return b;
}

/** A person row: avatar, name, @handle, city and level, bio, then actions. */
export function personRow(c, actions = []) {
  const row = el("article", "person");
  row.append(el("div", "avatar avatar-emoji", c?.avatar ?? "🏃"));
  const text = el("div", "person-text");
  const name = el("strong", null, c?.displayName ?? "Hidden runner");
  text.append(name, el("span", "muted", c?.handle ? `@${c.handle}` : ""));
  const meta = [c?.city, RUNNER_LEVELS[c?.runnerLevel]].filter(Boolean).join(" · ");
  if (meta) text.append(el("span", "person-meta", meta));
  if (c?.bio) text.append(el("p", "person-bio", c.bio));
  row.append(text);
  const box = el("div", "person-actions");
  box.append(...actions);
  row.append(box);
  return row;
}

export function initFriends({ onTeamChange }) {
  let byOther = new Map(); // other uid -> connection
  let sorted = { incoming: [], outgoing: [], friends: [] };
  const cards = new Map(); // uid -> card
  let invites = [];
  let lastResults = [];
  let unsubConn = null;
  let unsubInvites = null;

  const say = (msg) => ($("friends-status").textContent = msg);
  const fail = (err) => {
    console.error(err);
    say(err?.code === "permission-denied" ? "Not allowed. The other runner may have changed their privacy." : "Something went wrong. Try again.");
  };

  async function cardFor(uid) {
    if (!cards.has(uid)) cards.set(uid, await cardOf(uid));
    return cards.get(uid);
  }

  // ── Public card form (Profile page) ─────────────────────────────────────
  const picker = $("card-avatar");
  for (const a of AVATARS) {
    const b = el("button", "emoji-pick", a);
    b.type = "button";
    b.setAttribute("aria-pressed", "false");
    b.setAttribute("aria-label", `Avatar ${a}`);
    b.onclick = () => selectAvatar(a);
    picker.append(b);
  }
  let avatar = AVATARS[0];
  function selectAvatar(a) {
    avatar = a;
    for (const b of picker.children) b.setAttribute("aria-pressed", String(b.textContent === a));
  }

  function fillCardForm() {
    const c = getCard();
    $("card-name").value = c?.displayName ?? getProfile()?.displayName ?? "";
    $("card-handle").value = c?.handle ?? "";
    $("card-bio").value = c?.bio ?? "";
    $("card-city").value = c?.city ?? "";
    $("card-level").value = c?.runnerLevel ?? "casual";
    selectAvatar(c?.avatar ?? AVATARS[0]);
    $("privacy-find").value = c && !c.discoverable ? "nobody" : "everyone";
    $("privacy-find").disabled = !c;
    $("privacy-hint").textContent = c ? "" : "Create your public card on the Profile page first.";
    $("card-status").textContent = c ? `Your card: @${c.handle}` : "You have no public card yet. Friends cannot find you.";
  }

  $("card-handle").onchange = async () => {
    const h = normalizeHandle($("card-handle").value);
    if (!h) return ($("card-status").textContent = "3 to 20 characters: lowercase letters, digits and _.");
    const owner = await handleOwner(h).catch(() => null);
    $("card-status").textContent = owner && owner !== me() ? `@${h} is taken.` : `@${h} is available.`;
  };

  const cardInput = (overrides = {}) => ({
    displayName: $("card-name").value,
    handle: normalizeHandle($("card-handle").value),
    avatar,
    bio: $("card-bio").value,
    city: $("card-city").value,
    runnerLevel: $("card-level").value,
    discoverable: getCard() ? getCard().discoverable : true,
    ...overrides,
  });

  $("card-form").onsubmit = async (e) => {
    e.preventDefault();
    const input = cardInput();
    if (!input.handle) return ($("card-status").textContent = "Choose a handle: 3 to 20 lowercase letters, digits or _.");
    $("card-status").textContent = "Saving…";
    try {
      await saveCard(input);
      fillCardForm();
      $("card-status").textContent = `Saved. Friends can find you as @${input.handle}.`;
      enter();
    } catch (err) {
      console.error(err);
      $("card-status").textContent =
        err.code === "permission-denied" ? `@${input.handle} is taken, or a field is not valid.` : "Not saved. Check your connection.";
    }
  };

  $("privacy-find").onchange = async () => {
    if (!getCard()) return;
    const discoverable = $("privacy-find").value === "everyone";
    try {
      await saveCard({ ...getCard(), discoverable });
      $("privacy-hint").textContent = discoverable ? "Runners can find you by name or handle." : "Nobody can find you in search. Existing friends keep seeing your card.";
    } catch (err) {
      fail(err);
    }
  };

  // ── Lists ───────────────────────────────────────────────────────────────
  function actionsFor(uid) {
    const conn = byOther.get(uid);
    if (!conn) return [button("Add friend", "btn-primary", () => sendFriendRequest(uid).then(() => say("Request sent.")).catch(fail))];
    if (conn.status === "accepted") return [el("span", "pill ok", "Friends")];
    if (conn.requester === me()) return [el("span", "pill neutral", "Requested"), button("Cancel", "btn-ghost", () => removeConnection(conn).catch(fail))];
    return [button("Accept", "btn-primary", () => acceptFriend(conn).catch(fail)), button("Decline", "btn-ghost", () => removeConnection(conn).catch(fail))];
  }

  async function renderList(container, conns, emptyText) {
    if (!conns.length) return container.replaceChildren(el("p", "muted", emptyText));
    const rows = await Promise.all(
      conns.map(async (c) => {
        const other = otherUid(c, me());
        const extra =
          c.status === "accepted"
            ? [button("Remove", "btn-ghost", async () => {
                if (confirm("Remove this friend?")) await removeConnection(c).catch(fail);
              })]
            : actionsFor(other);
        return personRow(await cardFor(other), extra);
      })
    );
    container.replaceChildren(...rows);
  }

  function renderSearch() {
    $("search-results").replaceChildren(...lastResults.map((c) => personRow(c, actionsFor(c.uid))));
  }

  function renderBadge() {
    const n = sorted.incoming.length + invites.filter((i) => i.status === "pending" && !isExpired(i)).length;
    $("friends-badge").textContent = n ? String(n) : "";
  }

  async function onConnections(list) {
    byOther = new Map(list.map((c) => [otherUid(c, me()), c]));
    sorted = sortConnections(list, me());
    $("friend-count").textContent = sorted.friends.length ? `(${sorted.friends.length})` : "";
    renderBadge();
    renderSearch();
    await Promise.all([
      renderList($("incoming-list"), sorted.incoming, "No requests."),
      renderList($("outgoing-list"), sorted.outgoing, "No sent requests."),
      renderList($("friend-list"), sorted.friends, "No friends yet. Search for runners above."),
    ]);
  }

  function onInvites(list) {
    invites = list;
    renderBadge();
    const open = list.filter((i) => i.status === "pending" && !isExpired(i));
    $("run-invites-card").hidden = !open.length;
    $("run-invite-list").replaceChildren(
      ...open.map((inv) => {
        const li = el("li");
        const mins = Math.max(1, Math.round((inv.expiresAtMs - Date.now()) / 60000));
        li.append(
          el("span", null, `${inv.fromName} invites you to a group run with ${inv.teamName} (expires in ${mins} min)`),
          button("Join", "btn-primary", () => joinFromInvite(inv)),
          button("Decline", "btn-ghost", () => answerRunInvite(inv, "declined").catch(fail))
        );
        return li;
      })
    );
  }

  async function joinFromInvite(inv) {
    const current = getProfile()?.teamId;
    const leaving = current && current !== inv.teamCode;
    const ok = confirm(
      `Join the group run with ${inv.teamName}?\n\n` +
        (leaving ? "You will leave your current team.\n\n" : "") +
        "Team members will see your name, live status, heart rate and session summary. Your location is shared only if you switch on Group run."
    );
    if (!ok) return;
    try {
      await answerRunInvite(inv, "accepted");
      if (leaving) await leaveTeam();
      if (current !== inv.teamCode) await joinTeam(inv.teamCode);
      onTeamChange?.();
      location.hash = "#/team";
    } catch (err) {
      fail(err);
    }
  }

  $("friend-search").onsubmit = async (e) => {
    e.preventDefault();
    say("Searching…");
    try {
      lastResults = await searchCards($("friend-query").value);
      renderSearch();
      say(lastResults.length ? "" : "No runner found. Try at least 2 letters, or @handle.");
    } catch (err) {
      fail(err);
    }
  };

  // ── Team page: invite friends ───────────────────────────────────────────
  async function renderTeamInvites() {
    const box = $("team-invite-list");
    const card = $("team-invite");
    card.hidden = !getProfile()?.teamId;
    if (card.hidden) return;
    if (!sorted.friends.length) return box.replaceChildren(el("p", "muted", "Add friends on the Friends page to invite them."));
    const rows = await Promise.all(
      sorted.friends.map(async (c) => {
        const other = otherUid(c, me());
        const sent = await sentInvite(other);
        const live = sent && !isExpired(sent);
        const state =
          live && sent.status === "pending"
            ? el("span", "pill neutral", "Invited")
            : live && sent.status === "accepted"
              ? el("span", "pill ok", "Accepted")
              : null;
        const invite = button(live ? "Invite again" : "Invite", "btn-outline", async () => {
          try {
            await sendRunInvite(other);
            $("team-status").textContent = "Invite sent. It expires in 2 hours.";
            renderTeamInvites();
          } catch (err) {
            fail(err);
            $("team-status").textContent = "Invite not sent.";
          }
        });
        return personRow(await cardFor(other), [state, invite].filter(Boolean));
      })
    );
    box.replaceChildren(...rows);
  }

  async function start() {
    await loadCard().catch(() => null);
    fillCardForm();
    if (!getCard()) {
      $("friends-nocard").hidden = false;
      $("friends-main").hidden = true;
    }
    unsubConn?.();
    unsubInvites?.();
    unsubConn = watchConnections(onConnections, (err) => console.warn("Friends stopped", err.code));
    unsubInvites = watchRunInvites(onInvites, (err) => console.warn("Invites stopped", err.code));
  }

  function enter() {
    const hasCard = !!getCard();
    $("friends-nocard").hidden = hasCard;
    $("friends-main").hidden = !hasCard;
    if (hasCard && !unsubConn) start();
  }

  start();
  return { enter, enterProfile: fillCardForm, renderTeamInvites };
}
