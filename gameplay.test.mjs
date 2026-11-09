import assert from "node:assert/strict";
import {
  createRunState,
  createTracks,
  recordHit,
  recordCapture,
  recordMiss,
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
  captures: 0,
  groove: 100,
  missStreak: 0,
  currentTrack: 0,
});
console.log(
  "ok: independent run state, capture score, miss failure, hit exclusion and silent-track switching",
);
