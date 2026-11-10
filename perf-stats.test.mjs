import assert from "node:assert/strict";
import { createFrameStats } from "./lib/perf-stats.js";

// Percentiles use nearest rank over script times 1..100 ms.
const series = createFrameStats(200);
for (let ms = 100; ms >= 1; ms--) series.record(ms, 16.7);
const known = series.summary();
assert.equal(known.frames, 100);
assert.equal(known.p50, 50);
assert.equal(known.p95, 95);
assert.equal(known.p99, 99);
assert.equal(known.longFrames, 50, "script times above 50 ms");
assert.equal(known.dropped, 0);

// One frame in ten takes two display intervals, at either refresh rate.
for (const interval of [1000 / 60, 1000 / 120]) {
  const stats = createFrameStats();
  for (let i = 0; i < 1000; i++)
    stats.record(1, i % 10 === 9 ? 2 * interval : interval);
  assert.ok(Math.abs(stats.summary().dropped - 0.1) < 1e-9, `${interval} ms`);
}
// Jitter below 1.5 intervals is not a dropped frame.
const jitter = createFrameStats();
for (let i = 0; i < 100; i++) jitter.record(1, i % 2 ? 15 : 18);
assert.equal(jitter.summary().dropped, 0);

// Past capacity the ring keeps only the newest frames.
const ring = createFrameStats(4);
for (const ms of [90, 1, 2, 3]) ring.record(ms, 16.7);
assert.equal(ring.summary().p99, 90, "full ring, nothing overwritten yet");
assert.equal(ring.summary().longFrames, 1);
ring.record(4, 16.7);
const wrapped = ring.summary();
assert.equal(wrapped.frames, 4);
assert.equal(wrapped.p99, 4, "the oldest frame is overwritten");
assert.equal(wrapped.longFrames, 0);

const empty = createFrameStats().summary();
assert.deepEqual(empty, {
  frames: 0,
  p50: 0,
  p95: 0,
  p99: 0,
  dropped: 0,
  longFrames: 0,
});
console.log(
  "ok: nearest-rank percentiles, dropped frames at 60 and 120 Hz, ring wrap and empty runs",
);
