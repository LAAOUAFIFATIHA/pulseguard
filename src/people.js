// Runner profiles in an Instagram-like layout (mine and others): ringed
// avatar with counters, name and bio, action buttons, pinned badges as
// highlights, icon tabs and a 3-column grid of runs.
import {
  auth, getCard, cardOf, relationTo, followUser, unfollowUser, cancelFollowRequest, blockUser, unblockUser,
  muteUser, unmuteUser, sendFriendRequest, acceptFriend, postsOf, networkCounts, visibleTo,
  likedByMe, loadCard, watchFollowRequests, approveFollower, declineFollower, hiddenPeople, setPrivate, networkList,
} from "./db.js";
import { rankBadge } from "./ratingui.js";
import { RUNNER_LEVELS } from "./social.js";
import { BADGES, RARITY } from "./achievements.js";
import { formatKm, formatPace } from "./run.js";

const $ = (id) => document.getElementById(id);
const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
};
const icon = (name) => {
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  const u = document.createElementNS("http://www.w3.org/2000/svg", "use");
  u.setAttribute("href", `#${name}`);
  s.append(u);
  return s;
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
const RANK_RATING = { Rookie: 500, Pacer: 1500, Racer: 2500, Master: 3500, "Grand Master": 4500, Legend: 5500 };

/** Hooks filled by other features (records, badges, challenge). */
export const profileTabs = { records: null, badges: null, challenge: null };

export function initPeople({ home }) {
  const me = () => auth.currentUser.uid;

  // ── Header ──────────────────────────────────────────────────────────────
  function header(card, uid, counts, relation, self, refresh) {
    const box = el("div", "ig-head");

    const top = el("div", "ig-handle");
    top.append(el("strong", null, card.handle ?? ""));
    if (card.private) top.append(icon("i-lock"));
    box.append(top);

    const row = el("div", "ig-row");
    const ring = el("div", "ig-ring");
    ring.append(el("div", "ig-avatar", card.avatar ?? "🏃"));
    row.append(ring);
    const stats = el("div", "ig-stats");
    const limited = card.private && !self && !relation?.following;
    const stat = (n, label, list) => {
      const s = el(list && !limited ? "button" : "div", "ig-stat");
      if (list && !limited) {
        s.type = "button";
        s.onclick = () => showPeople(uid, list, label);
      }
      s.append(el("strong", null, n == null ? "—" : String(n)), el("span", null, label));
      stats.append(s);
    };
    stat(counts.runs, "runs");
    stat(counts.followers, "followers", "followers");
    stat(counts.following, "following", "following");
    row.append(stats);
    box.append(row);

    const who = el("div", "ig-bio");
    const name = el("div", "ig-name");
    name.append(el("strong", null, card.displayName ?? "Runner"));
    if (card.rank) {
      const rank = el("span", "ig-rank");
      rank.innerHTML = rankBadge(card.rating ?? RANK_RATING[card.rank] ?? 500, 20);
      rank.append(el("span", null, card.rating != null ? `${card.rank} · ${card.rating}` : card.rank));
      name.append(rank);
    }
    who.append(name);
    if (!limited) {
      const meta = [card.city, RUNNER_LEVELS[card.runnerLevel]].filter(Boolean).join(" · ");
      if (meta) who.append(el("span", "ig-meta", meta));
      if (card.bio) who.append(el("p", null, card.bio));
      if (self && counts.friends != null) who.append(el("span", "ig-meta", `${counts.friends} friend${counts.friends === 1 ? "" : "s"}`));
    }
    if (relation?.followsMe && !self) who.append(el("span", "ig-meta", "Follows you"));
    box.append(who);

    // buttons
    const acts = el("div", "ig-actions");
    if (self) {
      acts.append(
        button("Edit profile", "btn-soft", async () => showTab("profile", "details")),
        button("Share profile", "btn-soft", async () => {
          const url = `${location.origin}${location.pathname}#/runner/${uid}`;
          await navigator.clipboard?.writeText(url).catch(() => {});
          alert("Profile link copied.");
        })
      );
    } else if (relation?.blocked) {
      acts.append(button("Unblock", "btn-soft", async () => (await unblockUser(uid), refresh())));
    } else if (relation) {
      if (relation.following) acts.append(button("Following ✓", "btn-soft", async () => (await unfollowUser(uid), refresh())));
      else if (relation.requested) acts.append(button("Requested", "btn-soft", async () => (await cancelFollowRequest(uid), refresh())));
      else acts.append(button(relation.followsMe ? "Follow back" : "Follow", "btn-primary", async () => (await followUser(uid, card), refresh())));

      if (relation.friend) {
        if (profileTabs.challenge) acts.append(button("Challenge", "btn-soft", async () => profileTabs.challenge(uid, { ...card, uid })));
        else acts.append(el("span", "btn btn-sm btn-soft ig-static", "Friends ✓"));
      } else if (relation.conn?.requester === me()) acts.append(el("span", "btn btn-sm btn-soft ig-static", "Friend request sent"));
      else if (relation.conn) acts.append(button("Accept friend", "btn-soft", async () => (await acceptFriend(relation.conn), refresh())));
      else if (card.discoverable !== false) acts.append(button("Add friend", "btn-soft", async () => (await sendFriendRequest(uid), refresh())));

      // ⋯ menu: mute and block
      const more = el("details", "ig-more");
      const sum = el("summary", "btn btn-sm btn-soft", "⋯");
      sum.setAttribute("aria-label", "More");
      const menu = el("div", "ig-menu");
      menu.append(
        button(relation.muted ? "Unmute" : "Mute", "btn-ghost", async () => (await (relation.muted ? unmuteUser(uid) : muteUser(uid)), refresh())),
        button("Block", "btn-ghost danger-text", async () => {
          if (!confirm(`Block ${card.displayName ?? "this runner"}? They will not be able to follow you, comment, invite you or see your profile.`)) return;
          await blockUser(uid);
          refresh();
        })
      );
      more.append(sum, menu);
      acts.append(more);
    }
    box.append(acts);

    // pinned badges as story highlights
    const pins = (card.pinned ?? []).map((id) => BADGES.find((b) => b.id === id)).filter(Boolean);
    if (pins.length) {
      const hl = el("div", "ig-highlights");
      for (const b of pins) {
        const h = el("button", "ig-highlight");
        h.type = "button";
        h.onclick = () => showTab(self ? "profile" : "runner", "badges");
        const c = el("span", "ig-hl-circle", b.icon);
        c.style.setProperty("--rarity", RARITY[b.rarity].color);
        h.append(c, el("span", "ig-hl-label", b.name));
        hl.append(h);
      }
      box.append(hl);
    }
    return box;
  }

  // ── Followers / following list ──────────────────────────────────────────
  async function showPeople(uid, coll, title) {
    const dlg = $("people-dialog");
    $("people-title").textContent = title[0].toUpperCase() + title.slice(1);
    $("people-list").replaceChildren(el("li", "muted", "Loading…"));
    dlg.showModal();
    try {
      const ids = await networkList(uid, coll);
      const cards = await Promise.all(ids.map(async (id) => [id, id === me() ? getCard() : await cardOf(id).catch(() => null)]));
      const rows = cards.filter(([, c]) => c).map(([id, c]) => {
        const li = el("li", "ig-person");
        li.append(el("span", "ig-person-av", c.avatar ?? "🏃"));
        const t = el("div");
        t.append(el("strong", null, c.handle ?? ""), el("span", "muted", c.displayName ?? ""));
        li.append(t);
        li.onclick = () => {
          dlg.close();
          location.hash = id === me() ? "#/profile" : `#/runner/${id}`;
        };
        return li;
      });
      $("people-list").replaceChildren(...(rows.length ? rows : [el("li", "muted", "Nobody yet.")]));
    } catch {
      $("people-list").replaceChildren(el("li", "muted", "This list is private."));
    }
  }
  $("people-close").onclick = () => $("people-dialog").close();

  // ── Grid of runs ────────────────────────────────────────────────────────
  function spark(trend) {
    const t = (trend ?? []).filter((x) => x != null);
    if (t.length < 2) return "";
    const lo = Math.min(...t) - 5;
    const hi = Math.max(...t) + 5;
    const pts = t.map((v, i) => `${((i / (t.length - 1)) * 100).toFixed(1)},${(100 - ((v - lo) / (hi - lo)) * 100).toFixed(1)}`).join(" ");
    return `<svg viewBox="0 0 100 100" preserveAspectRatio="none" class="ig-spark" aria-hidden="true"><polygon points="0,100 ${pts} 100,100" class="fill"/><polyline points="${pts}" class="line"/></svg>`;
  }
  function tile(p, liked) {
    const t = el("button", "ig-tile");
    t.type = "button";
    t.innerHTML = spark(p.trend);
    const s = p.stats ?? {};
    const info = el("div", "ig-tile-info");
    info.append(el("strong", null, formatKm(s.distanceM)));
    if (s.seconds && s.distanceM) info.append(el("span", null, formatPace((s.distanceM / 1000 / s.seconds) * 3600)));
    t.append(info);
    const over = el("div", "ig-tile-over");
    over.append(el("span", null, `♥ ${p.likeCount ?? 0}`));
    if (s.avgHr) over.append(el("span", null, `${s.avgHr} bpm`));
    t.append(over);
    if (p.visibility && p.visibility !== "public") t.append(el("span", "ig-tile-vis", p.visibility === "followers" ? "Followers" : p.visibility === "friends" ? "Friends" : "Only me"));
    t.onclick = () => {
      $("post-view").replaceChildren(home.renderPost(p, liked));
      $("post-dialog").showModal();
    };
    return t;
  }
  $("post-close").onclick = () => $("post-dialog").close();

  async function postsPanel(container, uid, visibilities) {
    container.replaceChildren(el("p", "muted", "Loading…"));
    try {
      const posts = await postsOf(uid, visibilities);
      const liked = await Promise.all(posts.map((p) => likedByMe(p.id)));
      if (!posts.length) {
        const empty = el("div", "ig-empty");
        empty.append(icon("i-route"), el("strong", null, "No runs yet"), el("p", "muted", uid === me() ? "Finish a run, then share it from the result card or History." : "Shared runs will show here."));
        return container.replaceChildren(empty);
      }
      const grid = el("div", "ig-grid");
      posts.forEach((p, i) => grid.append(tile(p, liked[i])));
      container.replaceChildren(grid);
    } catch (err) {
      console.error(err);
      container.replaceChildren(el("p", "muted", "Could not load the runs."));
    }
  }

  function lockedPanel(container, text) {
    const box = el("div", "ig-empty");
    box.append(icon("i-lock"), el("strong", null, text), el("p", "muted", "Follow this account to see their runs, records and badges."));
    container.replaceChildren(box);
  }

  /** Renders a profile (header + tabs) into a page. */
  async function renderProfile(prefix, uid) {
    const self = uid === me();
    // my card may still be loading right after sign-in
    const card = self ? getCard() ?? (await loadCard().catch(() => null)) : await cardOf(uid).catch(() => null);
    const headBox = $(`${prefix}-header`);
    if (!card) {
      const box = el("div", "ig-empty");
      box.append(icon("i-profile"), el("strong", null, self ? "Create your public card" : "This profile is not available"));
      if (self) {
        box.append(el("p", "muted", "Pick a @handle and an avatar so other runners can find and follow you."));
        box.append(button("Create my card", "btn-primary", async () => showTab("profile", "details")));
        showTab("profile", "details");
      }
      headBox.replaceChildren(box);
      $(`${prefix}-posts`).replaceChildren();
      return;
    }
    const relation = self ? null : await relationTo(uid);
    const vis = visibleTo(relation ?? {}, self);
    const counts = await networkCounts(uid, vis);
    const refresh = () => renderProfile(prefix, uid);
    headBox.replaceChildren(header(card, uid, counts, relation, self, refresh));
    const hidden = card.private && !self && !relation?.following;
    if (relation?.blocked) {
      for (const k of ["posts", "records", "badges"]) lockedPanel($(`${prefix}-${k}`), "You blocked this runner");
      return;
    }
    if (hidden) {
      for (const k of ["posts", "records", "badges"]) lockedPanel($(`${prefix}-${k}`), "This account is private");
      return;
    }
    postsPanel($(`${prefix}-posts`), uid, vis);
    profileTabs.records?.(uid, self, $(`${prefix}-records`));
    profileTabs.badges?.(uid, self, $(`${prefix}-badges`), card);
  }

  // ── Tabs ────────────────────────────────────────────────────────────────
  const TAB_ICON = { posts: "i-grid", records: "i-trophy", badges: "i-medal", details: "i-settings" };
  function showTab(page, name) {
    for (const t of document.querySelectorAll(`[data-tabs="${page}"] [data-tab]`)) t.setAttribute("aria-selected", String(t.dataset.tab === name));
    for (const p of document.querySelectorAll(`[data-panels="${page}"] > [data-panel]`)) p.hidden = p.dataset.panel !== name;
  }
  for (const bar of document.querySelectorAll('[data-tabs="profile"], [data-tabs="runner"]')) {
    bar.classList.add("ig-tabs");
    for (const t of bar.querySelectorAll("[data-tab]")) if (TAB_ICON[t.dataset.tab] && !t.querySelector("svg")) t.prepend(icon(TAB_ICON[t.dataset.tab]));
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
        const other = await cardOf(uid).catch(() => null);
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
      if (uid === me()) return (location.hash = "#/profile");
      showTab("runner", "posts");
      renderProfile("rn", uid);
    },
    enterProfile: () => {
      if (document.querySelector('[data-tabs="profile"] [aria-selected="true"]')?.dataset.tab !== "details") showTab("profile", "posts");
      renderProfile("pf", me());
    },
    renderSettings,
    showTab,
  };
}
