import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeHandle,
  searchName,
  connectionId,
  otherUid,
  sortConnections,
  parseQuery,
  prefixEnd,
  mergeResults,
  inviteId,
  isExpired,
} from "../src/social.js";

test("handles: 3-20 characters, lowercase letters, digits and _", () => {
  assert.equal(normalizeHandle(" @Fatiha_R "), "fatiha_r");
  assert.equal(normalizeHandle("ab"), "");
  assert.equal(normalizeHandle("a".repeat(21)), "");
  assert.equal(normalizeHandle("bad-name"), "");
  assert.equal(normalizeHandle("été"), "");
  assert.equal(normalizeHandle("runner_42"), "runner_42");
});

test("connection id is the same from both sides", () => {
  assert.equal(connectionId("bob", "alice"), "alice_bob");
  assert.equal(connectionId("alice", "bob"), "alice_bob");
  assert.equal(otherUid({ users: ["alice", "bob"] }, "alice"), "bob");
});

test("connections are split into incoming, outgoing and friends", () => {
  const c = (id, requester, status) => ({ id, requester, status, users: ["me", id] });
  const r = sortConnections([c("a", "a", "pending"), c("b", "me", "pending"), c("c", "c", "accepted")], "me");
  assert.deepEqual(r.incoming.map((x) => x.id), ["a"]);
  assert.deepEqual(r.outgoing.map((x) => x.id), ["b"]);
  assert.deepEqual(r.friends.map((x) => x.id), ["c"]);
});

test("search: at least 2 characters, @ means handle only", () => {
  assert.deepEqual(parseQuery("  Fa "), { q: "fa", handleOnly: false });
  assert.deepEqual(parseQuery("@run"), { q: "run", handleOnly: true });
  assert.equal(parseQuery("f").q, "");
  assert.ok(prefixEnd("fa") > "fatiha" && "fatiha" >= "fa");
  assert.ok(!("fb" < prefixEnd("fa")));
  assert.equal(searchName("  Fatiha L "), "fatiha l");
});

test("search results: no duplicates, never myself, at most 10", () => {
  const card = (uid) => ({ uid });
  const many = Array.from({ length: 15 }, (_, i) => card("u" + i));
  const r = mergeResults([[card("me"), card("a"), card("b")], [card("a"), ...many]], "me");
  assert.equal(r.length, 10);
  assert.deepEqual(r.slice(0, 3).map((x) => x.uid), ["a", "b", "u0"]);
});

test("run invites: one per friend per team, expire after their time", () => {
  assert.equal(inviteId("ABCD2345", "bob"), "ABCD2345_bob");
  assert.equal(isExpired({ expiresAtMs: 1000 }, 999), false);
  assert.equal(isExpired({ expiresAtMs: 1000 }, 1000), true);
});
