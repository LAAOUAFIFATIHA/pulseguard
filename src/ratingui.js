// Rating page, rank badge, result card after a run, rank-up celebration.
import { getRatingState, loadRating, applyDecay, listRatingEvents, getCard, syncCardRating } from "./db.js";
import { rankOf, RANKS } from "./rating.js";

const $ = (id) => document.getElementById(id);
const COLORS = ["var(--p-coral)", "var(--p-redwood)", "var(--p-cordovan)", "var(--p-wine)", "var(--p-cosmos)", "var(--p-teal)"];

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
};

/** SVG shield for a rank, with 10 division pips. Numbers only, safe as HTML. */
export function rankBadge(rating, size = 56) {
  const r = rankOf(rating ?? 500);
  const filled = r.division ? 11 - r.division : 10;
  const pips = Array.from({ length: 10 }, (_, i) => {
    const a = Math.PI * (0.15 + (0.7 * i) / 9);
    const x = 28 - 21 * Math.cos(a);
    const y = 30 + 21 * Math.sin(a);
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.1" fill="${i < filled ? "#fff" : "rgba(255,255,255,.3)"}"/>`;
  }).join("");
  const letter = r.name === "Grand Master" ? "GM" : r.name[0];
  return `<svg class="rank-badge" style="width:${size}px;height:${size}px" viewBox="0 0 56 56" role="img" aria-label="${r.label}">
    <path d="M28 3 51 11v18c0 13-10 21-23 25C15 50 5 42 5 29V11z" style="fill:${COLORS[r.idx]}"/>
    <path d="M28 7 47 13.5v15.5c0 10.8-8.2 17.7-19 21.2C17.2 46.7 9 39.8 9 29V13.5z" fill="none" stroke="rgba(255,255,255,.45)" stroke-width="1.2"/>
    <text x="28" y="30" text-anchor="middle" font-size="${letter.length > 1 ? 13 : 17}" font-weight="800" fill="#fff" font-family="Inter,system-ui,sans-serif">${letter}</text>
    ${pips}
  </svg>`;
}

/** Small inline rank chip used next to names. */
export function rankChip(card) {
  if (!card?.rank) return null;
  const chip = el("span", "rank-chip");
  const idx = Math.max(0, RANKS.indexOf(card.rank));
  chip.style.setProperty("--rank", COLORS[idx]);
  chip.textContent = card.rating != null ? `${rankOf(card.rating).label} · ${card.rating}` : card.rank;
  return chip;
}

function chart(events) {
  const pts = [...events].reverse().map((e) => [e.atMs, e.after]);
  if (pts.length < 2) return "";
  const w = 600;
  const h = 160;
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const [x0, x1] = [Math.min(...xs), Math.max(...xs) || 1];
  const lo = Math.min(...ys) - 20;
  const hi = Math.max(...ys) + 20;
  const X = (x) => 8 + ((x - x0) / (x1 - x0 || 1)) * (w - 16);
  const Y = (y) => h - 8 - ((y - lo) / (hi - lo)) * (h - 16);
  const d = pts.map(([x, y], i) => `${i ? "L" : "M"}${X(x).toFixed(1)},${Y(y).toFixed(1)}`).join("");
  return `<svg viewBox="0 0 ${w} ${h}" class="rating-chart" role="img" aria-label="Rating from ${ys[0]} to ${ys.at(-1)}">
    <path d="${d}L${X(x1)},${h}L${X(x0)},${h}Z" class="area"/><path d="${d}" class="line"/>
    ${pts.map(([x, y]) => `<circle cx="${X(x).toFixed(1)}" cy="${Y(y).toFixed(1)}" r="3"/>`).join("")}
  </svg>`;
}

