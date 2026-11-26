// Session history in Firestore. Each browser signs in anonymously and can only
// read and write its own data (see firestore.rules).
//
//   users/{uid}/sessions/{sessionId}              summary of one recording
//   users/{uid}/sessions/{sessionId}/chunks/{i}   10 s of ECG + labels
//   users/{uid}/sessions/{sessionId}/answers/{id} AI coach / doctor answers
//
// Writes are not awaited: offline, Firestore keeps them locally and sends them
// when the connection returns.
import { getAuth, signInAnonymously } from "firebase/auth";
import {
  initializeFirestore,
  persistentLocalCache,
  collection,
  doc,
  setDoc,
  getDocs,
  deleteDoc,
  query,
  orderBy,
  limit,
  Bytes,
} from "firebase/firestore";
import { app } from "./firebase.js";
import { decodeSamples } from "./recorder.js";

const auth = getAuth(app);
const db = initializeFirestore(app, { localCache: persistentLocalCache() });

export async function signIn() {
  await auth.authStateReady();
  return auth.currentUser ?? (await signInAnonymously(auth)).user;
}

const sessionsRef = () => collection(db, "users", auth.currentUser.uid, "sessions");

/** Returns a handle for one recording. Call signIn() first. */
export function openSession({ onError, getProfile }) {
  const ref = doc(sessionsRef());
  const startedAt = Date.now();
  const write = (target, data) => setDoc(target, data, { merge: true }).catch(onError);

  return {
    saveChunk(chunk, summary) {
      write(doc(ref, "chunks", String(chunk.index).padStart(6, "0")), {
        ...chunk,
        samples: Bytes.fromUint8Array(chunk.samples),
        accel: Bytes.fromUint8Array(chunk.accel),
      });
      write(ref, {
        startedAt,
        updatedAt: Date.now(),
        chunkCount: chunk.index + 1,
        source: "simulator",
        profile: getProfile(),
        body: summary.body ?? null,
        durationSec: summary.durationSec,
        avgHr: summary.overall?.avg ?? null,
        minHr: summary.overall?.min ?? null,
        maxHr: summary.overall?.max ?? null,
        alerts: summary.events.map(({ type, start, end }) => ({ type, start, end })),
      });
    },
    saveAnswer({ kind, prompt, text, source }) {
      write(doc(collection(ref, "answers")), { at: Date.now(), kind, prompt, text, source: source ?? null });
    },
  };
}

export async function listSessions(max = 10) {
  const snap = await getDocs(query(sessionsRef(), orderBy("startedAt", "desc"), limit(max)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/** One session as plain JSON, ready for a Python training script. */
export async function exportSession(id, profile = null) {
  const ref = doc(sessionsRef(), id);
  const snap = await getDocs(query(collection(ref, "chunks"), orderBy("index")));
  return {
    sessionId: id,
    profile,
    units: { samples: "mV", accel: "g", tempC: "°C", humidity: "%" },
    chunks: snap.docs.map((d) => {
      const c = d.data();
      return {
        ...c,
        samples: decodeSamples(c.samples.toUint8Array()),
        accel: c.accel ? decodeSamples(c.accel.toUint8Array()) : [],
      };
    }),
  };
}

export async function saveProfile(profile) {
  await setDoc(doc(db, "users", auth.currentUser.uid), { profile });
}

export async function deleteSession(id) {
  const ref = doc(sessionsRef(), id);
  for (const name of ["chunks", "answers"]) {
    const snap = await getDocs(collection(ref, name));
    await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
  }
  await deleteDoc(ref);
}
