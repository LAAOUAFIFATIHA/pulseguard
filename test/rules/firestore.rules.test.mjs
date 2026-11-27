// Security rules tests (Firestore emulator):  npm run test:rules
import { test, before, after, beforeEach } from "node:test";
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import {
  doc, getDoc, setDoc, updateDoc, deleteDoc, getDocs, collection, serverTimestamp, Timestamp, query, where, writeBatch,
} from "firebase/firestore";
import { summarize } from "../../src/summary.js";

let env;
before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-pulseguard",
    firestore: { rules: readFileSync("firestore.rules", "utf8") },
  });
});
after(() => env.cleanup());
beforeEach(() => env.clearFirestore());

const as = (uid, verified = true) => env.authenticatedContext(uid, { email_verified: verified }).firestore();

const t0 = Timestamp.fromMillis(1_700_000_000_000);
const profile = (extra = {}) => ({
  displayName: "Test", age: 25, role: "athlete", consentAt: t0, updatedAt: serverTimestamp(), ...extra,
});
const windowDoc = (extra = {}) => ({
  ...summarize({
    sampleCount: 2500, sampleRate: 250, label: "rest", activity: "rest", motion: "still",
    beats: [0.5, 1.4, 2.3, 3.2], tempC: [33.2], humidity: [45], alerts: [],
  }),
  startAt: t0,
  ...extra,
});
const event = (extra = {}) => ({ type: "brady", severity: "medium", startAt: t0, endAt: null, peakHr: 42, ...extra });

async function seed() {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "users/alice"), { ...profile(), updatedAt: t0 });
    await setDoc(doc(db, "users/alice/windows/w1"), windowDoc());
    await setDoc(doc(db, "users/alice/events/e1"), event());
  });
}

test("a verified user can create and read their own data", async () => {
  const db = as("alice");
  await assertSucceeds(setDoc(doc(db, "users/alice"), profile({ restingHr: 55 })));
  await assertSucceeds(setDoc(doc(db, "users/alice/windows/w1"), windowDoc()));
  await assertSucceeds(setDoc(doc(db, "users/alice/events/e1"), event()));
  await assertSucceeds(getDoc(doc(db, "users/alice")));
  await assertSucceeds(getDocs(collection(db, "users/alice/windows")));
  await assertSucceeds(updateDoc(doc(db, "users/alice/events/e1"), { endAt: t0 }));
  await assertSucceeds(deleteDoc(doc(db, "users/alice/windows/w1")));
});

test("another user cannot read or write someone's data", async () => {
  await seed();
  const db = as("mallory");
  await assertFails(getDoc(doc(db, "users/alice")));
  await assertFails(getDocs(collection(db, "users/alice/windows")));
  await assertFails(getDocs(collection(db, "users/alice/events")));
  await assertFails(setDoc(doc(db, "users/alice"), profile()));
  await assertFails(setDoc(doc(db, "users/alice/windows/w2"), windowDoc()));
  await assertFails(updateDoc(doc(db, "users/alice/events/e1"), { endAt: t0 }));
  await assertFails(deleteDoc(doc(db, "users/alice/windows/w1")));
  await assertFails(getDocs(collection(db, "users")));
});

test("signed-out and unverified users get nothing", async () => {
  await seed();
  const anon = env.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(anon, "users/alice")));
  await assertFails(setDoc(doc(anon, "users/alice/windows/w2"), windowDoc()));
  const unverified = as("alice", false);
  await assertFails(getDoc(doc(unverified, "users/alice")));
  await assertFails(setDoc(doc(unverified, "users/alice"), profile()));
});

test("bad fields, types and sizes are rejected", async () => {
  const db = as("alice");
  await assertFails(setDoc(doc(db, "users/alice"), profile({ isAdmin: true })));
  await assertFails(setDoc(doc(db, "users/alice"), profile({ age: "25" })));
  await assertFails(setDoc(doc(db, "users/alice"), profile({ displayName: "x".repeat(61) })));
  await assertFails(setDoc(doc(db, "users/alice"), profile({ role: "admin" })));
  await assertFails(setDoc(doc(db, "users/alice/windows/w1"), windowDoc({ samples: [1, 2, 3] })));
  await assertFails(setDoc(doc(db, "users/alice/windows/w1"), windowDoc({ avgHr: 999 })));
  await assertFails(setDoc(doc(db, "users/alice/events/e1"), event({ type: "other" })));
  await assertFails(setDoc(doc(db, "users/alice/anything/x"), { a: 1 }));
  await assertFails(setDoc(doc(db, "public/x"), { a: 1 }));
});

