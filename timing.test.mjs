import assert from 'node:assert/strict';
import { songPosition, audioElapsed } from './lib/transport.js';
import { extendBeatGrid, beatIndex, beatSlot, fractionalBar, thinChart } from './lib/beat-grid.js';

const tempo = [{ at: 0, pos: 0, rate: 1 }, { at: 10, pos: 10, rate: .5 }, { at: 14, pos: 12, rate: 1 }];
for (const elapsed of [-3, 0, 9.9, 10, 12, 14, 30]) {
  assert.equal(audioElapsed(tempo, songPosition(tempo, elapsed)), elapsed);
}
assert.equal(songPosition(tempo, 12), 11);
assert.equal(audioElapsed(tempo, 13), 15);
const originalBeats = [0, .5, 1, 1.5, 2, 2.5, 3, 3.5, 4];
const source = { beats: originalBeats, downbeat: 0, duration: 4 };
const grid = extendBeatGrid(source, 3, 4);
assert.ok(grid.beats[0] <= -4);
assert.ok(grid.beats.at(-1) >= 10);
assert.equal(originalBeats.length, 9, 'extension does not mutate saved beats');
assert.equal(fractionalBar(grid.bars, 3), 1.5);
assert.equal(beatIndex(originalBeats, -.1), -1);
assert.deepEqual(beatSlot(originalBeats, .49), [1, 0]);
const notes = [[0,0],[.125,1],[.25,2],[.5,0],[.75,1],[1,2]];
// Window {slot 0, 1} holds an on-eighth and an off-sixteenth; {2, 3} of beat 2 holds only the off-sixteenth.
const mixed = [...notes, [1.375,0]];
assert.equal(thinChart(mixed, 3, originalBeats), mixed, 'EXPERT keeps every note');
assert.deepEqual(thinChart(mixed, 2, originalBeats), [[0,0],[.25,2],[.5,0],[.75,1],[1,2],[1.375,0]], 'HARD: one note per eighth window, on-eighth preferred, lone off-sixteenth kept');
assert.deepEqual(thinChart(mixed, 1, originalBeats), [[0,0],[.25,2],[.5,0],[.75,1],[1,2]], 'NORMAL: on-eighth notes only');
assert.deepEqual(thinChart(mixed, 0, originalBeats), [[0,0],[.5,0],[1,2]], 'EASY: one note per beat');
assert.deepEqual(thinChart([[-.2,1],[-.1,2],[4.2,0]], 2, originalBeats), [[-.2,1],[-.1,2],[4.2,0]], 'notes off the grid are not collapsed');
const accelerating = [0];
for (let i = 0; i < 24; i++) accelerating.push(accelerating[i] + .5 - .1 * i / 23);
const accelerated = accelerating.slice();
const longer = extendBeatGrid({ beats: accelerating, downbeat: 0, duration: accelerating.at(-1) }, 3, 4);
const opening = .5 - .1 * 3.5 / 23, closing = .5 - .1 * 19.5 / 23; // medians of the first and last 8 intervals
assert.ok(longer.downbeat > 0);
for (let i = 0; i < longer.downbeat; i++) assert.ok(Math.abs(longer.beats[i + 1] - longer.beats[i] - opening) < 1e-9, 'lead-in beats use the opening interval');
for (let i = accelerating.length - 1 + longer.downbeat; i < longer.beats.length - 1; i++) assert.ok(Math.abs(longer.beats[i + 1] - longer.beats[i] - closing) < 1e-9, 'tail beats use the closing interval');
assert.deepEqual(accelerating, accelerated, 'extending an accelerating grid does not mutate it');
console.log('ok: tempo round trips, slow/recovered clock, non-mutating grid extension, beat slots and difficulty rules');
