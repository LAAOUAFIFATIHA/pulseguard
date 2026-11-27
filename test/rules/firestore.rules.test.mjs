// Security rules tests (Firestore emulator):  npm run test:rules
import { test, before, after, beforeEach } from "node:test";
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import {
  doc, getDoc, setDoc, updateDoc, deleteDoc, getDocs, collection, serverTimestamp, Timestamp, query, where,
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