test("consent date and event type cannot be rewritten", async () => {
  await seed();
  const db = as("alice");
  await assertFails(setDoc(doc(db, "users/alice"), profile({ consentAt: Timestamp.now() })));
  await assertFails(updateDoc(doc(db, "users/alice/events/e1"), { type: "irregular" }));
  await assertFails(updateDoc(doc(db, "users/alice/windows/w1"), { avgHr: 60 }));
});

// ── Teams ──────────────────────────────────────────────────────────────────
const CODE = "ABCD2345";
const member = (name, extra = {}) => ({
  displayName: name, role: "athlete", joinedAt: t0, updatedAt: serverTimestamp(), state: "normal",
  hr: 70, lastNormalHr: 68, trend: [70, 71], ...extra,
});

async function seedTeam() {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, `teams/${CODE}`), { name: "Club", ownerUid: "coach", createdAt: t0 });
    for (const uid of ["coach", "alice"]) {
      await setDoc(doc(db, `teams/${CODE}/members/${uid}`), { ...member(uid), updatedAt: t0 });
    }
  });
}

test("windows may carry a session id; profiles a team code", async () => {
  const db = as("alice");
  await assertSucceeds(setDoc(doc(db, "users/alice/windows/w1"), windowDoc({ sessionId: "s-1" })));
  await assertSucceeds(setDoc(doc(db, "users/alice"), profile({ teamId: CODE })));
  await assertFails(setDoc(doc(db, "users/alice"), profile({ teamId: "lower123" })));
});

test("anyone verified can create a team with a valid code, as its owner", async () => {
  const db = as("bob");
  const team = { name: "Runners", ownerUid: "bob", createdAt: serverTimestamp() };
  await assertSucceeds(setDoc(doc(db, "teams/QWER2345"), team));
  await assertFails(setDoc(doc(db, "teams/bad"), team));
  await assertFails(setDoc(doc(db, "teams/ZXCV2345"), { ...team, ownerUid: "someone-else" }));
  await assertFails(getDocs(collection(db, "teams")));
});

test("team members see each other; outsiders see nobody", async () => {
  await seedTeam();
  await assertSucceeds(getDocs(collection(as("alice"), `teams/${CODE}/members`)));
  await assertSucceeds(getDoc(doc(as("coach"), `teams/${CODE}/members/alice`)));
  await assertFails(getDocs(collection(as("mallory"), `teams/${CODE}/members`)));
  await assertFails(getDoc(doc(as("mallory"), `teams/${CODE}/members/alice`)));
  await assertFails(getDocs(collection(as("alice", false), `teams/${CODE}/members`)));
});

test("joining needs an existing team and only writes your own card", async () => {
  await seedTeam();
  const db = as("bob");
  await assertSucceeds(setDoc(doc(db, `teams/${CODE}/members/bob`), member("Bob")));
  await assertFails(setDoc(doc(db, "teams/NONE2345/members/bob"), member("Bob")));
  await assertFails(setDoc(doc(db, `teams/${CODE}/members/alice`), member("Fake")));
  await assertFails(setDoc(doc(db, `teams/${CODE}/members/bob`), member("Bob", { samples: [1, 2] })));
  await assertFails(setDoc(doc(db, `teams/${CODE}/members/bob`), member("Bob", { trend: new Array(31).fill(1) })));
});

test("members leave; only the owner removes others", async () => {
  await seedTeam();
  await assertFails(deleteDoc(doc(as("alice"), `teams/${CODE}/members/coach`)));
  await assertSucceeds(deleteDoc(doc(as("coach"), `teams/${CODE}/members/alice`)));
  await seedTeam();
  await assertSucceeds(deleteDoc(doc(as("alice"), `teams/${CODE}/members/alice`)));
  await assertFails(deleteDoc(doc(as("alice"), `teams/${CODE}`)));
});

// ── Directory and premium teams ────────────────────────────────────────────
const PREMIUM = "PREM2345";

async function seedDirectory() {
  await seedTeam(); // CODE: private free team
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "users/coach"), { ...profile({ role: "coach" }), updatedAt: t0 });
    await setDoc(doc(db, "users/alice"), { ...profile(), updatedAt: t0 });
    await setDoc(doc(db, `teams/${PREMIUM}`), {
      name: "Pro", ownerUid: "coach", createdAt: t0, listed: true, tier: "premium", ownerName: "Coach",
    });
  });
}
const request = (extra = {}) => ({ displayName: "Bob", status: "pending", createdAt: serverTimestamp(), ...extra });
const listed = (db) => getDocs(query(collection(db, "teams"), where("listed", "==", true)));

