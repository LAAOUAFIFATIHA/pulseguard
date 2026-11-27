// Friends: handles, connection ids, request sorting, search and run invites.
// Pure logic (no Firebase), shared by the app and the tests.

export const HANDLE = /^[a-z0-9_]{3,20}$/;
export const INVITE_HOURS = 2;
export const SEARCH_LIMIT = 10;

export const AVATARS = ["🏃", "🏃‍♀️", "⚡", "🔥", "🌙", "☀️", "🦊", "🐆", "🦅", "💪", "❤️", "🌿"];
export const RUNNER_LEVELS = {
  starting: "Just starting",
  casual: "Casual runner",
  regular: "Regular runner",
  competitive: "Competitive runner",
};

/** "  Fatiha_R " -> "fatiha_r"; "@x" accepted. Returns "" when invalid. */
export function normalizeHandle(input = "") {
  const h = input.trim().replace(/^@/, "").toLowerCase();
  return HANDLE.test(h) ? h : "";
}

export const searchName = (displayName = "") => displayName.trim().toLowerCase();

/** Same id for both people, whatever the order. */
export const connectionId = (a, b) => (a < b ? `${a}_${b}` : `${b}_${a}`);

export const otherUid = (conn, me) => conn.users.find((u) => u !== me);

/** Splits my connections into incoming / outgoing requests and friends. */
export function sortConnections(connections, me) {
  const out = { incoming: [], outgoing: [], friends: [] };
  for (const c of connections) {
    if (c.status === "accepted") out.friends.push(c);
    else if (c.requester === me) out.outgoing.push(c);
    else out.incoming.push(c);
  }
  return out;
}

/** Text to search for, or "" when too short. A leading @ means handle only. */
export function parseQuery(raw = "") {
  const text = raw.trim().toLowerCase();
  const handleOnly = text.startsWith("@");
  const q = text.replace(/^@/, "");
  return { q: q.length >= 2 ? q : "", handleOnly };
}

/** Upper bound for a Firestore prefix range query. */
export const prefixEnd = (q) => q + "";

/** Merges name and handle results, removes duplicates and myself. */
export function mergeResults(lists, me, limit = SEARCH_LIMIT) {
  const seen = new Set([me]);
  const out = [];
  for (const card of lists.flat()) {
    if (seen.has(card.uid)) continue;
    seen.add(card.uid);
    out.push(card);
  }
  return out.slice(0, limit);
}

/** One invite per friend per team. */
export const inviteId = (teamCode, toUid) => `${teamCode}_${toUid}`;

export const isExpired = (invite, now = Date.now()) => now >= invite.expiresAtMs;
