// Home: feed of shared runs (public, friends, mine) and the Share-a-run dialog.
import { auth, getCard, sharePost, openFeed, setLike, likedByMe, deletePost } from "./db.js";
import { downsample } from "./feed.js";
import { formatKm, formatPace, runTotals } from "./run.js";
import { formatDuration } from "./sessions.js";
import { timeAgo } from "./status.js";

const $ = (id) => document.getElementById(id);
const VISIBILITY = {
  public: ["i-globe", "Everyone"],
  friends: ["i-friends", "Friends"],
  private: ["i-lock", "Only me"],
};

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
};
const icon = (id) => {
  const span = el("span", "ico");
  span.innerHTML = `<svg aria-hidden="true"><use href="#${id}" /></svg>`;
  return span;
};

let chartSeq = 0;
/** Heart-rate area chart, built from numbers only. */
export function hrChart(trend) {
  const v = trend.filter((x) => typeof x === "number");
  if (v.length < 2) return "";
  const w = 300;
  const h = 70;
  const lo = Math.min(...v) - 5;
  const hi = Math.max(...v) + 5;
  const pts = v.map((y, i) => [(i / (v.length - 1)) * w, h - ((y - lo) / (hi - lo)) * (h - 6) - 3]);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join("");
  const id = `hrg${++chartSeq}`;
  return `<svg class="post-chart" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="Heart rate from ${Math.round(Math.min(...v))} to ${Math.round(Math.max(...v))} bpm">
    <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" style="stop-color: var(--p-coral); stop-opacity: 0.45" />
      <stop offset="100%" style="stop-color: var(--p-coral); stop-opacity: 0" />
    </linearGradient></defs>
    <path d="${line}L${w},${h}L0,${h}Z" fill="url(#${id})" />
    <path d="${line}" class="line" />
  </svg>`;
}

function statsRow(stats) {
  const row = el("div", "post-stats");
  const item = (ico, value, label) => {
    const box = el("div", "stat");
    box.append(icon(ico), el("strong", null, value), el("span", null, label));
    row.append(box);
  };
  const speed = stats.distanceM && stats.seconds ? (stats.distanceM / stats.seconds) * 3.6 : 0;
  item("i-route", formatKm(stats.distanceM), "distance");
  item("i-timer", formatDuration(stats.seconds), "time");
  item("i-live", formatPace(speed), "pace");
  item("i-heart-o", stats.avgHr ? `${Math.round(stats.avgHr)} bpm` : "--", stats.maxHr ? `avg · max ${Math.round(stats.maxHr)}` : "avg");
  return row;
}

