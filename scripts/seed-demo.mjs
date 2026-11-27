// Fills the LOCAL emulators with demo runners and their shared runs, to test
// the Home feed, search and friends. It never touches a real Firebase project:
// the addresses below are the local emulators and cannot be changed.
//
//   npm run emulators                        (first terminal)
//   npm run seed:demo                        (second terminal)
//   npm run seed:demo -- --friend my_handle  (also befriend your test account)
import { readFileSync } from "node:fs";

const AUTH = "http://127.0.0.1:9099";
const STORE = "http://127.0.0.1:8085";
const PROJECT = JSON.parse(readFileSync(new URL("../.firebaserc", import.meta.url), "utf8")).projects.default;
const PASSWORD = "Demo-runner-2026";
const OWNER = { Authorization: "Bearer owner", "Content-Type": "application/json" };

const RUNNERS = [
  ["Yasmine Benali", "yasmine", "🏃‍♀️", "Rabat", "regular", "Sunrise runs along the corniche"],
  ["Omar El Idrissi", "omar", "⚡", "Casablanca", "competitive", "Chasing a sub-45 10K"],
  ["Salma Amrani", "salma", "🌿", "Marrakech", "casual", "Running to clear my head"],
  ["Karim Tazi", "karim", "🔥", "Fès", "regular", "Half marathon in spring"],
  ["Nora Haddad", "nora", "🌙", "Tanger", "starting", "Week 3 of my first running plan"],
  ["Youssef Alaoui", "youssef", "🦅", "Agadir", "competitive", "Trail and beach intervals"],
  ["Lina Berrada", "lina", "☀️", "Rabat", "casual", "Weekend long runs with friends"],
  ["Adam Chraibi", "adam", "🦊", "Casablanca", "starting", "Back to running after a break"],
];
const FRIENDS = [["yasmine", "omar"], ["yasmine", "lina"], ["omar", "karim"], ["salma", "nora"], ["youssef", "adam"]];
const CAPTIONS = [
  "Easy pace, felt great today",
  "Hot one! Took water every 15 minutes",
  "Intervals by the sea",
  "Long run before work",
  "First time running without stopping",
  "Recovery jog with the club",
  "New personal best on this loop",
  "",
];
const SPEED = { starting: 7.5, casual: 8.8, regular: 10, competitive: 12.5 };

// ── helpers ────────────────────────────────────────────────────────────────
let seed = 7;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

async function reachable(url) {
  try {
    await fetch(url, { signal: AbortSignal.timeout(15000) });
    return true;
  } catch {
    return false;
  }
}

function value(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(value) } };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === "string") return { stringValue: v };
  return { mapValue: { fields: fields(v) } };
}
const fields = (obj) => Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, value(v)]));

async function put(path, data) {
  const res = await fetch(`${STORE}/v1/projects/${PROJECT}/databases/(default)/documents/${path}`, {
    method: "PATCH",
    headers: OWNER,
    body: JSON.stringify({ fields: fields(data) }),
  });
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
}

async function get(path) {
  const res = await fetch(`${STORE}/v1/projects/${PROJECT}/databases/(default)/documents/${path}`, { headers: OWNER });
  if (!res.ok) return null;
  return (await res.json()).fields;
}

async function account(email) {
  const call = (op) =>
    fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:${op}?key=demo`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: PASSWORD, returnSecureToken: true }),
    }).then((r) => r.json());
  let res = await call("signUp");
  if (res.error?.message === "EMAIL_EXISTS") res = await call("signInWithPassword");
  if (!res.localId) throw new Error(`${email}: ${JSON.stringify(res.error)}`);
  await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts:update`, {
    method: "POST",
    headers: OWNER,
    body: JSON.stringify({ localId: res.localId, emailVerified: true }),
  });
  return res.localId;
}

async function befriend(a, b, since) {
  const [x, y] = [a, b].sort();
  await put(`connections/${x}_${y}`, { users: [x, y], requester: x, status: "accepted", createdAt: since, acceptedAt: since });
  await put(`users/${a}/friends/${b}`, { since });
  await put(`users/${b}/friends/${a}`, { since });
}

function heartTrend(level, minutes) {
  const top = { starting: 162, casual: 155, regular: 150, competitive: 158 }[level];
  const n = Math.min(60, Math.max(8, Math.round(minutes * 2)));
  return Array.from({ length: n }, (_, i) => {
    const warm = Math.min(1, i / (n * 0.2));
    const drift = (i / n) * 6;
    return Math.round(95 + (top - 95) * warm + drift + (rand() - 0.5) * 6);
  });
}

// ── run ────────────────────────────────────────────────────────────────────
if (!(await reachable(AUTH)) || !(await reachable(STORE))) {
  console.error("Start the local emulators first: npm run emulators");
  process.exit(1);
}