test("only published teams can be listed", async () => {
  await seedDirectory();
  await assertSucceeds(listed(as("bob")));
  await assertFails(getDocs(collection(as("bob"), "teams")));
  await assertFails(listed(as("bob", false)));
});

test("a premium team cannot be joined without the coach's approval", async () => {
  await seedDirectory();
  const bob = as("bob");
  await assertFails(setDoc(doc(bob, `teams/${PREMIUM}/members/bob`), member("Bob")));
  await assertFails(setDoc(doc(bob, `teams/${PREMIUM}/requests/bob`), request({ status: "approved" })));
  await assertSucceeds(setDoc(doc(bob, `teams/${PREMIUM}/requests/bob`), request()));
  await assertFails(updateDoc(doc(bob, `teams/${PREMIUM}/requests/bob`), { status: "approved" }));
  await assertFails(setDoc(doc(bob, `teams/${PREMIUM}/members/bob`), member("Bob")));
  await assertFails(getDocs(collection(as("alice"), `teams/${PREMIUM}/requests`)));
  const coach = as("coach");
  await assertSucceeds(getDocs(collection(coach, `teams/${PREMIUM}/requests`)));
  await assertSucceeds(updateDoc(doc(coach, `teams/${PREMIUM}/requests/bob`), { status: "approved" }));
  await assertSucceeds(setDoc(doc(bob, `teams/${PREMIUM}/members/bob`), member("Bob")));
});

test("only a coach can make a team premium, and only the owner publishes it", async () => {
  await seedDirectory();
  await assertFails(updateDoc(doc(as("alice"), `teams/${CODE}`), { listed: true }));
  await assertSucceeds(updateDoc(doc(as("coach"), `teams/${CODE}`), { listed: true, tier: "premium" }));
  const alice = as("alice");
  await assertFails(setDoc(doc(alice, "teams/ALCE2345"), {
    name: "Mine", ownerUid: "alice", createdAt: serverTimestamp(), tier: "premium",
  }));
});

// ── Urgent alerts and location ─────────────────────────────────────────────
const spot = (extra = {}) => ({ lat: 34.0, lng: -6.84, accuracy: 12, at: t0, ...extra });

test("a member may share an urgent alert with a valid location, only on their own card", async () => {
  await seedTeam();
  const db = as("alice");
  const ref = doc(db, `teams/${CODE}/members/alice`);
  const card = (extra) => ({ ...member("alice"), joinedAt: t0, state: "alert", urgent: true, ...extra });
  await assertSucceeds(setDoc(ref, card({ location: spot() })));
  await assertSucceeds(setDoc(ref, card({ location: null })));
  await assertFails(setDoc(ref, card({ location: spot({ lat: 999 }) })));
  await assertFails(setDoc(ref, card({ location: spot({ address: "home" }) })));
  await assertFails(setDoc(ref, card({ urgent: "yes" })));
  await assertFails(updateDoc(doc(as("coach"), `teams/${CODE}/members/alice`), { location: spot() }));
  await assertFails(getDoc(doc(as("mallory"), `teams/${CODE}/members/alice`)));
});

test("the new alert types can be saved as events", async () => {
  const db = as("alice");
  await assertSucceeds(setDoc(doc(db, "users/alice/events/e2"), event({ type: "highTemp", severity: "high" })));
  await assertSucceeds(setDoc(doc(db, "users/alice/events/e3"), event({ type: "dangerHr", severity: "high" })));
});

// ── Phase 1: public cards, handles, connections, run invites ───────────────
const card = (uid, extra = {}) => ({
  displayName: uid[0].toUpperCase() + uid.slice(1), searchName: uid, handle: uid + "_run", avatar: "🏃",
  bio: "", city: "Rabat", runnerLevel: "casual", discoverable: true, updatedAt: serverTimestamp(), ...extra,
});
const conn = (a, b, requester, status = "pending") => ({ users: [a, b].sort(), requester, status, createdAt: serverTimestamp() });

async function seedCards(extra = {}) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    for (const uid of ["alice", "bob", "carol", "mallory"]) {
      await setDoc(doc(db, `profiles/${uid}`), { ...card(uid, extra[uid]), updatedAt: t0 });
      await setDoc(doc(db, `handles/${uid}_run`), { uid });
    }
  });
}

