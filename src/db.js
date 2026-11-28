// Firebase Auth + Firestore for the signed-in user.
//
//   users/{uid}                      profile, consent, team code
//   users/{uid}/windows/{id}         10 s summaries (never raw signals)
//   users/{uid}/events/{id}          anomaly events
//   teams/{code}                     team name and owner
//   teams/{code}/members/{uid}       what a member shares with the team
//   profiles/{uid}                   public card (no health data)
//   handles/{handle}                 reserved @handle -> uid
//   connections/{uidA_uidB}          friend request or friendship
//   users/{uid}/friends/{friendUid}  accepted friends (mirrored)
//   runInvites/{teamCode_toUid}      group-run invite between friends
//   posts/{id}, posts/{id}/likes/{uid} shared runs and likes
//
// firestore.rules enforces ownership, team membership, verified email and
// field validation.
import {
  getAuth,
  connectAuthEmulator,
  deleteUser,
  signOut,
  EmailAuthProvider,
  GoogleAuthProvider,
  reauthenticateWithCredential,
  reauthenticateWithPopup,
} from "firebase/auth";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  connectFirestoreEmulator,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  deleteDoc,
  writeBatch,
  serverTimestamp,
  waitForPendingWrites,
  terminate,
  clearIndexedDbPersistence,
  onSnapshot,
  updateDoc,
  where,
  Timestamp,
  query,
  orderBy,
  limit,
  startAfter,
  getCountFromServer,
  increment,
} from "firebase/firestore";
import { app } from "./firebase.js";
import { createFeedMerger, PAGE } from "./feed.js";
import { rateRun, applyDelta, decayed, ineligible, START } from "./rating.js";
import { weekKey } from "./runsummary.js";
import { searchName, parseQuery, prefixEnd, mergeResults, connectionId, otherUid, inviteId, SEARCH_LIMIT } from "./social.js";

export const auth = getAuth(app);
const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});

// Local testing only: `VITE_USE_EMULATORS=1 npm run dev`
if (import.meta.env.DEV && import.meta.env.VITE_USE_EMULATORS === "1") {
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFirestoreEmulator(db, "127.0.0.1", 8085);
}

const uid = () => auth.currentUser.uid;
const userRef = () => doc(db, "users", uid());
const sub = (name) => collection(db, "users", uid(), name);
const teamRef = (code) => doc(db, "teams", code);
const memberRef = (code, id = uid()) => doc(db, "teams", code, "members", id);

// ── Profile ───────────────────────────────────────────────────────────────
let profile = null;
export const getProfile = () => profile;

export async function loadProfile() {
  const snap = await getDoc(userRef());
  profile = snap.exists() ? snap.data() : null;
  return profile;
}

const FIELDS = ["displayName", "age", "restingHr", "role", "sex", "runner", "heightCm", "weightKg", "teamId"];
const NUMBER_FIELDS = new Set(["age", "restingHr", "heightCm", "weightKg"]);

/** Keeps only the allowed, non-empty fields; whole numbers. */
function clean(input) {
  const out = {};
  for (const key of FIELDS) {
    const value = input[key];
    if (value === undefined || value === null || value === "") continue;
    out[key] = NUMBER_FIELDS.has(key) ? Math.round(Number(value)) : String(value).trim();
  }
  return out;
}

/**
 * `input` replaces the editable profile. The team code is kept unless
 * `input.teamId` is given ("" removes it). The consent date never changes.
 */
export async function saveProfile(input) {
  const next = {
    ...clean({ teamId: profile?.teamId, ...input }),
    consentAt: profile?.consentAt ?? Timestamp.now(),
    updatedAt: serverTimestamp(),
  };
  const write = setDoc(userRef(), next);
  profile = next;
  await write;
}

/** Changes only the team code, keeping the rest of the profile. */
async function setTeamId(teamId) {
  const current = Object.fromEntries(FIELDS.map((k) => [k, profile?.[k]]));
  await saveProfile({ ...current, teamId });
}

// ── Measurements ──────────────────────────────────────────────────────────
export function saveWindow(summary, startMs, onError) {
  setDoc(doc(sub("windows")), { ...summary, startAt: Timestamp.fromMillis(startMs) }).catch(onError);
}

export const newEventId = () => doc(sub("events")).id;

export function saveEvent(id, { type, severity, startAt, endAt, peakHr }, onError) {
  setDoc(doc(sub("events"), id), {
    type,
    severity,
    startAt: Timestamp.fromMillis(startAt),
    endAt: endAt == null ? null : Timestamp.fromMillis(endAt),
    peakHr: peakHr == null ? null : Math.round(peakHr),
  }).catch(onError);
}