export function initHome() {
  let feed = null;
  let loading = false;
  let sharing = null;
  const say = (msg) => ($("feed-status").textContent = msg);

  function postCard(p, liked) {
    const mine = p.ownerUid === auth.currentUser.uid;
    const card = el("article", "post");

    const head = el("header", "post-head");
    head.append(el("div", "avatar avatar-emoji", p.author?.avatar ?? "🏃"));
    const who = el("div", "post-who");
    who.append(el("strong", null, p.author?.name ?? "Runner"));
    const meta = el("span", "muted");
    const [visIcon, visLabel] = VISIBILITY[p.visibility] ?? VISIBILITY.public;
    meta.append(`@${p.author?.handle ?? ""} · ${timeAgo(p.createdAtMs)} · `, icon(visIcon), ` ${visLabel}`);
    who.append(meta);
    head.append(who);
    if (p.author?.handle?.startsWith("demo_")) head.append(el("span", "tag", "Demo"));
    if (mine) {
      const del = el("button", "icon-btn sm");
      del.type = "button";
      del.setAttribute("aria-label", "Delete this post");
      del.innerHTML = '<svg aria-hidden="true"><use href="#i-trash" /></svg>';
      del.onclick = async () => {
        if (!confirm("Delete this post?")) return;
        await deletePost(p.id).then(() => card.remove()).catch(() => say("Could not delete the post."));
      };
      head.append(del);
    }
    card.append(head);

    if (p.caption) card.append(el("p", "post-caption", p.caption));
    card.append(statsRow(p.stats));
    const chart = el("div", "post-graph");
    chart.innerHTML = hrChart(p.trend ?? []); // numbers only
    if (p.stats.alerts) {
      const a = el("span", "post-alerts");
      a.append(icon("i-alert"), ` ${p.stats.alerts} alert block${p.stats.alerts > 1 ? "s" : ""}`);
      chart.append(a);
    }
    card.append(chart);

    const foot = el("footer", "post-foot");
    let isLiked = liked;
    let count = p.likeCount ?? 0;
    const like = el("button", "like-btn");
    like.type = "button";
    const paint = () => {
      like.setAttribute("aria-pressed", String(isLiked));
      like.innerHTML = `<svg aria-hidden="true"><use href="#i-heart-o" /></svg><span>${count}</span>`;
      like.setAttribute("aria-label", `${isLiked ? "Unlike" : "Like"} (${count} likes)`);
    };
    paint();
    like.onclick = async () => {
      like.disabled = true;
      try {
        await setLike(p.id, !isLiked);
        isLiked = !isLiked;
        count += isLiked ? 1 : -1;
        paint();
      } catch {
        say("Could not save your like.");
      } finally {
        like.disabled = false;
      }
    };
    foot.append(like, el("span", "sim", "Simulated sensor data"));
    card.append(foot);
    return card;
  }

  async function loadMore() {
    if (!feed || loading) return;
    loading = true;
    $("feed-more").disabled = true;
    try {
      const page = await feed.next();
      const liked = await Promise.all(page.map((p) => likedByMe(p.id)));
      $("feed").append(...page.map((p, i) => postCard(p, liked[i])));
      const empty = !$("feed").children.length;
      $("feed-empty").hidden = !empty;
      $("feed-more").hidden = feed.done;
      say("");
    } catch (err) {
      console.error(err);
      say("Could not load the feed. Check your connection.");
    } finally {
      loading = false;
      $("feed-more").disabled = false;
    }
  }

  async function enter() {
    $("feed").replaceChildren();
    $("feed-empty").hidden = true;
    $("feed-more").hidden = true;
    say("Loading…");
    try {
      feed = await openFeed();
      await loadMore();
    } catch (err) {
      console.error(err);
      say("Could not load the feed.");
    }
  }
  $("feed-more").onclick = loadMore;

  // ── Share a run ─────────────────────────────────────────────────────────
  function openShare(session) {
    if (!getCard()) {
      if (confirm("Create your public card first: posts show your name and @handle. Go to your profile?")) location.hash = "#/profile";
      return;
    }
    const totals = runTotals(session.windows);
    const temps = session.windows.map((w) => w.avgTempC).filter((x) => x != null);
    sharing = {
      distanceM: totals.distanceM,
      seconds: Math.max(1, Math.round(totals.seconds)),
      avgHr: session.avgHr == null ? null : Math.round(session.avgHr),
      maxHr: session.maxHr == null ? null : Math.round(session.maxHr),
      alerts: session.alertWindows,
      avgTempC: temps.length ? Math.round((temps.reduce((a, b) => a + b, 0) / temps.length) * 10) / 10 : null,
      trend: downsample(session.windows.map((w) => w.avgHr), 60),
    };
    const preview = $("share-preview");
    preview.replaceChildren(statsRow(sharing));
    const g = el("div", "post-graph");
    g.innerHTML = hrChart(sharing.trend);
    preview.append(g);
    $("share-caption").value = "";
    $("share-status").textContent = "";
    $("share-dialog").showModal();
  }

  $("share-cancel").onclick = () => $("share-dialog").close();
  $("share-form").onsubmit = async (e) => {
    e.preventDefault();
    const { trend, ...stats } = sharing;
    $("share-submit").disabled = true;
    $("share-status").textContent = "Sharing…";
    try {
      await sharePost({ caption: $("share-caption").value, visibility: $("share-visibility").value, stats, trend });
      $("share-status").textContent = "";
      $("share-dialog").close();
      if (location.hash === "#/home") enter();
      else location.hash = "#/home";
    } catch (err) {
      console.error(err);
      $("share-status").textContent = "Could not share. Check your connection and your public card.";
    } finally {
      $("share-submit").disabled = false;
    }
  };

  return { enter, openShare };
}
