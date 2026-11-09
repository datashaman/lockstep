import assert from 'node:assert/strict';
import { createStemPlayer } from './lib/stem-player.js';
import { createAudioHarness } from './test/audio-context.mjs';

const { AudioContext, nodes, countEdges } = createAudioHarness();
const context = new AudioContext();
const output = context.createGain();
const player = createStemPlayer(context, output);
const preview = createStemPlayer(context, output);
const buffers = Array.from({length:4}, () => context.createBuffer(2, 44100));
const sourcesSince = index => nodes.slice(index).filter(node => node.kind === 'buffer');
const baseline = countEdges();
for (let cycle = 0; cycle < 20; cycle++) {
  const first = nodes.length;
  player.start(buffers, 3);
  const sources = sourcesSince(first);
  assert.deepEqual(sources.map(source => source.starts), [[3],[3],[3],[3]]);
  assert.ok(sources.every(source => source.buffer === buffers[sources.indexOf(source)]));
  assert.ok(player.playing);
  player.setRate(.65, 5);
  for (const source of sources) assert.deepEqual(source.playbackRate.events, [['set',.65,5]]);
  context.currentTime = 4;
  player.setLevel(2, .35); player.setLevel(2, .35);
  const gain = [...sources[2].edges][0];
  assert.deepEqual(gain.gain.events, [['target',.35,4,.02]], 'unchanged levels do not schedule duplicate automation');
  sources[0].onended();
  assert.equal(sources[0].edges.size, 0);
  assert.ok(player.playing, 'remaining stems keep playing after one ends');
  player.setLevel(2, 1);
  assert.deepEqual(gain.gain.events.at(-1), ['target',1,4,.02], 'track indices survive another stem ending');
  player.stop(); player.stop();
  assert.equal(player.playing, false); assert.equal(countEdges(), baseline);
  assert.equal(sources[0].stops.length, 0, 'naturally ended sources are not stopped again');
}

let first = nodes.length;
preview.start(buffers, 10, { volume: .35, loop: {from:30,to:120} });
const previewSources = sourcesSince(first);
for (const source of previewSources) {
  assert.equal(source.loop, true); assert.equal(source.loopStart, 30); assert.equal(source.loopEnd, 120);
  assert.deepEqual(source.starts, [10]); assert.deepEqual(source.offsets, [30]);
  assert.equal([...source.edges][0].gain.value, .35);
}
const previewEdges = countEdges();
player.start(buffers, 15); player.stop();
assert.equal(countEdges(), previewEdges, 'gameplay and preview ownership is independent');
preview.start(buffers, 20, { volume: .35, loop: {from:5,to:40} });
assert.ok(previewSources.every(source => source.edges.size === 0 && source.stops.length === 1), 'replacement releases previous preview');
preview.stop(); assert.equal(countEdges(), baseline);

first = nodes.length;
player.start(buffers, 0);
for (const source of sourcesSince(first)) source.onended();
assert.equal(player.playing, false); assert.equal(countEdges(), baseline);

const originalSource = context.createBufferSource.bind(context);
let created = 0;
context.createBufferSource = () => {
  const source = originalSource();
  if (++created === 2) source.start = () => { throw Error('start failed'); };
  return source;
};
assert.throws(() => player.start(buffers, 0), /start failed/);
assert.equal(player.playing, false); assert.equal(countEdges(), baseline, 'partial startup rolls back every connected graph');
context.createBufferSource = originalSource;
player.start(buffers, 0); assert.ok(player.playing); player.stop();
console.log('ok: synchronized stems, scheduled tempo, cached levels, natural ends, 20 cycles, preview loops/replacement and startup rollback');
