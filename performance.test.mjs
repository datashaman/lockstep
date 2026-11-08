import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('./index.html', import.meta.url), 'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
const nodes = [];
const param = () => ({ value: 0, setValueAtTime() {}, setTargetAtTime() {}, exponentialRampToValueAtTime() {}, cancelScheduledValues() {} });
class Node {
  constructor() { nodes.push(this); this.edges = new Set(); for (const p of ['gain', 'frequency', 'detune', 'Q', 'delayTime', 'threshold', 'ratio', 'playbackRate']) this[p] = param(); }
  connect(target) { this.edges.add(target); return target; }
  disconnect() { this.edges.clear(); }
  start() {}
  stop() { this.stopped = true; }
}
class AudioContext {
  currentTime = 0; sampleRate = 44100; state = 'running'; destination = {};
  createGain() { return new Node(); } createBufferSource() { return new Node(); }
  createOscillator() { return new Node(); } createBiquadFilter() { return new Node(); }
  createDelay() { return new Node(); } createDynamicsCompressor() { return new Node(); }
  createBuffer(channels, length) { return { getChannelData: () => new Float32Array(length), copyToChannel() {} }; }
}
const gradient = { addColorStop() {} };
const g = new Proxy({}, { get: (o, k) => o[k] ?? (k === 'measureText' ? s => ({ width: s.length * 7 }) : k.startsWith('create') ? () => gradient : () => {}), set: (o, k, v) => (o[k] = v, true) });
const timers = new Map(); let timerId = 0;
const context = vm.createContext({ assert, AudioContext, console, performance, Float32Array,
  document: { getElementById: () => ({ getContext: () => g, addEventListener() {} }) },
  addEventListener() {}, requestAnimationFrame() {}, fetch: () => Promise.reject(new Error('offline')),
  setTimeout: fn => { timers.set(++timerId, fn); return timerId; }, clearTimeout: id => timers.delete(id),
  countEdges: () => nodes.reduce((sum, n) => sum + n.edges.size, 0),
});
vm.runInContext(source, context);
vm.runInContext(`
  initAudio(); const baselineEdges = countEdges();
  song = { ...demoSong(), synth: false, buffers: [{}, {}, {}, {}] };
  for (let i = 0; i < 20; i++) reset();
  stopStems();
  console.log('extra audio graph connections after 20 plays:', countEdges() - baselineEdges);
  if (!globalThis.baselineOnly) assert.equal(countEdges(), baselineEdges, 'stopped stem graphs must be disconnected');
`, Object.assign(context, { baselineOnly: process.argv.includes('--baseline') }));
// Count property reads instead of fragile wall-clock thresholds: long songs should not
// cost a full chart traversal per frame. The drawing itself uses a no-op canvas.
vm.runInContext(`
  song = { ...demoSong(), synth: false, duration: 600,
    beats: Array.from({ length: 1201 }, (_, i) => i * .5),
    tracks: Array.from({ length: 4 }, (_, i) => ({ name: 'TRACK ' + i, notes: Array.from({ length: 2400 }, (_, j) => [j * .25, j % 3]) })) };
  reset(); t0 = 0; ac.currentTime = 300; cur = 0;
  let noteReads = 0;
  tracks.forEach(tr => { tr.capTo = 999; tr.capFrom = 0;
    tr.notes.forEach(n => { const time = n.t; Object.defineProperty(n, 't', { get() { noteReads++; return time; } }); }); });
  logic(300); // catch up once, as if the first half had already been played
  noteReads = 0;
  for (let i = 0; i < 60; i++) { ac.currentTime = 300 + i / 60; logic(now()); draw(now(), true); }
  console.log('note-time reads for 60 frames of a 10-minute song:', noteReads);
  assert.ok(noteReads < 30000, 'frame work follows nearby notes, not the full chart');

`, context);

