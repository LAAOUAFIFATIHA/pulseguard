// Which teammates are in urgent alert, and which of those are new. Pure logic.
export const STALE_MS = 2 * 60 * 1000;

/** `seen` (a Set of uids) is updated in place. */
export function freshAlerts(members, seen, myUid, now) {
  const urgent = members.filter(
    (m) =>
      m.uid !== myUid &&
      m.urgent === true &&
      m.state === "alert" &&
      // a write still waiting for the server has no time yet
      now - (m.updatedAt?.toMillis?.() ?? now) < STALE_MS
  );
  const ids = new Set(urgent.map((m) => m.uid));
  const cleared = [...seen].filter((uid) => !ids.has(uid));
  cleared.forEach((uid) => seen.delete(uid));
  const fresh = urgent.filter((m) => !seen.has(m.uid));
  fresh.forEach((m) => seen.add(m.uid));
  return { urgent, fresh, cleared };
}
