// Records and Badges tabs on profiles, plus unlock toasts after a run.
import {
  auth, getCard, listRuns, getRatingState, badgesOf, unlockBadges, recordsOf, saveRecords, setPinned, friendCount,
} from "./db.js";
import { BADGES, RARITY, stats, evaluate, newlyEarned, records } from "./achievements.js";
import { confetti } from "./ratingui.js";
import { formatKm } from "./run.js";

const $ = (id) => document.getElementById(id);
const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
};
const clock = (s) => (s == null ? "—" : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`);
export const BADGE_BY_ID = Object.fromEntries(BADGES.map((b) => [b.id, b]));

function toast(text) {
  const t = el("div", "toast", text);
  document.body.append(t);
  setTimeout(() => t.classList.add("show"), 10);
  setTimeout(() => (t.classList.remove("show"), setTimeout(() => t.remove(), 400)), 4500);
}

export function initBadges(profileTabs) {
  const me = () => auth.currentUser.uid;

  /** Computes my badges and records from my runs; unlocks new ones. */
  async function mine() {
    const runs = await listRuns(500).catch(() => []);
    const s = stats(runs, { challengesWon: getCard()?.challengesWon ?? 0, friends: await friendCount() });
    const unlocked = await badgesOf(me()).catch(() => ({}));
    const fresh = newlyEarned(s, unlocked);
    if (fresh.length) {
      await unlockBadges(fresh.map((id) => BADGE_BY_ID[id])).catch(console.warn);
      for (const id of fresh) unlocked[id] = Date.now();
      toast(`Badge unlocked: ${fresh.map((id) => `${BADGE_BY_ID[id].icon} ${BADGE_BY_ID[id].name}`).join(", ")}`);
      confetti();
    }
    const rec = records(runs, getRatingState()?.peak ?? null);
    if (runs.length) await saveRecords(rec).catch(console.warn);
    return { list: evaluate(s, unlocked), rec };
  }

  function renderRecords(container, rec) {
    if (!rec) return container.replaceChildren(el("p", "muted empty-line", "No records yet."));
    const rows = [
      ["Longest run", rec.longestM ? formatKm(rec.longestM) : "—"],
      ["Fastest 1 km", clock(rec.fastest1k)],
      ["Fastest 5 km", clock(rec.fastest5k)],
      ["Fastest 10 km", clock(rec.fastest10k)],
      ["Best endurance score", rec.bestEndurance || "—"],
      ["Longest streak", rec.longestStreak ? `${rec.longestStreak} day${rec.longestStreak > 1 ? "s" : ""}` : "—"],
      ["Most runs in a week", rec.mostRunsWeek || "—"],
      ["Hottest run", rec.hottestC != null ? `${rec.hottestC} °C` : "—"],
      ["Rating peak", rec.ratingPeak ?? "—"],
    ];
    const grid = el("div", "records-grid");
    for (const [k, v] of rows) {
      const c = el("div", "record");
      c.append(el("span", null, k), el("strong", null, String(v)));
      grid.append(c);
    }
    container.replaceChildren(grid, el("p", "hint", "Fastest times are estimated from the average pace of longer runs."));
  }

  function renderBadges(container, list, self) {
    const pinned = new Set(getCard()?.pinned ?? []);
    const grid = el("div", "badge-grid");
    for (const b of list) {
      if (!self && !b.earned) continue;
      const card = el("div", `badge-card${b.earned ? " earned" : ""}`);
      card.style.setProperty("--rarity", RARITY[b.rarity].color);
      card.append(el("div", "badge-icon", b.icon), el("strong", null, b.name), el("span", "badge-rarity", RARITY[b.rarity].label), el("p", "muted", b.desc));
      if (b.earned) {
        if (b.unlockedAt) card.append(el("span", "hint", `Unlocked ${new Date(b.unlockedAt).toLocaleDateString()}`));
        if (self) {
          const pin = el("button", "btn btn-ghost btn-sm", pinned.has(b.id) ? "Unpin" : "Pin");
          pin.type = "button";
          pin.onclick = async () => {
            const now = new Set(getCard()?.pinned ?? []);
            const next = now.has(b.id) ? [...now].filter((x) => x !== b.id) : [...now, b.id];
            if (next.length > 3) return toast("You can pin up to 3 badges.");
            await setPinned(next).catch(console.error);
            renderBadges(container, list, self);
          };
          card.append(pin);
        }
      } else {
        const bar = el("div", "progress badge-progress");
        const fill = el("span");
        fill.style.width = `${Math.round(b.progressValue * 100)}%`;
        bar.append(fill);
        card.append(bar, el("span", "hint", `${Math.round(b.progressValue * 100)} %`));
      }
      grid.append(card);
    }
    container.replaceChildren(grid.childNodes.length ? grid : el("p", "muted empty-line", "No badges yet."));
  }

  let cache = null;
  let pending = null;
  const mineOnce = () => (pending ??= mine().finally(() => setTimeout(() => (pending = null), 3000)));
  profileTabs.records = async (uid, self, container) => {
    container.replaceChildren(el("p", "muted", "Loading…"));
    try {
      if (self) {
        cache = await mineOnce();
        renderRecords(container, cache.rec);
      } else renderRecords(container, await recordsOf(uid));
    } catch {
      container.replaceChildren(el("p", "muted empty-line", "Records are visible to followers only."));
    }
  };
  profileTabs.badges = async (uid, self, container) => {
    container.replaceChildren(el("p", "muted", "Loading…"));
    try {
      if (self) renderBadges(container, (await mineOnce()).list, true);
      else {
        const unlocked = await badgesOf(uid);
        renderBadges(container, BADGES.filter((b) => unlocked[b.id]).map((b) => ({ ...b, earned: true, unlockedAt: unlocked[b.id] })), false);
      }
    } catch {
      container.replaceChildren(el("p", "muted empty-line", "Badges are visible to followers only."));
    }
  };

  window.addEventListener("run-finished", () => setTimeout(() => mine().catch(console.warn), 1500));
}