/** alice and bob are friends; alice is in team CODE. */
async function seedFriends() {
  await seedCards();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "connections/alice_bob"), { ...conn("alice", "bob", "alice", "accepted"), createdAt: t0, acceptedAt: t0 });
    await setDoc(doc(db, "users/alice/friends/bob"), { since: t0 });
    await setDoc(doc(db, "users/bob/friends/alice"), { since: t0 });
    await setDoc(doc(db, `teams/${CODE}`), { name: "Club", ownerUid: "alice", createdAt: t0 });
    await setDoc(doc(db, `teams/${CODE}/members/alice`), { ...member("alice"), updatedAt: t0 });
    await setDoc(doc(db, "users/bob"), { ...profile(), updatedAt: t0, restingHr: 55 });
  });
}

function createCard(db, uid, extra = {}) {
  const batch = writeBatch(db);
  const c = card(uid, extra);
  batch.set(doc(db, `profiles/${uid}`), c);
  batch.set(doc(db, `handles/${c.handle}`), { uid });
  return batch.commit();
}

test("a card can be created with a free handle; a taken handle is refused", async () => {
  await assertSucceeds(createCard(as("alice"), "alice"));
  await assertFails(createCard(as("eve"), "eve", { handle: "alice_run" }));
  await assertFails(setDoc(doc(as("eve"), "handles/alice_run"), { uid: "eve" }));
  await assertFails(createCard(as("eve"), "eve", { handle: "No-Caps" }));
});

test("a card holds no private fields and keeps searchName in sync", async () => {
  await assertFails(createCard(as("alice"), "alice", { email: "a@b.c" }));
  await assertFails(createCard(as("alice"), "alice", { restingHr: 60 }));
  await assertFails(createCard(as("alice"), "alice", { searchName: "someone else" }));
  await assertFails(createCard(as("alice", false), "alice"));
});

test("handles: owners can switch, nobody can steal or release another handle", async () => {
  await seedCards();
  const db = as("alice");
  const batch = writeBatch(db);
  batch.set(doc(db, "profiles/alice"), card("alice", { handle: "alice_new" }));
  batch.set(doc(db, "handles/alice_new"), { uid: "alice" });
  batch.delete(doc(db, "handles/alice_run"));
  await assertSucceeds(batch.commit());
  await assertFails(deleteDoc(doc(as("mallory"), "handles/bob_run")));
  await assertFails(deleteDoc(doc(as("bob"), "handles/bob_run"))); // still on the card
});

test("search finds only people who chose to be findable", async () => {
  await seedCards({ carol: { discoverable: false } });
  const db = as("mallory");
  await assertSucceeds(getDocs(query(collection(db, "profiles"), where("discoverable", "==", true))));
  await assertFails(getDocs(collection(db, "profiles")));
  await assertFails(getDoc(doc(db, "profiles/carol")));
  await assertSucceeds(getDoc(doc(db, "profiles/bob")));
});

test("a connection request: only to findable people, never on behalf of others", async () => {
  await seedCards({ carol: { discoverable: false } });
  await assertSucceeds(setDoc(doc(as("alice"), "connections/alice_bob"), conn("alice", "bob", "alice")));
  await assertFails(setDoc(doc(as("alice"), "connections/alice_carol"), conn("alice", "carol", "alice")));
  await assertFails(setDoc(doc(as("mallory"), "connections/alice_carol"), conn("alice", "carol", "alice")));
  await assertFails(setDoc(doc(as("alice"), "connections/bob_alice"), { ...conn("alice", "bob", "alice"), users: ["bob", "alice"] }));
  await assertFails(setDoc(doc(as("alice"), "connections/alice_mallory"), conn("alice", "mallory", "alice", "accepted")));
});

test("a stranger cannot read or write a connection; nobody accepts their own request", async () => {
  await seedCards();
  await env.withSecurityRulesDisabled((ctx) =>
    setDoc(doc(ctx.firestore(), "connections/alice_bob"), { ...conn("alice", "bob", "alice"), createdAt: t0 })
  );
  const accept = { status: "accepted", acceptedAt: serverTimestamp() };
  await assertFails(getDoc(doc(as("mallory"), "connections/alice_bob")));
  await assertFails(updateDoc(doc(as("mallory"), "connections/alice_bob"), accept));
  await assertFails(deleteDoc(doc(as("mallory"), "connections/alice_bob")));
  await assertFails(updateDoc(doc(as("alice"), "connections/alice_bob"), accept));
  await assertSucceeds(getDocs(query(collection(as("bob"), "connections"), where("users", "array-contains", "bob"))));
  await assertSucceeds(updateDoc(doc(as("bob"), "connections/alice_bob"), accept));
});

