// Firebase Auth + Firestore for the signed-in user.
//
//   users/{uid}                profile and consent
//   users/{uid}/windows/{id}   10 s summaries (never raw signals)
//   users/{uid}/events/{id}    anomaly events
//
// firestore.rules enforces ownership, verified email and field validation.
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
  Timestamp,
  query,
  orderBy,
  limit,
} from "firebase/firestore";
import { app } from "./firebase.js";

export const auth = getAuth(app);
const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});

// Local testing only: `VITE_USE_EMULATORS=1 npm run dev`
if (import.meta.env.DEV && import.meta.env.VITE_USE_EMULATORS === "1") {
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
}

const uid = () => auth.currentUser.uid;
const userRef = () => doc(db, "users", uid());
const sub = (name) => collection(db, "users", uid(), name);

// ── Profile ───────────────────────────────────────────────────────────────
let profile = null;
export const getProfile = () => profile;

export async function loadProfile() {
  const snap = await getDoc(userRef());
  profile = snap.exists() ? snap.data() : null;
  return profile;
}

const NUMBER_FIELDS = { age: true, restingHr: true, heightCm: true, weightKg: true };

/** Keeps only the allowed, non-empty fields; whole numbers. */
function clean(input) {
  const out = {};
  for (const key of ["displayName", "age", "restingHr", "role", "sex", "runner", "heightCm", "weightKg"]) {
    const value = input[key];
    if (value === undefined || value === null || value === "") continue;
    out[key] = NUMBER_FIELDS[key] ? Math.round(Number(value)) : String(value).trim();
  }
  return out;
}

/** `input` replaces the profile; the consent date is set once and kept. */
export async function saveProfile(input) {
  const next = {
    ...clean(input),
    consentAt: profile?.consentAt ?? Timestamp.now(),
    updatedAt: serverTimestamp(),
  };
  const write = setDoc(userRef(), next);
  profile = next;
  await write;
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

export async function recentEvents(max = 10) {
  const snap = await getDocs(query(sub("events"), orderBy("startAt", "desc"), limit(max)));
  return snap.docs.map((d) => d.data());
}

// ── Export, sign out, delete ──────────────────────────────────────────────
const plain = (data) =>
  Object.fromEntries(
    Object.entries(data).map(([k, v]) => [k, v instanceof Timestamp ? v.toDate().toISOString() : v])
  );

export async function exportAll() {
  const [me, windows, events] = await Promise.all([getDoc(userRef()), getDocs(sub("windows")), getDocs(sub("events"))]);
  return {
    exportedAt: new Date().toISOString(),
    email: auth.currentUser.email,
    profile: me.exists() ? plain(me.data()) : null,
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
  for (const name of ["windows", "events"]) {
    const { docs } = await getDocs(sub(name));
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