/** Newest first. */
export async function loadWindows(max = 600) {
  const snap = await getDocs(query(sub("windows"), orderBy("startAt", "desc"), limit(max)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function recentEvents(max = 200) {
  const snap = await getDocs(query(sub("events"), orderBy("startAt", "desc"), limit(max)));
  return snap.docs.map((d) => d.data());
}

// ── Teams ─────────────────────────────────────────────────────────────────
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
export const TEAM_CODE = /^[A-HJ-NP-Z2-9]{8}$/;

function newCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

export async function getTeam(code) {
  const snap = await getDoc(teamRef(code));
  return snap.exists() ? { id: code, ...snap.data() } : null;
}

const requestRef = (code, id = uid()) => doc(db, "teams", code, "requests", id);

/** Teams their owners published. */
export async function listPublicTeams(max = 30) {
  const snap = await getDocs(query(collection(db, "teams"), where("listed", "==", true), limit(max)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/** Directory settings, owner only. */
export const updateTeamListing = (code, { listed, tier, description, price }) =>
  updateDoc(teamRef(code), {
    listed,
    tier,
    description: description.trim(),
    price: tier === "premium" ? price.trim() : "",
    ownerName: profile.displayName,
  });

/** "pending", "approved" or null for the signed-in user. */
export async function myRequest(code) {
  const snap = await getDoc(requestRef(code));
  return snap.exists() ? snap.data().status : null;
}
export const requestToJoin = (code) =>
  setDoc(requestRef(code), { displayName: profile.displayName, status: "pending", createdAt: serverTimestamp() });
export const cancelRequest = (code) => deleteDoc(requestRef(code));

export function watchRequests(code, onChange, onError) {
  return onSnapshot(
    collection(db, "teams", code, "requests"),
    (snap) => onChange(snap.docs.map((d) => ({ uid: d.id, ...d.data() })).filter((r) => r.status === "pending")),
    onError
  );
}
export const approveRequest = (code, id) => updateDoc(requestRef(code, id), { status: "approved" });
export const declineRequest = (code, id) => deleteDoc(requestRef(code, id));

function memberCard() {
  return {
    displayName: profile.displayName,
    role: profile.role,
    joinedAt: Timestamp.now(),
    updatedAt: serverTimestamp(),
    state: "idle",
  };
}

export async function createTeam(name) {
  const code = newCode();
  await setDoc(teamRef(code), { name: name.trim(), ownerUid: uid(), createdAt: serverTimestamp() });
  await setDoc(memberRef(code), memberCard());
  await setTeamId(code);
  return code;
}

export async function joinTeam(code) {
  await setDoc(memberRef(code), memberCard());
  await setTeamId(code);
  await deleteDoc(requestRef(code)).catch(() => {}); // an approved application is used up
}

export async function leaveTeam() {
  const code = profile?.teamId;
  if (!code) return;
  await deleteDoc(memberRef(code)).catch(() => {}); // the team may be gone already
  await setTeamId("");
}

const ts = (ms) => (ms == null ? null : Timestamp.fromMillis(ms));

/** Partial update of what this user shares (times in ms). */
export function shareStatus(data, onError) {
  if (!profile?.teamId) return;
  const out = { ...data, displayName: profile.displayName, role: profile.role, updatedAt: serverTimestamp() };
  if ("lastNormalAt" in data) out.lastNormalAt = ts(data.lastNormalAt);
  if (data.location) out.location = { ...data.location, at: ts(data.location.at) };
  if (data.session) out.session = { ...data.session, startAt: ts(data.session.startAt) };
  setDoc(memberRef(profile.teamId), out, { merge: true }).catch(onError);
}

export function watchMembers(code, onChange, onError) {
  return onSnapshot(
    collection(db, "teams", code, "members"),
    (snap) => onChange(snap.docs.map((d) => ({ uid: d.id, ...d.data() }))),
    onError
  );
}

export const removeMember = (code, memberUid) => deleteDoc(memberRef(code, memberUid));

// ── Friends: public card, search, connections, run invites ──────────────
const profileRef = (id = uid()) => doc(db, "profiles", id);
const handleRef = (h) => doc(db, "handles", h);
const connRef = (id) => doc(db, "connections", id);
const friendRef = (owner, friend) => doc(db, "users", owner, "friends", friend);
const inviteRef = (id) => doc(db, "runInvites", id);

let card = null;
const CARD_EXTRAS = ["rating", "rank", "showRating", "pinned", "private", "weekKm", "weekKey", "challengesWon", "leaderboard", "cityKey"];
export const getCard = () => card;

export async function loadCard() {
  const snap = await getDoc(profileRef());
  card = snap.exists() ? snap.data() : null;
  return card;
}

/** uid that owns a handle, or null when it is free. */
export async function handleOwner(handle) {
  const snap = await getDoc(handleRef(handle));
  return snap.exists() ? snap.data().uid : null;
}

/** Creates or updates the public card; a new handle is reserved in the same write. */
export async function saveCard(input) {
  const next = {
    displayName: input.displayName.trim(),
    searchName: searchName(input.displayName),
    handle: input.handle,
    avatar: input.avatar,
    bio: (input.bio ?? "").trim(),
    city: (input.city ?? "").trim(),
    runnerLevel: input.runnerLevel,
    discoverable: !!input.discoverable,
    updatedAt: serverTimestamp(),
  };
  for (const key of CARD_EXTRAS) {
    const value = key in input ? input[key] : card?.[key];
    if (value !== undefined && value !== null) next[key] = value;
  }
  const batch = writeBatch(db);
  batch.set(profileRef(), next);
  if (card?.handle !== next.handle) {
    batch.set(handleRef(next.handle), { uid: uid() });
    if (card?.handle) batch.delete(handleRef(card.handle));
  }
  await batch.commit();
  card = next;
}

/** Findable cards whose name or handle starts with the text. */
export async function searchCards(text) {
  const { q, handleOnly } = parseQuery(text);
  if (!q) return [];
  const fields = handleOnly ? ["handle"] : ["searchName", "handle"];
  const lists = await Promise.all(
    fields.map(async (field) => {
      const snap = await getDocs(
        query(
          collection(db, "profiles"),
          where("discoverable", "==", true),
          where(field, ">=", q),
          where(field, "<=", prefixEnd(q)),
          orderBy(field),
          limit(SEARCH_LIMIT)
        )
      );
      return snap.docs.map((d) => ({ uid: d.id, ...d.data() }));
    })
  );
  return mergeResults(lists, uid());
}

/** Someone else's card, or null when hidden from me. */
export async function cardOf(id) {
  try {
    const snap = await getDoc(profileRef(id));
    return snap.exists() ? { uid: id, ...snap.data() } : null;
  } catch {
    return null;
  }
}

export function watchConnections(onChange, onError) {
  return onSnapshot(
    query(collection(db, "connections"), where("users", "array-contains", uid())),
    (snap) => onChange(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    onError
  );
}

export const sendFriendRequest = (other) =>
  setDoc(connRef(connectionId(uid(), other)), {
    users: [uid(), other].sort(),
    requester: uid(),
    status: "pending",
    createdAt: serverTimestamp(),
  });

export async function acceptFriend(conn) {
  const other = otherUid(conn, uid());
  const batch = writeBatch(db);
  batch.update(connRef(conn.id), { status: "accepted", acceptedAt: serverTimestamp() });
  batch.set(friendRef(uid(), other), { since: serverTimestamp() });
  batch.set(friendRef(other, uid()), { since: serverTimestamp() });
  await batch.commit();
}

/** Cancel, decline or remove a friend. */
export async function removeConnection(conn) {
  const other = otherUid(conn, uid());
  const batch = writeBatch(db);
  batch.delete(connRef(conn.id));
  if (conn.status === "accepted") {
    batch.delete(friendRef(uid(), other));
    batch.delete(friendRef(other, uid()));
  }
  await batch.commit();
}

const INVITE_MS = 115 * 60 * 1000; // a little under the 2 h allowed, for clock drift

/** Invite a friend to my current team; replaces an old answered or expired invite. */
export async function sendRunInvite(toUid) {
  const code = profile?.teamId;
  if (!code) throw new Error("Join or create a team first.");
  const ref = inviteRef(inviteId(code, toUid));
  const old = await getDoc(ref).catch(() => null);
  if (old?.exists()) await deleteDoc(ref);
  const team = await getTeam(code);
  await setDoc(ref, {
    from: uid(),
    fromName: card?.displayName ?? profile.displayName,
    to: toUid,
    teamCode: code,
    teamName: team?.name ?? "Team",
    status: "pending",
    createdAt: serverTimestamp(),
    expiresAt: Timestamp.fromMillis(Date.now() + INVITE_MS),
  });
}

/** The invite I sent to this friend for my team, or null. */
export async function sentInvite(toUid) {
  const code = profile?.teamId;
  if (!code) return null;
  const snap = await getDoc(inviteRef(inviteId(code, toUid))).catch(() => null);
  return snap?.exists() ? { ...snap.data(), expiresAtMs: snap.data().expiresAt.toMillis() } : null;
}

export function watchRunInvites(onChange, onError) {
  return onSnapshot(
    query(collection(db, "runInvites"), where("to", "==", uid())),
    (snap) =>
      onChange(snap.docs.map((d) => ({ id: d.id, ...d.data(), expiresAtMs: d.data().expiresAt?.toMillis?.() ?? 0 }))),
    onError
  );
}

export const answerRunInvite = (invite, status) => updateDoc(inviteRef(invite.id), { status });

// ── Runs and rating ───────────────────────────────────────────────────────
const ratingRef = () => doc(db, "users", uid(), "rating", "current");
const eventsCol = () => collection(db, "users", uid(), "ratingEvents");
let ratingState = null;
export const getRatingState = () => ratingState;

export async function loadRating() {
  const snap = await getDoc(ratingRef());
  if (snap.exists()) {
    ratingState = snap.data();
  } else {
    const init = { rating: START, peak: START, runsRated: 0, rank: "Rookie", lastEventId: "", lastRunAt: null, decayWeeks: 0, updatedAt: serverTimestamp() };
    await setDoc(ratingRef(), init);
    ratingState = { ...init };
  }
  return ratingState;
}

/** Shows the rating on the public card (or only the rank when hidden). */
export async function syncCardRating(extra = {}) {
  if (!card || !ratingState) return;
  const show = (extra.showRating ?? card.showRating) !== false;
  await saveCard({ ...card, ...extra, rating: show ? ratingState.rating : null, rank: ratingState.rank });
}

async function commitRating(eid, kind, refId, delta, reasons, { countRun = false, lastRunAt, decayWeeks } = {}) {
  const before = ratingState.rating;
  const next = applyDelta(ratingState, delta);
  const state = {
    rating: next.rating,
    peak: next.peak,
    runsRated: ratingState.runsRated + (countRun ? 1 : 0),
    rank: next.rank,
    lastEventId: eid,
    lastRunAt: lastRunAt ?? ratingState.lastRunAt ?? null,
    decayWeeks: decayWeeks ?? ratingState.decayWeeks ?? 0,
    updatedAt: serverTimestamp(),
  };
  const batch = writeBatch(db);
  batch.set(doc(eventsCol(), eid), { kind, refId, before, after: next.rating, delta: next.rating - before, reasons: reasons.slice(0, 10), createdAt: serverTimestamp() });
  batch.set(ratingRef(), state);
  await batch.commit();
  ratingState = state;
  await syncCardRating().catch((err) => console.warn("Card not updated", err.code));
  return { before, after: state.rating };
}

export const saveRun = (sessionId, run) =>
  setDoc(doc(sub("runs"), sessionId), { ...run, startAt: Timestamp.fromDate(run.startAt) });

export async function listRuns(max = 200) {
  const snap = await getDocs(query(sub("runs"), orderBy("startAt", "desc"), limit(max)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data(), startMs: d.data().startAt.toMillis() }));
}

/** Rates a saved run once (the event id is the run id). */
export async function rateFinishedRun(sessionId, run) {
  if (!ratingState) await loadRating();
  const since = Timestamp.fromMillis(Date.now() - 28 * 86400000);
  const recent = await getDocs(query(sub("runs"), where("startAt", ">=", since))).then((x) => x.size).catch(() => 0);
  const { delta, reasons } = rateRun(run, ratingState, { runsLast4Weeks: recent });
  const res = await commitRating(`run_${sessionId}`, "run", sessionId, delta, reasons, {
    countRun: !ineligible(run),
    lastRunAt: Timestamp.now(),
    decayWeeks: 0,
  });
  return { ...res, delta: res.after - res.before, reasons };
}

/** Adds a rating change from a challenge, once per challenge. */
export async function rateChallenge(challengeId, delta, reasons) {
  if (!ratingState) await loadRating();
  return commitRating(`challenge_${challengeId}`, "challenge", challengeId, delta, reasons);
}

/** Slow decay after 14 days without a run, protected by the rank shield. */
export async function applyDecay() {
  if (!ratingState?.lastRunAt) return null;
  const d = decayed(ratingState.rating, ratingState.lastRunAt.toMillis(), Date.now(), ratingState.decayWeeks ?? 0);
  if (!d.weeks) return null;
  const wk = weekKey();
  const delta = d.rating - ratingState.rating;
  return commitRating(`decay_${wk}`, "decay", wk, delta, [`${delta} inactivity (${d.weeks} week${d.weeks > 1 ? "s" : ""})`], {
    decayWeeks: (ratingState.decayWeeks ?? 0) + d.weeks,
  }).catch(() => null);
}

export async function listRatingEvents(max = 50) {
  const snap = await getDocs(query(eventsCol(), orderBy("createdAt", "desc"), limit(max)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data(), atMs: d.data().createdAt?.toMillis?.() ?? Date.now() }));
}

// ── Posts and feed ────────────────────────────────────────────────────────
const postRef = (id) => doc(db, "posts", id);
const likeRef = (id) => doc(db, "posts", id, "likes", uid());

/** Shares a run summary. Needs a public card (the post shows its name and handle). */
export async function sharePost({ caption, visibility, stats, trend }) {
  if (!card) throw new Error("Create your public card first.");
  const ref = doc(collection(db, "posts"));
  await setDoc(ref, {
    ownerUid: uid(),
    author: { name: card.displayName, handle: card.handle, avatar: card.avatar },
    createdAt: serverTimestamp(),
    caption: caption.trim(),
    visibility,
    stats,
    trend,
    likeCount: 0,
  });
  return ref.id;
}

export const deletePost = (id) => deleteDoc(postRef(id));

export async function likedByMe(id) {
  const snap = await getDoc(likeRef(id)).catch(() => null);
  return !!snap?.exists();
}

/** Like or unlike; the like and the counter change in one write. */
export async function setLike(id, like) {
  const batch = writeBatch(db);
  if (like) batch.set(likeRef(id), { at: serverTimestamp() });
  else batch.delete(likeRef(id));
  batch.update(postRef(id), { likeCount: increment(like ? 1 : -1) });
  await batch.commit();
}

const asPost = (d) => ({ id: d.id, ...d.data(), createdAtMs: d.data().createdAt?.toMillis?.() ?? Date.now() });

/**
 * "following": my posts, my friends' friends-only posts and the posts of people I follow.
 * "community": every public post.
 */
export async function openFeed(mode = "following") {
  const posts = collection(db, "posts");
  const newest = [orderBy("createdAt", "desc"), limit(PAGE)];
  const sources = {};
  if (mode === "community") {
    sources.public = () => [where("visibility", "==", "public")];
  } else {
    const [friends, following] = await Promise.all([
      getDocs(sub("friends")).then((x) => x.docs.map((d) => d.id)).catch(() => []),
      getDocs(sub("following")).then((x) => x.docs.map((d) => d.id)).catch(() => []),
    ]);
    sources.mine = () => [where("ownerUid", "==", uid())];
    for (const f of friends) sources["friend:" + f] = () => [where("ownerUid", "==", f), where("visibility", "==", "friends")];
    for (const f of following) sources["follow:" + f] = () => [where("ownerUid", "==", f), where("visibility", "in", ["public", "followers"])];
  }

  return createFeedMerger(Object.keys(sources), async (id, cursor) => {
    const parts = [...sources[id](), ...newest];
    if (cursor) parts.push(startAfter(cursor));
    const snap = await getDocs(query(posts, ...parts));
    return { items: snap.docs.map(asPost), cursor: snap.docs.at(-1) ?? cursor, done: snap.size < PAGE };
  });
}

// ── Comments and reports ──────────────────────────────────────────────────
const commentsCol = (postId) => collection(db, "posts", postId, "comments");

export async function listComments(postId) {
  const snap = await getDocs(query(commentsCol(postId), orderBy("createdAt"), limit(50)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data(), atMs: d.data().createdAt?.toMillis?.() ?? Date.now() }));
}

export function addComment(postId, text) {
  if (!card) throw new Error("Create your public card first.");
  return setDoc(doc(commentsCol(postId)), {
    uid: uid(),
    author: { name: card.displayName, handle: card.handle, avatar: card.avatar },
    text: text.trim(),
    createdAt: serverTimestamp(),
    hidden: false,
  });
}

export const deleteComment = (postId, id) => deleteDoc(doc(commentsCol(postId), id));
export const hideComment = (postId, id, hidden) => updateDoc(doc(commentsCol(postId), id), { hidden });

export const report = (postId, commentId, reason) =>
  setDoc(doc(collection(db, "reports")), {
    reporter: uid(),
    postId,
    ...(commentId ? { commentId } : {}),
    reason,
    createdAt: serverTimestamp(),
  });

// ── Follow, private accounts, block and mute ─────────────────────────────
const rel = (owner, coll, other) => doc(db, "users", owner, coll, other);
const exists = (ref) => getDoc(ref).then((x) => x.exists()).catch(() => false);

/** How I relate to another runner. */
export async function relationTo(other) {
  const me = uid();
  const [following, requested, blocked, muted, followsMe] = await Promise.all([
    exists(rel(me, "following", other)),
    exists(rel(other, "followRequests", me)),
    exists(rel(me, "blocked", other)),
    exists(rel(me, "muted", other)),
    exists(rel(me, "followers", other)),
  ]);
  const conn = await getDoc(connRef(connectionId(me, other))).then((x) => (x.exists() ? { id: x.id, ...x.data() } : null)).catch(() => null);
  return { following, requested, blocked, muted, followsMe, conn, friend: conn?.status === "accepted" };
}

/** Follows a public account at once; asks a private one. */
export async function followUser(other, otherCard) {
  if (otherCard?.private) {
    await setDoc(rel(other, "followRequests", uid()), {
      since: serverTimestamp(), name: card.displayName, handle: card.handle, avatar: card.avatar,
    });
    return "requested";
  }
  const batch = writeBatch(db);
  batch.set(rel(uid(), "following", other), { since: serverTimestamp() });
  batch.set(rel(other, "followers", uid()), { since: serverTimestamp() });
  await batch.commit();
  return "following";
}

export async function unfollowUser(other) {
  const batch = writeBatch(db);
  batch.delete(rel(uid(), "following", other));
  batch.delete(rel(other, "followers", uid()));
  await batch.commit();
}

export const cancelFollowRequest = (other) => deleteDoc(rel(other, "followRequests", uid()));

export function watchFollowRequests(onChange, onError) {
  return onSnapshot(sub("followRequests"), (snap) => onChange(snap.docs.map((d) => ({ uid: d.id, ...d.data() }))), onError);
}

export async function approveFollower(f) {
  const batch = writeBatch(db);
  batch.delete(rel(uid(), "followRequests", f));
  batch.set(rel(uid(), "followers", f), { since: serverTimestamp() });
  batch.set(rel(f, "following", uid()), { since: serverTimestamp() });
  await batch.commit();
}

export const declineFollower = (f) => deleteDoc(rel(uid(), "followRequests", f));

/** Blocks: also ends follows both ways, requests and the friendship. */
export async function blockUser(other) {
  const me = uid();
  const relation = await relationTo(other);
  const batch = writeBatch(db);
  batch.set(rel(me, "blocked", other), { since: serverTimestamp() });
  if (relation.following) {
    batch.delete(rel(me, "following", other));
    batch.delete(rel(other, "followers", me));
  }
  if (relation.followsMe) {
    batch.delete(rel(other, "following", me));
    batch.delete(rel(me, "followers", other));
  }
  if (relation.requested) batch.delete(rel(other, "followRequests", me));
  batch.delete(rel(me, "followRequests", other));
  if (relation.conn) {
    batch.delete(connRef(relation.conn.id));
    if (relation.friend) {
      batch.delete(friendRef(me, other));
      batch.delete(friendRef(other, me));
    }
  }
  await batch.commit();
}

export const unblockUser = (other) => deleteDoc(rel(uid(), "blocked", other));
export const muteUser = (other) => setDoc(rel(uid(), "muted", other), { since: serverTimestamp() });
export const unmuteUser = (other) => deleteDoc(rel(uid(), "muted", other));

export async function hiddenPeople() {
  const [b, m] = await Promise.all([getDocs(sub("blocked")), getDocs(sub("muted"))].map((p) => p.catch(() => ({ docs: [] }))));
  return { blocked: b.docs.map((d) => d.id), muted: m.docs.map((d) => d.id) };
}

/** Which post visibilities I may see from this runner. */
export function visibleTo(relation, self) {
  if (self) return ["public", "followers", "friends", "private"];
  const v = ["public"];
  if (relation.following) v.push("followers");
  if (relation.friend) v.push("friends");
  return v;
}

export async function postsOf(other, visibilities, max = 30) {
  const snap = await getDocs(
    query(collection(db, "posts"), where("ownerUid", "==", other), where("visibility", "in", visibilities), orderBy("createdAt", "desc"), limit(max))
  );
  return snap.docs.map(asPost);
}

/** Counters computed from the relation documents: nothing to tamper with. */
export async function networkCounts(other, visibilities) {
  const count = (q) => getCountFromServer(q).then((x) => x.data().count).catch(() => null);
  const [followers, following, runs] = await Promise.all([
    count(collection(db, "users", other, "followers")),
    count(collection(db, "users", other, "following")),
    count(query(collection(db, "posts"), where("ownerUid", "==", other), where("visibility", "in", visibilities))),
  ]);
  const friends = other === uid() ? await count(sub("friends")) : null;
  return { followers, following, runs, friends };
}

/** Private: only followers see your runs; public posts become followers-only. */
export async function setPrivate(on) {
  await saveCard({ ...card, private: on });
  if (!on) return;
  const mine = await getDocs(query(collection(db, "posts"), where("ownerUid", "==", uid()), where("visibility", "==", "public")));
  for (let i = 0; i < mine.docs.length; i += 400) {
    const batch = writeBatch(db);
    mine.docs.slice(i, i + 400).forEach((d) => batch.update(d.ref, { visibility: "followers" }));
    await batch.commit();
  }
}

async function deleteMyPosts() {
  const mine = await getDocs(query(collection(db, "posts"), where("ownerUid", "==", uid()))).catch(() => null);
  for (const d of mine?.docs ?? []) await deleteDoc(d.ref).catch(() => {});
}

/** Removes everything friend-related for this user (account deletion). */
async function deleteSocial() {
  const me = uid();
  const conns = await getDocs(query(collection(db, "connections"), where("users", "array-contains", me)));
  for (const d of conns.docs) await removeConnection({ id: d.id, ...d.data() }).catch(() => {});
  for (const field of ["from", "to"]) {
    const invites = await getDocs(query(collection(db, "runInvites"), where(field, "==", me))).catch(() => null);
    for (const d of invites?.docs ?? []) await deleteDoc(d.ref).catch(() => {});
  }
  if (card?.handle) {
    const batch = writeBatch(db);
    batch.delete(profileRef());
    batch.delete(handleRef(card.handle));
    await batch.commit().catch(() => {});
  }
}

// ── Export, sign out, delete ──────────────────────────────────────────────
const plain = (data) =>
  Object.fromEntries(
    Object.entries(data).map(([k, v]) => [k, v instanceof Timestamp ? v.toDate().toISOString() : v])
  );

export async function exportAll() {
  const [me, windows, events] = await Promise.all([getDoc(userRef()), getDocs(sub("windows")), getDocs(sub("events"))]);
  const code = me.data()?.teamId;
  const shared = code ? await getDoc(memberRef(code)).catch(() => null) : null;
  const [pub, friends, conns] = await Promise.all([
    getDoc(profileRef()).catch(() => null),
    getDocs(sub("friends")).catch(() => null),
    getDocs(query(collection(db, "connections"), where("users", "array-contains", uid()))).catch(() => null),
  ]);
  return {
    exportedAt: new Date().toISOString(),
    email: auth.currentUser.email,
    profile: me.exists() ? plain(me.data()) : null,
    sharedWithTeam: shared?.exists() ? plain(shared.data()) : null,
    publicCard: pub?.exists() ? plain(pub.data()) : null,
    friends: friends?.docs.map((d) => d.id) ?? [],
    connections: conns?.docs.map((d) => ({ id: d.id, ...plain(d.data()) })) ?? [],
    windows: windows.docs.map((d) => plain(d.data())),
    events: events.docs.map((d) => plain(d.data())),
  };
}

/** Removes the offline copy so the next person on this browser can't read it. */
async function clearLocalAndReload() {
  try {
    await terminate(db);
    await clearIndexedDbPersistence(db);
  } catch (err) {
    console.warn("Local cache not cleared (another tab open?)", err);
  }
  location.reload();
}

export async function signOutAndClear() {
  // give queued offline writes a moment to reach the server
  await Promise.race([waitForPendingWrites(db), new Promise((r) => setTimeout(r, 3000))]).catch(() => {});
  await signOut(auth);
  await clearLocalAndReload();
}

export const usesPassword = () => auth.currentUser.providerData.some((p) => p.providerId === "password");

/** Re-authenticates, deletes all documents, then the account itself. */
export async function deleteAccount(password) {
  const user = auth.currentUser;
  if (usesPassword()) {
    await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, password));
  } else {
    await reauthenticateWithPopup(user, new GoogleAuthProvider());
  }
  await user.getIdToken(true);

  await loadCard().catch(() => null);
  await deleteMyPosts();
  await deleteSocial();
  // end follows in both directions
  for (const [coll, other] of [["following", "followers"], ["followers", "following"]]) {
    const list = await getDocs(sub(coll)).catch(() => ({ docs: [] }));
    for (const d of list.docs) {
      const batch = writeBatch(db);
      batch.delete(d.ref);
      batch.delete(rel(d.id, other, uid()));
      await batch.commit().catch(() => {});
    }
  }

  // pending applications to published teams
  for (const t of await listPublicTeams().catch(() => [])) {
    if (t.tier === "premium") await deleteDoc(requestRef(t.id)).catch(() => {});
  }

  const code = profile?.teamId;
  if (code) {
    await deleteDoc(memberRef(code)).catch(() => {});
    const team = await getTeam(code).catch(() => null);
    if (team?.ownerUid === user.uid) await deleteDoc(teamRef(code)).catch(() => {});
  }
  for (const name of ["windows", "events", "runs", "ratingEvents", "rating", "badges", "runPlans", "blocked", "muted", "followRequests", "public"]) {
    const { docs } = await getDocs(sub(name)).catch(() => ({ docs: [] }));
    for (let i = 0; i < docs.length; i += 400) {
      const batch = writeBatch(db);
      docs.slice(i, i + 400).forEach((d) => batch.delete(d.ref));
      await batch.commit();
    }
  }
  await deleteDoc(userRef());
  await deleteUser(user);
  await clearLocalAndReload();
}

// ── Challenges (Part C) ───────────────────────────────────────────────────
const challengeRef = (id) => doc(db, "challenges", id);
const resultRef = (id, u = uid()) => doc(db, "challenges", id, "results", u);
const nameOf = (c) => ({ name: c?.displayName ?? "Runner", handle: c?.handle ?? "", avatar: c?.avatar ?? "🏃" });

export async function createChallenge(friend, friendCard, { type, target, days, rated }) {
  const ref = doc(collection(db, "challenges"));
  const clean = Object.fromEntries(Object.entries(target ?? {}).filter(([, v]) => Number.isFinite(v)));
  await setDoc(ref, {
    users: [uid(), friend],
    from: uid(),
    type,
    target: clean,
    days,
    rated,
    status: "pending",
    names: { [uid()]: nameOf(card), [friend]: nameOf(friendCard) },
    createdAt: serverTimestamp(),
    acceptedAt: null,
    deadline: null,
    winner: null,
    finishedAt: null,
  });
  return ref.id;
}

export function watchChallenges(onChange, onError) {
  return onSnapshot(
    query(collection(db, "challenges"), where("users", "array-contains", uid()), orderBy("createdAt", "desc"), limit(50)),
    (snap) => onChange(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    onError
  );
}

/** Accepting starts the clock: deadline = now + days (the rules allow 1 h of clock skew). */
export async function acceptChallenge(c) {
  await updateDoc(challengeRef(c.id), {
    status: "accepted",
    acceptedAt: serverTimestamp(),
    deadline: Timestamp.fromMillis(Date.now() + c.days * 86400000),
  });
}
export const declineChallenge = (c) => updateDoc(challengeRef(c.id), { status: "declined" });
export const cancelChallenge = (c) => updateDoc(challengeRef(c.id), { status: "cancelled" });

export async function challengeResults(c) {
  const out = {};
  for (const u of c.users) {
    const x = await getDoc(resultRef(c.id, u)).catch(() => null);
    if (x?.exists()) out[u] = x.data();
  }
  return out;
}

export const saveChallengeResult = (c, p) =>
  setDoc(resultRef(c.id), { value: p.value ?? null, finished: !!p.finished, runId: p.runId ?? null, share: Math.round((p.share ?? 0) * 100) / 100, updatedAt: serverTimestamp() });

export async function finishChallenge(c, winner) {
  await updateDoc(challengeRef(c.id), { status: "finished", winner: winner ?? null, finishedAt: serverTimestamp() });
}

/** Wins are counted on the public card. */
export async function addChallengeWin() {
  if (!card) return;
  await saveCard({ ...card, challengesWon: (card.challengesWon ?? 0) + 1 });
}

/** My weekly distance on the card (for leaderboards). */
export async function syncWeekKm(weekKmValue, key) {
  if (!card) return;
  await saveCard({ ...card, weekKm: Math.round(weekKmValue * 10) / 10, weekKey: key });
}

// ── Leaderboards and runners at your level (Part D) ───────────────────────
async function cardsOf(uids) {
  const list = await Promise.all([...new Set(uids)].map(async (u) => {
    const c = u === uid() ? card : await cardOf(u);
    return c ? { ...c, uid: u } : null;
  }));
  return list.filter(Boolean);
}
export async function friendCards() {
  const ids = await getDocs(sub("friends")).then((x) => x.docs.map((d) => d.id)).catch(() => []);
  return cardsOf([uid(), ...ids]);
}
export async function followingCards() {
  const ids = await getDocs(sub("following")).then((x) => x.docs.map((d) => d.id)).catch(() => []);
  return cardsOf([uid(), ...ids]);
}
export async function teamCards(code) {
  if (!code) return [];
  const ids = await getDocs(collection(db, "teams", code, "members")).then((x) => x.docs.map((d) => d.id)).catch(() => []);
  return cardsOf([uid(), ...ids]);
}
export async function cityCards(cityKey) {
  if (!cityKey) return [];
  const snap = await getDocs(
    query(collection(db, "profiles"), where("discoverable", "==", true), where("leaderboard", "==", true), where("cityKey", "==", cityKey), limit(50))
  );
  return snap.docs.map((d) => ({ ...d.data(), uid: d.id }));
}
export async function runnersAtMyLevel(rating, span = 150) {
  const snap = await getDocs(
    query(collection(db, "profiles"), where("discoverable", "==", true), where("rating", ">=", rating - span), where("rating", "<=", rating + span), orderBy("rating"), limit(20))
  );
  return snap.docs.map((d) => ({ ...d.data(), uid: d.id })).filter((c) => c.uid !== uid());
}
export async function setLeaderboardOptIn(on) {
  if (!card) return;
  const key = (card.city ?? "").trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  await saveCard({ ...card, leaderboard: on, cityKey: on ? key : null });
}

// ── Badges and records (Part E) ───────────────────────────────────────────
export async function badgesOf(owner) {
  const snap = await getDocs(collection(db, "users", owner, "badges"));
  return Object.fromEntries(snap.docs.map((d) => [d.id, d.data().unlockedAt?.toMillis?.() ?? Date.now()]));
}
export async function unlockBadges(list) {
  const batch = writeBatch(db);
  for (const b of list) batch.set(doc(db, "users", uid(), "badges", b.id), { unlockedAt: serverTimestamp(), rarity: b.rarity });
  await batch.commit();
}
export async function recordsOf(owner) {
  const x = await getDoc(doc(db, "users", owner, "public", "records"));
  return x.exists() ? x.data() : null;
}
export const saveRecords = (r) =>
  setDoc(doc(db, "users", uid(), "public", "records"), Object.fromEntries([...Object.entries(r).filter(([, v]) => v != null), ["updatedAt", serverTimestamp()]]));
export async function setPinned(ids) {
  if (!card) return;
  await saveCard({ ...card, pinned: ids.slice(0, 3) });
}
export async function friendCount() {
  return getCountFromServer(sub("friends")).then((x) => x.data().count).catch(() => 0);
}

// ── Run plans (Part F) ────────────────────────────────────────────────────
export async function savePlan(plan, input, shared = false) {
  const ref = doc(sub("runPlans"));
  await setDoc(ref, {
    title: plan.title ?? "Run plan",
    segments: plan.segments.map(({ type, startMinute, durationSec, targetZone, paceHint, note }) => ({ type, startMinute, durationSec, targetZone, paceHint: paceHint ?? "", note: note ?? "" })),
    source: plan.source === "ai" ? "ai" : "rules",
    notes: plan.notes ?? [],
    input,
    shared,
    createdAt: serverTimestamp(),
  });
  return ref.id;
}
export async function myPlans(max = 10) {
  const snap = await getDocs(query(sub("runPlans"), orderBy("createdAt", "desc"), limit(max)));
  return snap.docs.map((d) => ({ id: d.id, ownerUid: uid(), ...d.data() }));
}
export const sharePlan = (id, shared) => updateDoc(doc(db, "users", uid(), "runPlans", id), { shared });
export const deletePlan = (id) => deleteDoc(doc(db, "users", uid(), "runPlans", id));
export async function friendsPlans() {
  const ids = await getDocs(sub("friends")).then((x) => x.docs.map((d) => d.id)).catch(() => []);
  const all = await Promise.all(ids.map((f) =>
    getDocs(query(collection(db, "users", f, "runPlans"), where("shared", "==", true), limit(3)))
      .then((x) => x.docs.map((d) => ({ id: d.id, ownerUid: f, ...d.data() })))
      .catch(() => [])
  ));
  return all.flat();
}
