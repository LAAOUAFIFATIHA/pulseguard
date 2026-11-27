// Merges several newest-first post sources into one feed, page by page.
// Pure logic: `fetchPage(source, cursor)` is injected (Firestore in the app,
// arrays in the tests). It returns { items, cursor, done }.

export const PAGE = 10;

const time = (p) => p.createdAtMs ?? 0;

export function createFeedMerger(sourceIds, fetchPage, pageSize = PAGE) {
  const sources = sourceIds.map((id) => ({ id, cursor: null, done: false, buffer: [] }));
  const seen = new Set();

  async function fill(src) {
    if (src.done || src.buffer.length) return;
    const { items, cursor, done } = await fetchPage(src.id, src.cursor);
    src.cursor = cursor;
    src.done = done;
    src.buffer.push(...items.filter((p) => !seen.has(p.id)));
  }

  return {
    async next() {
      const page = [];
      while (page.length < pageSize) {
        await Promise.all(sources.map(fill));
        let best = null;
        for (const src of sources) {
          if (src.buffer.length && (!best || time(src.buffer[0]) > time(best.buffer[0]))) best = src;
        }
        if (!best) break;
        const post = best.buffer.shift();
        if (seen.has(post.id)) continue; // the same post can come from two sources
        seen.add(post.id);
        page.push(post);
      }
      return page;
    },
    get done() {
      return sources.every((s) => s.done && !s.buffer.length);
    },
  };
}

/** Up to `max` evenly spaced values, for a small chart. */
export function downsample(values, max = 60) {
  const v = values.filter((x) => x != null);
  if (v.length <= max) return v.map((x) => Math.round(x));
  return Array.from({ length: max }, (_, i) => Math.round(v[Math.floor((i * (v.length - 1)) / (max - 1))]));
}
