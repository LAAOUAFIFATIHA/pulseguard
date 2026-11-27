// Firebase Auth + Firestore for the signed-in user.
//
//   users/{uid}                      profile, consent, team code
//   users/{uid}/windows/{id}         10 s summaries (never raw signals)
//   users/{uid}/events/{id}          anomaly events
//   teams/{code}                     team name and owner
//   teams/{code}/members/{uid}       what a member shares with the team
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

// ── Export, sign out, delete ──────────────────────────────────────────────
const plain = (data) =>
  Object.fromEntries(
    Object.entries(data).map(([k, v]) => [k, v instanceof Timestamp ? v.toDate().toISOString() : v])
  );

export async function exportAll() {
  const [me, windows, events] = await Promise.all([getDoc(userRef()), getDocs(sub("windows")), getDocs(sub("events"))]);
  const code = me.data()?.teamId;
  const shared = code ? await getDoc(memberRef(code)).catch(() => null) : null;
  return {
    exportedAt: new Date().toISOString(),
    email: auth.currentUser.email,
    profile: me.exists() ? plain(me.data()) : null,
    sharedWithTeam: shared?.exists() ? plain(shared.data()) : null,
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

  const code = profile?.teamId;
  if (code) {
    await deleteDoc(memberRef(code)).catch(() => {});
    const team = await getTeam(code).catch(() => null);
    if (team?.ownerUid === user.uid) await deleteDoc(teamRef(code)).catch(() => {});
  }
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
