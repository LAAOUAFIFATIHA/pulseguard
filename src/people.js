// Runner profiles (mine and others): header with counters, follow / friend /
// block / mute actions, and Posts · Records · Badges tabs.
import {
  auth, getCard, cardOf, relationTo, followUser, unfollowUser, cancelFollowRequest, blockUser, unblockUser,
  muteUser, unmuteUser, sendFriendRequest, removeConnection, acceptFriend, postsOf, networkCounts, visibleTo,
  likedByMe, watchFollowRequests, approveFollower, declineFollower, hiddenPeople, setPrivate,
} from "./db.js";
import { rankBadge } from "./ratingui.js";
import { RUNNER_LEVELS } from "./social.js";

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
    } finally {
      b.disabled = false;
    }
  };
  return b;
}

/** Hooks filled by other features (records and badges). */
export const profileTabs = { records: null, badges: null, challenge: null };

export function initPeople({ home }) {
  const me = () => auth.currentUser.uid;

  function header(card, uid, counts, relation, self, refresh) {
    const box = el("div", "pf-head");
    box.append(el("div", "avatar avatar-emoji avatar-xl", card?.avatar ?? "🏃"));
    const info = el("div", "pf-info");
    const title = el("div", "pf-title");
    title.append(el("h2", null, card?.displayName ?? "Runner"));
    if (card?.rank) {
      const badge = el("span", "pf-rank");
      badge.innerHTML = rankBadge(card.rating ?? { Rookie: 500, Pacer: 1500, Racer: 2500, Master: 3500, "Grand Master": 4500, Legend: 5500 }[card.rank], 30);
      badge.append(el("span", null, card.rating != null ? `${card.rank} · ${card.rating}` : card.rank));
      title.append(badge);
    }
    if (card?.private) title.append(el("span", "tag", "Private"));
    info.append(title, el("p", "muted", `@${card?.handle ?? ""}`));

    const limited = card?.private && !self && !relation?.following;
    if (!limited) {
      const meta = [card?.city, RUNNER_LEVELS[card?.runnerLevel]].filter(Boolean).join(" · ");
      if (meta) info.append(el("p", "pf-meta", meta));
      if (card?.bio) info.append(el("p", "pf-bio", card.bio));
    } else {
      info.append(el("p", "pf-meta", "This account is private. Follow it to see its runs."));
    }

    const stats = el("div", "pf-counts");
    const stat = (n, label) => {
      const s = el("div", "pf-count");
      s.append(el("strong", null, n == null ? "—" : String(n)), el("span", null, label));
      stats.append(s);
    };
    stat(counts.runs, "runs");
    stat(counts.followers, "followers");
    stat(counts.following, "following");
    if (self) stat(counts.friends, "friends");
    info.append(stats);

    if (!self && relation) {
      const acts = el("div", "actions pf-actions");
      if (relation.blocked) {
        acts.append(button("Unblock", "btn-outline", async () => (await unblockUser(uid), refresh())));
      } else {
        if (relation.following) acts.append(button("Following ✓", "btn-outline", async () => (await unfollowUser(uid), refresh())));
        else if (relation.requested) acts.append(button("Requested", "btn-outline", async () => (await cancelFollowRequest(uid), refresh())));
        else acts.append(button(card?.private ? "Request to follow" : "Follow", "btn-primary", async () => (await followUser(uid, card), refresh())));

        if (relation.friend) acts.append(el("span", "pill ok", "Friends"));
        else if (relation.conn?.requester === me()) acts.append(el("span", "pill neutral", "Friend request sent"));
        else if (relation.conn) acts.append(button("Accept friend", "btn-outline", async () => (await acceptFriend(relation.conn), refresh())));
        else if (card?.discoverable !== false) acts.append(button("Add friend", "btn-outline", async () => (await sendFriendRequest(uid), refresh())));

        if (relation.friend && profileTabs.challenge) acts.append(button("Challenge", "btn-outline", () => profileTabs.challenge(uid, card)));
        acts.append(
          button(relation.muted ? "Unmute" : "Mute", "btn-ghost", async () => (await (relation.muted ? unmuteUser(uid) : muteUser(uid)), refresh())),
          button("Block", "btn-ghost", async () => {
            if (!confirm(`Block ${card?.displayName ?? "this runner"}? They will not be able to follow you, comment, invite you or see your profile.`)) return;
            await blockUser(uid);
            refresh();
          })
        );
      }
      info.append(acts);
    }
    if (self) {
      const acts = el("div", "actions pf-actions");
      const edit = el("a", "btn btn-outline btn-sm", "Edit profile");
      edit.href = "#/profile";
      edit.onclick = () => showTab("profile", "details");
      acts.append(edit);
      info.append(acts);
    }
    box.append(info);
    return box;
  }

  async function postsPanel(container, uid, visibilities) {
    container.replaceChildren(el("p", "muted", "Loading…"));
    try {
      const posts = await postsOf(uid, visibilities);
      const liked = await Promise.all(posts.map((p) => likedByMe(p.id)));
      container.replaceChildren(...(posts.length ? posts.map((p, i) => home.renderPost(p, liked[i])) : [el("p", "muted empty-line", "No runs to show yet.")]));
    } catch (err) {
      console.error(err);
      container.replaceChildren(el("p", "muted", "Could not load the runs."));
    }
  }

  /** Renders a profile (header + tabs) into a page. */
  async function renderProfile(prefix, uid) {
    const self = uid === me();
    const card = self ? getCard() : await cardOf(uid);
    const headBox = $(`${prefix}-header`);
    if (!card) {
      headBox.replaceChildren(el("p", "muted", self ? "Create your public card below to get a profile." : "This profile is not available."));
      $(`${prefix}-posts`).replaceChildren();
      return;
    }
    const relation = self ? null : await relationTo(uid);
    const vis = visibleTo(relation ?? {}, self);
    const counts = await networkCounts(uid, vis);
    const refresh = () => renderProfile(prefix, uid);
    headBox.replaceChildren(header(card, uid, counts, relation, self, refresh));
    const hidden = card.private && !self && !relation?.following;
    if (hidden || relation?.blocked) {
      $(`${prefix}-posts`).replaceChildren(el("p", "muted empty-line", relation?.blocked ? "You blocked this runner." : "Private account."));
    } else {
      postsPanel($(`${prefix}-posts`), uid, vis);
    }
    profileTabs.records?.(uid, self, $(`${prefix}-records`));
    profileTabs.badges?.(uid, self, $(`${prefix}-badges`), card);
  }

  // ── Tabs ────────────────────────────────────────────────────────────────
  function showTab(page, name) {
    for (const t of document.querySelectorAll(`[data-tabs="${page}"] [data-tab]`)) t.setAttribute("aria-selected", String(t.dataset.tab === name));
    for (const p of document.querySelectorAll(`[data-panels="${page}"] > [data-panel]`)) p.hidden = p.dataset.panel !== name;
  }
  for (const bar of document.querySelectorAll("[data-tabs]")) {
    for (const t of bar.querySelectorAll("[data-tab]")) t.onclick = () => showTab(bar.dataset.tabs, t.dataset.tab);
  }

  // ── Follow requests (Friends page) ──────────────────────────────────────
  watchFollowRequests(
    (list) => {
      $("follow-requests-card").hidden = !list.length;
      $("follow-requests").replaceChildren(
        ...list.map((r) => {
          const li = el("li");
          li.append(
            el("span", null, `${r.avatar ?? ""} ${r.name} @${r.handle} wants to follow you`),
            button("Approve", "btn-primary", () => approveFollower(r.uid)),
            button("Decline", "btn-ghost", () => declineFollower(r.uid))
          );
          return li;
        })
      );
    },
    () => {}
  );

  // ── Settings: account privacy, blocked and muted ────────────────────────
  async function renderSettings() {
    const c = getCard();
    $("privacy-account").value = c?.private ? "private" : "public";
    $("privacy-account").disabled = !c;
    const { blocked, muted } = await hiddenPeople();
    const rows = [];
    for (const [list, label, undo] of [[blocked, "Blocked", unblockUser], [muted, "Muted", unmuteUser]]) {
      for (const uid of list) {
        const other = await cardOf(uid);
        const li = el("li");
        li.append(
          el("span", null, `${label}: ${other?.displayName ?? "a runner"} ${other?.handle ? "@" + other.handle : ""}`),
          button(label === "Blocked" ? "Unblock" : "Unmute", "btn-ghost", async () => (await undo(uid), renderSettings()))
        );
        rows.push(li);
      }
    }
    $("hidden-people").replaceChildren(...(rows.length ? rows : [el("li", "muted", "Nobody blocked or muted.")]));
  }
  $("privacy-account").onchange = async () => {
    const priv = $("privacy-account").value === "private";
    if (priv && !confirm("Make your account private? Your public runs become followers-only, and new followers need your approval.")) {
      $("privacy-account").value = "public";
      return;
    }
    await setPrivate(priv).catch(console.error);
  };

  return {
    enterRunner: (uid) => {
      showTab("runner", "posts");
      renderProfile("rn", uid);
    },
    enterProfile: () => renderProfile("pf", me()),
    renderSettings,
    showTab,
  };
}
