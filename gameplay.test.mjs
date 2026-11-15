import assert from "node:assert/strict";
import {
  createRunState,
  createTracks,
  recordHit,
  recordCapture,
  recordMiss,
  recordStray,
  accuracy,
  STRAY_GROOVE,
  applyGroove,
  findHittableNote,
  nextTrack,
  startHold,
  endHold,
  HOLD_SCORE,
  encoreOpen,
  recordEncoreHit,
  recordEncore,
  recordEncoreStray,
  ENCORE_BARS,
  ENCORE_BONUS,
} from "./lib/gameplay.js";
const run = createRunState();
const tracks = createTracks(
  [
    {
      name: "DRUMS",
      notes: [
        [0, 0],
        [0.5, 1],
      ],
    },
    { name: "SILENT", notes: [] },
    { name: "BASS", notes: [[0, 0]] },
  ],
  ["red", "white", "blue"],
  2,
  [0, 0.5, 1],
  [0, 2],
);
assert.equal(nextTrack(tracks, 0, 1), 2);
assert.equal(nextTrack(tracks, 2, 1), -1);
const track = tracks[0],
  note = findHittableNote(track, 0, 0, 0.1, (t) => t);
assert.equal(note, track.notes[0]);
const hit = recordHit(run, track, note, 0, 0.035);
applyGroove(run, hit.grooveGain);
assert.equal(run.score, 15);
assert.equal(run.hits, 1);
assert.equal(
  findHittableNote(track, 0, 0, 0.1, (t) => t),
  undefined,
);
const bonus = recordCapture(run, track, 0, 1, 8);
assert.equal(bonus, 100);
assert.equal(run.score, 115);
assert.equal(run.multiplier, 2);
assert.equal(track.capTo, 10);
let rate = 1;
for (let i = 0; i < 14; i++) rate = applyGroove(run, recordMiss(run, track));
assert.equal(rate, 0);
assert.equal(run.groove, 0);
assert.deepEqual(createRunState(), {
  score: 0,
  multiplier: 1,
  hits: 0,
  misses: 0,
  strays: 0,
  captures: 0,
  groove: 100,
  missStreak: 0,
  currentTrack: 0,
  bonusHits: 0,
  encores: 0,
  encoreTrack: -1,
  encoreVoid: -1,
});
console.log(
  "ok: independent run state, capture score, miss failure, hit exclusion and silent-track switching",
);

{
  const stray = createRunState();
  const lane = { live: true };
  stray.multiplier = 4;
  stray.missStreak = 2;
  stray.misses = 1;
  stray.hits = 6;
  assert.equal(recordStray(stray, lane), STRAY_GROOVE);
  assert.equal(STRAY_GROOVE, -2);
  assert.equal(stray.multiplier, 1, "a stray breaks the multiplier");
  assert.equal(stray.strays, 1);
  assert.equal(lane.live, false, "the stem drops to cue volume");
  assert.deepEqual([stray.missStreak, stray.misses], [2, 1], "miss streak and misses untouched");
  assert.equal(accuracy(stray), 6 / 8, "strays count against accuracy");
  console.log("ok: strays reset the multiplier, cost groove and count against accuracy");
}

