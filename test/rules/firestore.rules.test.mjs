// Security rules tests (Firestore emulator):  npm run test:rules
import { test, before, after, beforeEach } from "node:test";
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import {
  doc, getDoc, setDoc, updateDoc, deleteDoc, getDocs, collection, serverTimestamp, Timestamp,
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