test("friend lists are written only with an accepted connection", async () => {
  await seedCards();
  await assertFails(setDoc(doc(as("mallory"), "users/mallory/friends/alice"), { since: serverTimestamp() }));
  await assertFails(setDoc(doc(as("mallory"), "users/alice/friends/mallory"), { since: serverTimestamp() }));
});

test("a stranger cannot read private data or friend lists, even of a friend", async () => {
  await seedFriends();
  await assertFails(getDoc(doc(as("alice"), "users/bob")));
  await assertFails(getDocs(collection(as("mallory"), "users/bob/friends")));
  await assertFails(getDocs(collection(as("alice"), "users/bob/windows")));
  await assertSucceeds(getDoc(doc(as("alice"), "profiles/bob")));
});

const invite = (from, to, extra = {}) => ({
  from, fromName: "Alice", to, teamCode: CODE, teamName: "Club", status: "pending",
  createdAt: serverTimestamp(), expiresAt: Timestamp.fromMillis(Date.now() + 60 * 60 * 1000), ...extra,
});

test("run invites: friends only, from a member, one per friend per team", async () => {
  await seedFriends();
  const alice = as("alice");
  await assertSucceeds(setDoc(doc(alice, `runInvites/${CODE}_bob`), invite("alice", "bob")));
  await assertFails(setDoc(doc(alice, `runInvites/${CODE}_bob`), invite("alice", "bob"))); // again
  await assertFails(setDoc(doc(alice, `runInvites/${CODE}_carol`), invite("alice", "carol"))); // not a friend
  await assertFails(setDoc(doc(as("bob"), `runInvites/${CODE}_alice`), invite("bob", "alice"))); // not a member
  await assertFails(setDoc(doc(alice, "runInvites/OTHER234_bob"), invite("alice", "bob"))); // wrong id
  await assertFails(setDoc(doc(as("mallory"), `runInvites/${CODE}_bob`), invite("alice", "bob")));
});

test("run invites: limited lifetime, answered by the invited friend, which lets them join", async () => {
  await seedFriends();
  await assertFails(setDoc(doc(as("alice"), `runInvites/${CODE}_bob`),
    invite("alice", "bob", { expiresAt: Timestamp.fromMillis(Date.now() + 5 * 3600 * 1000) })));
  await assertSucceeds(setDoc(doc(as("alice"), `runInvites/${CODE}_bob`), invite("alice", "bob")));
  await assertFails(getDoc(doc(as("mallory"), `runInvites/${CODE}_bob`)));
  await assertFails(updateDoc(doc(as("alice"), `runInvites/${CODE}_bob`), { status: "accepted" }));
  await assertSucceeds(updateDoc(doc(as("bob"), `runInvites/${CODE}_bob`), { status: "accepted" }));
  // a premium team: bob still gets in thanks to the accepted invite, carol does not
  await env.withSecurityRulesDisabled((ctx) => updateDoc(doc(ctx.firestore(), `teams/${CODE}`), { tier: "premium" }));
  await assertSucceeds(setDoc(doc(as("bob"), `teams/${CODE}/members/bob`), member("Bob")));
  await assertFails(setDoc(doc(as("carol"), `teams/${CODE}/members/carol`), member("Carol")));
});

test("accepting writes both friend lists in one batch; removing clears them", async () => {
  await seedCards();
  await env.withSecurityRulesDisabled((ctx) =>
    setDoc(doc(ctx.firestore(), "connections/alice_bob"), { ...conn("alice", "bob", "alice"), createdAt: t0 })
  );
  const bob = as("bob");
  const accept = writeBatch(bob);
  accept.update(doc(bob, "connections/alice_bob"), { status: "accepted", acceptedAt: serverTimestamp() });
  accept.set(doc(bob, "users/bob/friends/alice"), { since: serverTimestamp() });
  accept.set(doc(bob, "users/alice/friends/bob"), { since: serverTimestamp() });
  await assertSucceeds(accept.commit());

  // a friend entry cannot be deleted while the connection still exists
  await assertFails(deleteDoc(doc(as("alice"), "users/alice/friends/bob")));
  const alice = as("alice");
  const remove = writeBatch(alice);
  remove.delete(doc(alice, "connections/alice_bob"));
  remove.delete(doc(alice, "users/alice/friends/bob"));
  remove.delete(doc(alice, "users/bob/friends/alice"));
  await assertSucceeds(remove.commit());
});

test("a pending request lets each side see the other card, even when not findable", async () => {
  await seedCards({ bob: { discoverable: false } });
  await env.withSecurityRulesDisabled((ctx) =>
    setDoc(doc(ctx.firestore(), "connections/alice_bob"), { ...conn("alice", "bob", "bob"), createdAt: t0 })
  );
  await assertSucceeds(getDoc(doc(as("alice"), "profiles/bob")));
  await assertFails(getDoc(doc(as("carol"), "profiles/bob")));
});

