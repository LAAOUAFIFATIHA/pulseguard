// Distance and pace helpers. Pure logic.

/** "6:19 /km" for a speed in km/h, "--" when standing still. */
export function formatPace(speedKmh) {
  if (!speedKmh || speedKmh < 1) return "--";
  const secPerKm = Math.round(3600 / speedKmh);
  return `${Math.floor(secPerKm / 60)}:${String(secPerKm % 60).padStart(2, "0")} /km`;
}

/** "0.84 km", "12.3 km". */
export function formatKm(meters) {
  const km = (meters ?? 0) / 1000;
  return km < 10 ? `${km.toFixed(2)} km` : `${km.toFixed(1)} km`;
}

/** Totals of a session from its 10 s summaries. */
export function runTotals(windows) {
  const seconds = windows.reduce((s, w) => s + (w.seconds ?? 0), 0);
  const distanceM = windows.reduce((s, w) => s + (w.distanceM ?? 0), 0);
  const moving = windows.filter((w) => (w.distanceM ?? 0) > 0).reduce((s, w) => s + w.seconds, 0);
  return {
    seconds,
    distanceM: Math.round(distanceM),
    avgSpeedKmh: moving ? (distanceM / moving) * 3.6 : 0,
  };
}