{
  // Holds: a head judged like a tap, then the key stays down to the tail. Sixteenths are .125 s here.
  const sixteenths = (from, to) => (to - from) * 8;
  const beats = [0, 0.5, 1, 1.5, 2, 2.5, 3];
  const build = (notes) => createTracks([{ name: "BASS", notes }], ["red"], 3, beats, [0, 2])[0];
  const play = (notes) => {
    const r = createRunState(),
      t = build(notes),
      n = t.notes[0];
    r.multiplier = 2;
    const { perfect } = recordHit(r, t, n, 0, 0.035);
    startHold(t, n);
    return { r, t, n, perfect, before: r.score };
  };
  const tap = build([[0, 0]]);
  assert.equal(tap.notes[0].len, 0, "taps have no length");
  assert.equal(tap.maxHold, 0);

  let h = play([[0, 0, 1]]);
  assert.equal(h.t.maxHold, 1);
  assert.deepEqual([h.n.holding, h.t.holds.length, h.before], [true, 1, 30], "head scores like a tap");
  let end = endHold(h.r, h.t, h.n, 1, 0.09, sixteenths);
  assert.deepEqual(end, { complete: true, grooveGain: 1 }, "a hold carried to the tail restores 1 groove");
  assert.equal(h.r.score - h.before, HOLD_SCORE * 2 * 8, "2 x multiplier per sixteenth of its length");
  assert.deepEqual([h.n.holding, h.n.broken, h.t.holds.length], [false, false, 0]);

  h = play([[0, 0, 1]]);
  end = endHold(h.r, h.t, h.n, 1 - 0.05, 0.09, sixteenths);
  assert.equal(end.complete, true, "releasing within one hit window of the tail still completes");
  assert.equal(h.r.score - h.before, HOLD_SCORE * 2 * 8);

  h = play([[0, 0, 1]]);
  h.t.live = true;
  end = endHold(h.r, h.t, h.n, 0.5, 0.09, sixteenths);
  assert.deepEqual(end, { complete: false, grooveGain: 0 }, "an early release costs nothing else");
  assert.equal(h.r.score - h.before, HOLD_SCORE * 2 * 4, "scores the sixteenths actually held");
  assert.deepEqual([h.n.broken, h.n.ended, h.t.live, h.t.holds.length], [true, true, false, 0], "the stem drops to cue volume");

  // A missed head is a miss as today, and its tail cannot be picked up.
  const m = build([[0, 0, 1]]);
  m.notes[0].missed = true;
  assert.equal(findHittableNote(m, 0, 0.5, 0.09, (t) => t), undefined);

  // Phrase capture needs every head, not the tail: a phrase ending in a hold captures while it is still held.
  const c = build([[0, 0], [0.5, 1, 1]]);
  const r = createRunState();
  for (const n of c.notes) {
    recordHit(r, c, n, 0, 0.035);
    startHold(c, n);
  }
  assert.ok(c.notes.every((n) => n.hit), "every head hit");
  assert.equal(c.notes[1].holding, true, "the last note is still held");
  assert.equal(recordCapture(r, c, 0, 1, 8), 100);
  console.log("ok: holds score by sixteenth, complete within a window of the tail, break early, and never block capture");
}

{
  // Encores: while the band is IN SYNC the current track's AUTO notes can be played for a bonus.
  const beats = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4];
  const set = createTracks(
    [
      { name: "A", notes: [[0, 0], [0.5, 1]] },
      { name: "B", notes: [[0, 2]] },
    ],
    ["red", "blue"],
    3,
    beats,
    [0, 2, 4],
  );
  for (const t of set) [t.capFrom, t.capTo] = [0, 2];
  const [a, b] = set;
  const r = createRunState();
  r.multiplier = 3;
  const before = accuracy(r);
  assert.equal(findHittableNote(a, 0, 0, 0.1, (t) => t), undefined, "AUTO notes are not hittable normally");
  assert.equal(findHittableNote(a, 0, 0, 0.1, (t) => t, true), a.notes[0], "but are in an encore");
  assert.equal(encoreOpen(r, false), false, "no encore without sync");
  assert.equal(encoreOpen(r, true), true);

  recordEncoreHit(r, a.notes[0], 0, 0.035);
  assert.deepEqual([r.score, r.bonusHits, r.hits, a.hits, accuracy(r)], [90, 1, 0, 0, before], "2 x 15 x multiplier; accuracy untouched");
  recordEncoreHit(r, a.notes[1], 0.05, 0.035);
  assert.equal(r.score, 90 + 60, "a non-perfect hit is 2 x 10 x multiplier");

  const bonus = recordEncore(r, set, 0, () => true);
  assert.equal(bonus, ENCORE_BONUS * 3);
  assert.deepEqual([a.capTo, b.capTo, r.encores, r.encoreTrack], [2 + ENCORE_BARS, 2 + ENCORE_BARS, 1, 0], "every locked track is extended");
  assert.equal(encoreOpen(r, true), false, "the track that gave the encore must pass it on");
  r.currentTrack = 1;
  assert.equal(encoreOpen(r, true), true, "a second track can encore");
  recordEncore(r, set, 1, (t) => t === a);
  assert.deepEqual([a.capTo, b.capTo, r.encores, r.encoreTrack], [2 + 2 * ENCORE_BARS, 2 + ENCORE_BARS, 2, 1], "only locked tracks are extended");

  r.multiplier = 4;
  r.groove = 80;
  recordEncoreStray(r, 3);
  assert.deepEqual([r.multiplier, r.encoreVoid, r.groove, r.strays, r.misses], [1, 3, 80, 0, 0], "a stray voids the phrase and breaks the multiplier only");
  console.log("ok: encore hits double-score outside accuracy, extend every locked track and pass between tracks");
}