// ── Run posts, feed visibility and likes ───────────────────────────────────
const post = (owner, visibility = "public", extra = {}) => ({
  ownerUid: owner,
  author: { name: owner[0].toUpperCase() + owner.slice(1), handle: owner + "_run", avatar: "🏃" },
  createdAt: serverTimestamp(),
  caption: "Easy morning run",
  visibility,
  stats: { distanceM: 5200, seconds: 1800, avgHr: 142, maxHr: 168, alerts: 0, avgTempC: 34.1 },
  trend: [130, 140, 145],
  likeCount: 0,
  ...extra,
});

async function seedPosts() {
  await seedFriends(); // alice and bob are friends; carol and mallory are strangers
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    for (const [id, owner, vis] of [["pub", "bob", "public"], ["fr", "bob", "friends"], ["priv", "bob", "private"]]) {
      await setDoc(doc(db, `posts/${id}`), { ...post(owner, vis), createdAt: t0 });
    }
  });
}

test("posts: created by the owner with their own card, no extra data", async () => {
  await seedCards();
  const alice = as("alice");
  await assertSucceeds(setDoc(doc(alice, "posts/a1"), post("alice")));
  await assertFails(setDoc(doc(alice, "posts/a2"), post("bob")));
  await assertFails(setDoc(doc(alice, "posts/a3"), post("alice", "public", { author: { name: "Bob", handle: "bob_run", avatar: "🏃" } })));
  await assertFails(setDoc(doc(alice, "posts/a4"), post("alice", "public", { likeCount: 50 })));
  await assertFails(setDoc(doc(alice, "posts/a5"), post("alice", "public", { location: { lat: 1, lng: 2 } })));
  await assertFails(setDoc(doc(alice, "posts/a6"), post("alice", "public", { stats: { distanceM: 5, seconds: 10, alerts: 0, samples: [1] } })));
  await assertFails(setDoc(doc(alice, "posts/a7"), post("alice", "public", { caption: "x".repeat(281) })));
});

test("visibility: public for all, friends for friends, private for the owner", async () => {
  await seedPosts();
  const alice = as("alice"); // friend of bob
  const carol = as("carol"); // stranger
  await assertSucceeds(getDoc(doc(alice, "posts/pub")));
  await assertSucceeds(getDoc(doc(alice, "posts/fr")));
  await assertFails(getDoc(doc(alice, "posts/priv")));
  await assertSucceeds(getDoc(doc(carol, "posts/pub")));
  await assertFails(getDoc(doc(carol, "posts/fr")));
  await assertSucceeds(getDoc(doc(as("bob"), "posts/priv")));
  await assertFails(getDoc(doc(as("carol", false), "posts/pub")));
});

test("feed queries: public posts, a friend's posts, and nothing hidden leaks", async () => {
  await seedPosts();
  const { orderBy } = await import("firebase/firestore");
  const alice = as("alice");
  const carol = as("carol");
  await assertSucceeds(getDocs(query(collection(carol, "posts"), where("visibility", "==", "public"), orderBy("createdAt", "desc"))));
  await assertSucceeds(getDocs(query(collection(alice, "posts"), where("ownerUid", "==", "bob"), where("visibility", "==", "friends"))));
  await assertFails(getDocs(query(collection(carol, "posts"), where("ownerUid", "==", "bob"), where("visibility", "==", "friends"))));
  await assertFails(getDocs(query(collection(alice, "posts"), where("ownerUid", "==", "bob"))));
  await assertFails(getDocs(collection(carol, "posts")));
});

test("only the owner edits caption or visibility, or deletes", async () => {
  await seedPosts();
  await assertSucceeds(updateDoc(doc(as("bob"), "posts/pub"), { caption: "Better caption", visibility: "friends" }));
  await assertFails(updateDoc(doc(as("bob"), "posts/fr"), { stats: { distanceM: 99999, seconds: 10, alerts: 0 } }));
  await assertFails(updateDoc(doc(as("alice"), "posts/fr"), { caption: "hacked" }));
  await assertFails(deleteDoc(doc(as("alice"), "posts/fr")));
  await assertSucceeds(deleteDoc(doc(as("bob"), "posts/fr")));
});