const uids = {};
const now = Date.now();
for (const [name, key, avatar, city, level, bio] of RUNNERS) {
  const uid = await account(`demo.${key}@example.test`);
  uids[key] = uid;
  const handle = `demo_${key}`;
  const created = new Date(now - 30 * 86400000);
  await put(`users/${uid}`, { displayName: name, age: 20 + Math.floor(rand() * 25), role: "athlete", runner: `${level === "starting" ? "not a runner" : "regular runner"}`, consentAt: created, updatedAt: created });
  await put(`handles/${handle}`, { uid });
  await put(`profiles/${uid}`, {
    displayName: name,
    searchName: name.toLowerCase(),
    handle,
    avatar,
    bio: `Demo account · ${bio}`,
    city,
    runnerLevel: level,
    discoverable: true,
    updatedAt: created,
  });

  const posts = 2 + Math.floor(rand() * 2);
  for (let i = 0; i < posts; i++) {
    const minutes = 18 + Math.floor(rand() * 45);
    const speed = SPEED[level] * (0.9 + rand() * 0.2);
    const trend = heartTrend(level, minutes);
    const hot = rand() < 0.3;
    await put(`posts/demo_${key}_${i}`, {
      ownerUid: uid,
      author: { name, handle, avatar },
      createdAt: new Date(now - Math.floor(rand() * 7 * 86400000)),
      caption: CAPTIONS[Math.floor(rand() * CAPTIONS.length)],
      visibility: i === 1 ? "friends" : "public",
      stats: {
        distanceM: Math.round((speed / 3.6) * minutes * 60),
        seconds: minutes * 60,
        avgHr: Math.round(trend.reduce((a, b) => a + b, 0) / trend.length),
        maxHr: Math.max(...trend),
        alerts: hot && rand() < 0.5 ? 1 : 0,
        avgTempC: Math.round((hot ? 36.5 + rand() : 34 + rand() * 1.5) * 10) / 10,
      },
      trend,
      likeCount: 0,
    });
  }
}

for (const [a, b] of FRIENDS) await befriend(uids[a], uids[b], new Date(now - 10 * 86400000));

// a few likes from other demo runners (counter kept in step with the like docs)
const keys = Object.keys(uids);
for (const key of keys) {
  const likers = keys.filter((k) => k !== key && rand() < 0.4);
  for (const liker of likers) await put(`posts/demo_${key}_0/likes/${uids[liker]}`, { at: new Date(now - 3600000) });
  const post = await get(`posts/demo_${key}_0`);
  if (post) await put(`posts/demo_${key}_0`, { ...decode(post), likeCount: likers.length });
}

function decode(f) {
  const v = (x) =>
    "stringValue" in x ? x.stringValue
    : "integerValue" in x ? Number(x.integerValue)
    : "doubleValue" in x ? x.doubleValue
    : "booleanValue" in x ? x.booleanValue
    : "timestampValue" in x ? new Date(x.timestampValue)
    : "arrayValue" in x ? (x.arrayValue.values ?? []).map(v)
    : "mapValue" in x ? decode(x.mapValue.fields ?? {})
    : null;
  return Object.fromEntries(Object.entries(f).map(([k, x]) => [k, v(x)]));
}

// a ready test account: signed up, verified, with a public card and 3 demo friends
const TEST_EMAIL = "test.runner@example.test";
const me = await account(TEST_EMAIL);
const joined = new Date(now - 2 * 86400000);
await put(`users/${me}`, { displayName: "Test Runner", age: 24, role: "athlete", restingHr: 60, consentAt: joined, updatedAt: joined });
await put("handles/test_runner", { uid: me });
await put(`profiles/${me}`, {
  displayName: "Test Runner",
  searchName: "test runner",
  handle: "test_runner",
  avatar: "🏃",
  bio: "Demo account · my test profile",
  city: "Rabat",
  runnerLevel: "casual",
  discoverable: true,
  updatedAt: joined,
});
for (const key of ["yasmine", "omar", "salma"]) await befriend(me, uids[key], joined);

// optional: befriend a test account by its handle
const at = process.argv.indexOf("--friend");
if (at > 0) {
  const handle = (process.argv[at + 1] ?? "").replace(/^@/, "").toLowerCase();
  const owner = handle && (await get(`handles/${handle}`));
  if (!owner) console.warn(`No public card with @${handle} in the emulator. Create it in the app first.`);
  else {
    for (const uid of Object.values(uids)) await befriend(owner.uid.stringValue, uid, new Date());
    console.log(`@${handle} is now friends with every demo runner.`);
  }
}

console.log(`Seeded ${RUNNERS.length} demo runners in the emulator (project ${PROJECT}).`);
console.log(`Your test account: ${TEST_EMAIL} / ${PASSWORD} (friends with Yasmine, Omar and Salma).`);
console.log(`Demo runners: demo.<name>@example.test / ${PASSWORD}, e.g. demo.karim@example.test.`);
