import assert from 'node:assert/strict';
import { createAudioEngine } from './lib/audio-engine.js';
import { createAudioHarness } from './test/audio-context.mjs';

const { AudioContext, nodes, countEdges } = createAudioHarness();
const context = new AudioContext();
const audio = createAudioEngine(context, { step: .125, barLength: 2, chords: [[57,60,64],[53,57,60],[48,52,55],[55,59,62]] });
const baseline = countEdges();
assert.equal(audio.output.gain.value, .8);
assert.equal(nodes.find(n => n.kind === 'delay').delayTime.value, .375);

for (let cycle = 0; cycle < 20; cycle++) {
  audio.playCountIn(10); audio.playSwitch(11); audio.playHiHat(12);
  audio.playPad(0, 13); audio.playCapture(1);
  for (const kind of ['drums', 'bass', 'arp', 'lead']) for (let lane = 0; lane < 3; lane++) audio.playNote(kind, lane, 2, 14);
  assert.ok(countEdges() > baseline);
  audio.stopSounds();
  assert.equal(countEdges(), baseline, 'all temporary graphs, including echo sends, are disconnected');
  audio.stopSounds();
  assert.equal(countEdges(), baseline, 'stopping twice is harmless');
}
let first = nodes.length;
audio.playNote('bass', 1, 0, 42);
let source = nodes.slice(first).find(n => n.kind === 'oscillator');
assert.deepEqual(source.starts, [42]);
assert.deepEqual(source.stops, [42.22]);
assert.equal(source.frequency.value, 440 * 2 ** ((60 - 24 - 69) / 12));
source.onended();
assert.equal(source.onended, null);
assert.equal(countEdges(), baseline, 'natural completion releases the whole graph');
const stops = source.stops.length;
audio.stopSounds();
assert.equal(source.stops.length, stops, 'completed sources are no longer stopped');

first = nodes.length; context.currentTime = 50;
audio.playCapture(0);
assert.deepEqual(nodes.slice(first).filter(n => n.starts.length).map(n => n.starts[0]), [50,50.06,50.12,50]);
audio.stopSounds();
assert.equal(countEdges(), baseline);
audio.mute(); audio.restoreVolume();
assert.deepEqual(audio.output.gain.events, [['target',0,50,.02],['cancel',50],['set',.8,50]]);
console.log('ok: 20 complete sound cycles, echo cleanup, pitch, scheduling, natural completion, capture timing and master volume');