vm.runInContext(`
  stopStems(); stopVoices(); const soundBaseline = countEdges();
  for (let i = 0; i < 20; i++) {
    tone('sine', 60, 0, .1, .1, 1000, .5); hiss(0, .1, .1, 1000); pad(0, 0); captureSfx(0);
    stopVoices(); assert.equal(countEdges(), soundBaseline, 'temporary sound graphs disconnected');
  }
`, context);
vm.runInContext("tone('sine', 60, 0, .1, .1, 1000, .5)", context);
for (const node of nodes) node.onended?.();
vm.runInContext("assert.equal(voices.size, 0); assert.equal(countEdges(), soundBaseline, 'natural sound completion disconnects graph')", context);
// Start/preview requests share decoding, and a late request cannot repopulate stale caches.
vm.runInContext(`
  const originalDecode = decodeSong; const resolvers = new Map(); let decodes = 0;
  decodeSong = e => { decodes++; return new Promise(resolve => resolvers.set(e, resolve)); };
  const entry1 = { title: 'one' }, entry2 = { title: 'two' };
  catalog = [entry1, entry2]; sel = 0;
  const load1 = loadSong(entry1), sameLoad = loadSong(entry1);
  assert.equal(load1, sameLoad); assert.equal(decodes, 1);
  sel = 1; const load2 = loadSong(entry2); resolvers.get(entry2)({ buffers: [{}] });
`, context);
await vm.runInContext('load2', context);
vm.runInContext('assert.ok(entry2.song); resolvers.get(entry1)({ buffers: [{}] })', context);
await vm.runInContext('load1', context);
vm.runInContext(`
  assert.equal(entry1.song, undefined, 'stale decode is not cached');
  sel = 0; const load3 = loadSong(entry1); resolvers.get(entry1)({ buffers: [{}] });
`, context);
await vm.runInContext('load3', context);
vm.runInContext(`
  assert.ok(entry1.song); assert.equal(entry2.song, undefined, 'only selected decoded song retained');
  decodeSong = originalDecode;
  let terminations = 0; worker = { terminate() { terminations++; } };
  pending.set('active', {}); releaseWorker(); assert.equal(terminations, 0);
  pending.clear(); job = {}; releaseWorker(); assert.equal(terminations, 0);
  job = null; jobs.push({}); releaseWorker(); assert.equal(terminations, 0);
  jobs.length = 0; releaseWorker(); assert.equal(terminations, 1); assert.equal(worker, null);
`, context);
// Preview graphs also return to baseline after repeated selection changes.
vm.runInContext(`
  catalog = [{ title: 'preview', song: { ...demoSong(), synth: false, buffers: [{}, {}, {}, {}] } }];
  sel = 0; mode = 'title'; const previewBaseline = countEdges();
`, context);
for (let i = 0; i < 20; i++) {
  vm.runInContext('showSelected()', context);
  await timers.get(timerId)();
  vm.runInContext('stopPreview(); assert.equal(countEdges(), previewBaseline)', context);
}
console.log('ok: 20 replay/preview/synth cycles, natural node cleanup, shared decoding, stale-cache eviction and idle worker release');

vm.runInContext(`
  const channel = new Float32Array(4);
  assert.equal(i2f(new Int16Array([-32768, 0, 16384, 32767]), channel), channel);
  assert.deepEqual(Array.from(channel), [-32768, 0, 16384, 32767].map(n => Math.fround(n / 32767)));
`, context);
console.log('ok: PCM conversion writes directly into the playback channel');

vm.runInContext(`
  const sortedNotes = [0, 0, .1, 1, 2, 10].map(t => ({ t }));
  for (const t of [-Infinity, -1, 0, .05, .1, .2, 1, 11, Infinity]) {
    const expected = sortedNotes.findIndex(n => n.t >= t);
    assert.equal(noteIndex(sortedNotes, t), expected < 0 ? sortedNotes.length : expected);
  }
  for (const downbeat of [0, 2]) {
    song = demoSong(); song.downbeat = downbeat; setGrid(song); tracks = buildTracks();
    for (const tr of tracks) for (let p = 0; p < BARS / 2; p++) {
      assert.deepEqual(phraseNotes(tr, p), tr.notes.filter(n => Math.floor(n.bar / 2) === p), 'bounded phrase matches full scan, including intro notes');
    }
  }
  song = demoSong(); song.synth = false; reset(); t0 = 0;
  tracks.forEach(tr => { tr.capFrom = 0; tr.capTo = 999; });
  ac.currentTime = 30; logic(30);
  const judgedCounts = tracks.map(tr => tr.judged);
  logic(30); assert.deepEqual(tracks.map(tr => tr.judged), judgedCounts, 'no repeated judgement');
  reset(); assert.ok(tracks.every(tr => tr.judged === 0), 'retry resets judgement cursors');
`, context);
console.log('ok: binary window bounds, duplicate note times, intro/phrase equivalence and cursor reset');
