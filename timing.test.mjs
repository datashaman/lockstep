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
assert.equal(thinChart(notes, 2, originalBeats), notes);
assert.deepEqual(thinChart(notes, 1, originalBeats), [[0,0],[.25,2],[.5,0],[.75,1],[1,2]]);
assert.deepEqual(thinChart(notes, 0, originalBeats), [[0,0],[.5,0],[1,2]]);
console.log('ok: tempo round trips, slow/recovered clock, non-mutating grid extension, beat slots and difficulty rules');
