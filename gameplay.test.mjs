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
