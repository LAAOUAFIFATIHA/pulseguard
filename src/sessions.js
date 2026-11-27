// Groups saved 10 s windows into sessions. Pure logic (tested).
// A window: { sessionId?, startMs, seconds, avgHr, maxHr, alerts, label, ... }

const GAP_MS = 60_000; // older windows without a session id: a pause > 1 min starts a new session

export function groupSessions(windows) {
  const sorted = [...windows].sort((a, b) => a.startMs - b.startMs);
  const groups = [];
  let current = null;
  for (const w of sorted) {
    const key = w.sessionId ?? null;
    const lastEnd = current ? current.endMs : -Infinity;
    const sameGroup = current && (key ? current.key === key : current.key === null && w.startMs - lastEnd <= GAP_MS);
    if (!sameGroup) {
      current = { key, windows: [] };
      groups.push(current);
    }
    current.windows.push(w);
    current.endMs = Math.max(current.endMs ?? 0, w.startMs + w.seconds * 1000);
  }
  return groups.map(summarizeSession).reverse(); // newest first
}

function summarizeSession({ key, windows, endMs }) {
  const withHr = windows.filter((w) => w.avgHr != null);
  const seconds = windows.reduce((s, w) => s + w.seconds, 0);
  const hrSeconds = withHr.reduce((s, w) => s + w.seconds, 0);
  return {
    id: key ?? `t${windows[0].startMs}`,
    windows,
    startMs: windows[0].startMs,
    endMs,
    seconds,
    avgHr: hrSeconds ? withHr.reduce((s, w) => s + w.avgHr * w.seconds, 0) / hrSeconds : null,
    maxHr: withHr.length ? Math.max(...withHr.map((w) => w.maxHr ?? w.avgHr)) : null,
    alertWindows: windows.filter((w) => w.alerts?.length).length,
    labels: [...new Set(windows.map((w) => w.label))],
  };
}

/** "1 h 05 min", "12 min", "40 s" */
export function formatDuration(sec) {
  const s = Math.round(sec);
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min`;
}

export const clock = (sec) => {
  const s = Math.max(0, Math.floor(sec));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

/** Inline SVG sparkline for a list of numbers. */
export function sparkline(values, { width = 120, height = 32 } = {}) {
  const v = values.filter((x) => x != null);
  if (v.length < 2) return "";
  const lo = Math.min(...v) - 2;
  const hi = Math.max(...v) + 2;
  const pts = v
    .map((y, i) => `${((i / (v.length - 1)) * width).toFixed(1)},${(height - ((y - lo) / (hi - lo)) * height).toFixed(1)}`)
    .join(" ");
  return `<svg class="spark" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true"><polyline points="${pts}" /></svg>`;
}