export function confetti() {
  const canvas = $("confetti");
  const ctx = canvas.getContext("2d");
  canvas.width = innerWidth;
  canvas.height = innerHeight;
  canvas.hidden = false;
  const colors = ["#d77a7d", "#b23a48", "#8c2f39", "#2db6a3", "#ffffff"];
  const parts = Array.from({ length: 140 }, () => ({
    x: innerWidth / 2, y: innerHeight / 3, vx: (Math.random() - 0.5) * 14, vy: Math.random() * -12 - 2,
    s: 4 + Math.random() * 5, c: colors[Math.floor(Math.random() * colors.length)], r: Math.random() * 6,
  }));
  let frame = 0;
  const step = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const p of parts) {
      p.vy += 0.35;
      p.x += p.vx;
      p.y += p.vy;
      p.r += 0.1;
      ctx.fillStyle = p.c;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.r);
      ctx.fillRect(-p.s / 2, -p.s / 2, p.s, p.s * 0.6);
      ctx.restore();
    }
    if (++frame < 120) requestAnimationFrame(step);
    else canvas.hidden = true;
  };
  if (!matchMedia("(prefers-reduced-motion: reduce)").matches) requestAnimationFrame(step);
}

export function initRating() {
  function renderBadges() {
    const s = getRatingState();
    if (!s) return;
    $("side-rank").innerHTML = rankBadge(s.rating, 26);
    $("side-rank").title = rankOf(s.rating).label;
  }

  async function enter() {
    const s = getRatingState() ?? (await loadRating());
    const r = rankOf(s.rating);
    $("rating-badge").innerHTML = rankBadge(s.rating, 96);
    $("rating-label").textContent = r.label;
    $("rating-number").textContent = s.rating;
    $("rating-peak").textContent = s.peak;
    $("rating-runs").textContent = s.runsRated;
    const inDivision = r.division ? 100 - r.toNextDivision : 100;
    $("rating-progress").style.width = `${inDivision}%`;
    $("rating-next").textContent = r.toNextRank != null ? `${r.toNextDivision} points to the next division · ${r.toNextRank} points to ${r.nextRank}` : "Top rank reached";
    $("show-rating").checked = getCard()?.showRating !== false;
    $("show-rating").disabled = !getCard();
    try {
      const events = await listRatingEvents(50);
      $("rating-chart").innerHTML = chart(events);
      $("rating-changes").replaceChildren(
        ...(events.length
          ? events.slice(0, 10).map((e) => {
              const li = el("li");
              li.append(
                el("strong", e.delta > 0 ? "up" : e.delta < 0 ? "down" : "flat", `${e.delta > 0 ? "+" : ""}${e.delta}`),
                el("span", null, e.reasons.join(", ") || e.kind),
                el("time", "muted", new Date(e.atMs).toLocaleDateString())
              );
              return li;
            })
          : [el("li", "muted", "Finish a run of at least 5 minutes to get your first rating change.")])
      );
    } catch (err) {
      console.error(err);
    }
  }

  $("show-rating").onchange = async () => {
    await syncCardRating({ showRating: $("show-rating").checked }).catch(console.error);
  };

  /** Result card after a finished run. */
  function showResult(res, run) {
    const before = rankOf(res.before);
    const after = rankOf(res.after);
    $("result-delta").textContent = `${res.delta > 0 ? "+" : ""}${res.delta} rating`;
    $("result-delta").className = res.delta > 0 ? "result-delta up" : "result-delta";
    $("result-rank").innerHTML = rankBadge(res.after, 64);
    $("result-label").textContent = `${after.label} · ${res.after}`;
    $("result-reasons").replaceChildren(...res.reasons.map((r) => el("li", null, r)));
    $("result-rest").hidden = !run.urgent;
    const promoted = after.idx > before.idx;
    $("result-title").textContent = promoted ? `Promoted to ${after.name}!` : "Run saved";
    $("result-dialog").showModal();
    if (promoted) confetti();
    renderBadges();
  }
  $("result-close").onclick = () => $("result-dialog").close();

  async function start() {
    await loadRating();
    await applyDecay();
    renderBadges();
    if (getCard()) await syncCardRating().catch(() => {});
  }

  start().catch((err) => console.warn("Rating not loaded", err.code ?? err));
  return { enter, showResult, renderBadges };
}