test("likes: one per person, the counter moves only with your own like", async () => {
  await seedPosts();
  const { increment } = await import("firebase/firestore");
  const like = (db, delta, add) => {
    const b = writeBatch(db);
    if (add) b.set(doc(db, "posts/pub/likes/carol"), { at: serverTimestamp() });
    else b.delete(doc(db, "posts/pub/likes/carol"));
    b.update(doc(db, "posts/pub"), { likeCount: increment(delta) });
    return b.commit();
  };
  const carol = as("carol");
  await assertFails(updateDoc(doc(carol, "posts/pub"), { likeCount: 1000 }));
  await assertFails(updateDoc(doc(carol, "posts/pub"), { likeCount: increment(1) })); // no like doc
  await assertSucceeds(like(carol, 1, true));
  await assertFails(like(carol, 1, true)); // twice
  await assertFails(setDoc(doc(carol, "posts/pub/likes/alice"), { at: serverTimestamp() })); // for someone else
  await assertSucceeds(like(carol, -1, false));
  // a hidden post cannot be liked
  const b = writeBatch(carol);
  b.set(doc(carol, "posts/fr/likes/carol"), { at: serverTimestamp() });
  b.update(doc(carol, "posts/fr"), { likeCount: increment(1) });
  await assertFails(b.commit());
});

// ── Runs and rating ─────────────────────────────────────────────────────────
const runDoc = (extra = {}) => ({
  startAt: t0, seconds: 1800, distanceM: 5000, avgHr: 140, maxHr: 165, alerts: 0, urgent: false,
  noSignalPct: 0, maxSpeedKmh: 11, avgTempC: 34, avgHumidity: 60, zones: [0, 900, 600, 300, 0],
  driftBpm: 5, endurance: 62, source: "simulated", startHour: 7, ...extra,
});
const ratingState = (rating, extra = {}) => ({
  rating, peak: rating, runsRated: 0, rank: ["Rookie", "Pacer", "Racer"][Math.floor(rating / 1000)],
  lastEventId: "", lastRunAt: null, decayWeeks: 0, updatedAt: serverTimestamp(), ...extra,
});

async function seedRating(rating = 500, extra = {}) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "users/alice/rating/current"), { ...ratingState(rating, extra), updatedAt: t0 });
    await setDoc(doc(db, "users/alice/runs/s1"), runDoc());
  });
}

function rateBatch(db, { eid, kind = "run", refId = "s1", before = 500, delta = 12, state = {} }) {
  const b = writeBatch(db);
  b.set(doc(db, `users/alice/ratingEvents/${eid}`), {
    kind, refId, before, after: before + delta, delta, reasons: ["+12 performance"], createdAt: serverTimestamp(),
  });
  b.set(doc(db, "users/alice/rating/current"), {
    ...ratingState(before + delta), peak: Math.max(before, before + delta), runsRated: kind === "run" ? 1 : 0,
    lastEventId: eid, ...state,
  });
  return b.commit();
}

test("runs: own summaries only, valid fields, no raw data", async () => {
  const alice = as("alice");
  await assertSucceeds(setDoc(doc(alice, "users/alice/runs/s1"), runDoc()));
  await assertFails(setDoc(doc(alice, "users/bob/runs/s1"), runDoc()));
  await assertFails(setDoc(doc(alice, "users/alice/runs/s2"), runDoc({ samples: [1, 2] })));
  await assertFails(setDoc(doc(alice, "users/alice/runs/s3"), runDoc({ zones: [1, 2] })));
  await assertFails(updateDoc(doc(alice, "users/alice/runs/s1"), { distanceM: 99999 }));
});

test("rating starts at 500 and moves only with an event for a real run", async () => {
  const alice = as("alice");
  await assertFails(setDoc(doc(alice, "users/alice/rating/current"), ratingState(900)));
  await assertSucceeds(setDoc(doc(alice, "users/alice/rating/current"), ratingState(500)));
  await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), "users/alice/runs/s1"), runDoc()));
  await assertFails(updateDoc(doc(alice, "users/alice/rating/current"), { rating: 2000, rank: "Racer", peak: 2000, updatedAt: serverTimestamp() }));
  await assertSucceeds(rateBatch(alice, { eid: "run_s1" }));
});

test("rating events: once per run, at most 60, no losses from runs, real run only", async () => {
  await seedRating();
  const alice = as("alice");
  await assertFails(rateBatch(alice, { eid: "run_s1", delta: 61 }));
  await assertFails(rateBatch(alice, { eid: "run_s1", delta: -5 }));
  await assertFails(rateBatch(alice, { eid: "run_nope", refId: "nope" }));
  await assertFails(rateBatch(alice, { eid: "run_other", refId: "s1" }));
  await assertSucceeds(rateBatch(alice, { eid: "run_s1" }));
  await assertFails(rateBatch(alice, { eid: "run_s1", before: 512 })); // the same run twice
  await assertFails(setDoc(doc(as("mallory"), "users/alice/ratingEvents/run_x"), { kind: "run" }));
  await assertFails(getDoc(doc(as("mallory"), "users/alice/rating/current")));
});

