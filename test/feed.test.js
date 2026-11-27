import { test } from "node:test";
import assert from "node:assert/strict";
import { createFeedMerger, downsample } from "../src/feed.js";

/** Fake newest-first sources that serve `size` items per call. */
function fakeSources(data, size = 3) {
  const calls = [];
  const fetchPage = async (id, cursor) => {
    calls.push(id);
    const list = data[id];
    const start = cursor ?? 0;
    const items = list.slice(start, start + size);
    return { items, cursor: start + items.length, done: start + items.length >= list.length };
  };
  return { fetchPage, calls };
}

const p = (id, t) => ({ id, createdAtMs: t });

test("the feed merges sources newest first, page by page", async () => {
  const { fetchPage } = fakeSources({
    public: [p("a", 90), p("b", 70), p("c", 50), p("d", 10)],
    friends: [p("e", 80), p("f", 60), p("g", 5)],
    mine: [p("h", 75)],
  });
  const feed = createFeedMerger(["public", "friends", "mine"], fetchPage, 4);
  assert.deepEqual((await feed.next()).map((x) => x.id), ["a", "e", "h", "b"]);
  assert.deepEqual((await feed.next()).map((x) => x.id), ["f", "c", "d", "g"]);
  assert.deepEqual(await feed.next(), []);
  assert.equal(feed.done, true);
});

test("a post found in two sources appears once", async () => {
  const { fetchPage } = fakeSources({ public: [p("x", 9), p("y", 5)], mine: [p("x", 9), p("z", 1)] });
  const feed = createFeedMerger(["public", "mine"], fetchPage, 10);
  assert.deepEqual((await feed.next()).map((x) => x.id), ["x", "y", "z"]);
});

test("an empty feed is done at once", async () => {
  const { fetchPage } = fakeSources({ public: [] });
  const feed = createFeedMerger(["public"], fetchPage);
  assert.deepEqual(await feed.next(), []);
  assert.equal(feed.done, true);
});

test("chart values are thinned to at most 60 points", () => {
  assert.deepEqual(downsample([70.4, null, 80.6]), [70, 81]);
  const d = downsample(Array.from({ length: 300 }, (_, i) => i), 60);
  assert.equal(d.length, 60);
  assert.equal(d[0], 0);
  assert.equal(d.at(-1), 299);
});