test("decay respects the rank shield", async () => {
  await seedRating(1012, { rank: "Pacer" });
  const alice = as("alice");
  await assertFails(rateBatch(alice, { eid: "decay_w1", kind: "decay", refId: "w1", before: 1012, delta: -20 }));
  await assertSucceeds(rateBatch(alice, { eid: "decay_w1", kind: "decay", refId: "w1", before: 1012, delta: -10 }));
});

test("the public card shows only the real rating and rank", async () => {
  await seedCards();
  await seedRating(500);
  const alice = as("alice");
  await assertSucceeds(setDoc(doc(alice, "profiles/alice"), { ...card("alice"), rating: 500, rank: "Rookie" }));
  await assertFails(setDoc(doc(alice, "profiles/alice"), { ...card("alice"), rating: 4000, rank: "Grand Master" }));
  await assertFails(setDoc(doc(alice, "profiles/alice"), { ...card("alice"), rank: "Legend" }));
  await assertSucceeds(setDoc(doc(alice, "profiles/alice"), { ...card("alice"), rank: "Rookie", showRating: false }));
});

// ── Comments and reports ───────────────────────────────────────────────────
const comment = (uid, extra = {}) => ({
  uid, author: { name: uid[0].toUpperCase() + uid.slice(1), handle: uid + "_run", avatar: "🏃" },
  text: "Great run!", createdAt: serverTimestamp(), hidden: false, ...extra,
});

test("comments: only on posts you can see, as yourself, short", async () => {
  await seedPosts();
  await assertSucceeds(setDoc(doc(as("alice"), "posts/fr/comments/c1"), comment("alice")));
  await assertFails(setDoc(doc(as("carol"), "posts/fr/comments/c2"), comment("carol"))); // cannot see the post
  await assertSucceeds(setDoc(doc(as("carol"), "posts/pub/comments/c3"), comment("carol")));
  await assertFails(setDoc(doc(as("carol"), "posts/pub/comments/c4"), comment("alice"))); // as someone else
  await assertFails(setDoc(doc(as("carol"), "posts/pub/comments/c5"), comment("carol", { text: "x".repeat(281) })));
  await assertFails(setDoc(doc(as("carol"), "posts/pub/comments/c6"), comment("carol", { hidden: true })));
});

test("comments: the post owner hides or deletes, others cannot", async () => {
  await seedPosts();
  await assertSucceeds(setDoc(doc(as("carol"), "posts/pub/comments/c1"), comment("carol")));
  await assertFails(updateDoc(doc(as("mallory"), "posts/pub/comments/c1"), { hidden: true }));
  await assertFails(updateDoc(doc(as("carol"), "posts/pub/comments/c1"), { text: "edited after" }));
  await assertSucceeds(updateDoc(doc(as("bob"), "posts/pub/comments/c1"), { hidden: true }));
  await assertFails(deleteDoc(doc(as("mallory"), "posts/pub/comments/c1")));
  await assertSucceeds(deleteDoc(doc(as("bob"), "posts/pub/comments/c1")));
});

test("reports: anyone signed in can report, nobody can read them", async () => {
  const report = { reporter: "carol", postId: "pub", reason: "spam", createdAt: serverTimestamp() };
  await assertSucceeds(setDoc(doc(as("carol"), "reports/r1"), report));
  await assertFails(setDoc(doc(as("carol"), "reports/r2"), { ...report, reporter: "alice" }));
  await assertFails(setDoc(doc(as("carol"), "reports/r3"), { ...report, reason: "nope" }));
  await assertFails(getDoc(doc(as("carol"), "reports/r1")));
});

test("posts may carry endurance and zones, nothing else", async () => {
  await seedCards();
  const stats = { distanceM: 5200, seconds: 1800, avgHr: 142, maxHr: 168, alerts: 0, avgTempC: 34.1, endurance: 72, zones: [0, 900, 600, 300, 0] };
  await assertSucceeds(setDoc(doc(as("alice"), "posts/z1"), post("alice", "public", { stats })));
  await assertFails(setDoc(doc(as("alice"), "posts/z2"), post("alice", "public", { stats: { ...stats, endurance: 150 } })));
});
