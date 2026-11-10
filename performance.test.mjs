import assert from 'node:assert/strict';
import { appSource, appImports } from './test/app-harness.mjs';
import vm from 'node:vm';
import { createAudioHarness } from './test/audio-context.mjs';
const source = appSource;
const { AudioContext, countEdges } = createAudioHarness();
const gradient = { addColorStop() {} };
// A no-op canvas that counts calls, gradient creations and glowing draws (nonzero shadowBlur).
const counts = { calls: 0, gradients: 0, blurs: 0 };
const g = new Proxy({}, {
  get: (o, k) => o[k] ?? (typeof k !== 'string' ? undefined : (...args) => {
    counts.calls++;
    if (/^create(Linear|Radial|Conic)Gradient$/.test(k)) counts.gradients++;
    return k === 'measureText' ? { width: args[0].length * 7 } : k.startsWith('create') ? gradient : undefined;
  }),
  set: (o, k, v) => { if (k === 'shadowBlur' && v) counts.blurs++; o[k] = v; return true; },
});
const timers = new Map(); let timerId = 0;
let observers = 0;
class PerformanceObserver { static supportedEntryTypes = ['longtask']; constructor() { observers++; } observe() {} }
const context = vm.createContext({ ...appImports, assert, AudioContext, console, performance, Float32Array, PerformanceObserver,
  document: { getElementById: () => ({ getContext: () => g, addEventListener() {} }), createElement: () => ({ getContext: () => g }) },
  addEventListener() {}, requestAnimationFrame() {}, fetch: () => Promise.reject(new Error('offline')),
  setTimeout: fn => { timers.set(++timerId, fn); return timerId; }, clearTimeout: id => timers.delete(id),
  countEdges, counts,
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

vm.runInContext('stopStems(); audio.stopSounds()', context);
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
console.log('ok: 20 replay/preview cycles, shared decoding, stale-cache eviction and idle worker release');

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

// Worst-case frame: a 10-minute song with a note on every sixteenth on all four tracks, a full
// particle pool, popups, rings and capture effects. Counting calls instead of timing them keeps
// this deterministic; the ceilings are the measured values plus 10%.
const CEILINGS = {
  neon: { calls: 7062, gradients: 10, blurs: 15 }, // measured 6420, 9, 13
  liquid: { calls: 6683, gradients: 11, blurs: 15 }, // measured 6075, 10, 13
  paper: { calls: 5156, gradients: 9, blurs: 15 }, // measured 4687, 8, 13
  circuit: { calls: 4614, gradients: 9, blurs: 15 }, // measured 4194, 8, 13
};
const measured = vm.runInContext(`
  level = 2;
  song = { ...demoSong(), synth: false, duration: 600,
    beats: Array.from({ length: 1201 }, (_, i) => i * .5),
    tracks: Array.from({ length: 4 }, (_, i) => ({ name: 'TRACK ' + i, notes: Array.from({ length: 4800 }, (_, j) => [j * .125, j % 3]) })) };
  reset(); t0 = 0;
  const worst = {};
  for (const key of Object.keys(THEMES)) {
    theme = THEMES[key]; tracks.forEach((tr, i) => (tr.color = theme.colors[i])); materialTexture();
    const most = { calls: 0, gradients: 0, blurs: 0 };
    // Either the player is still playing one track while the others are captured, or the whole band is IN SYNC.
    for (const sync of [false, true]) {
      rt = 1000; mode = 'play'; cur = 1; entrance = null;
      tracks.forEach((tr, i) => {
        const captured = sync || i !== cur;
        tr.capFrom = captured ? 0 : -1; tr.capTo = captured ? 9999 : -1; tr.capAt = rt - .3;
      });
      inSync = sync; syncAt = rt - .2;
      parts = []; burst(0, HIT_Y, '#fff', 800, 1);
      pops = Array.from({ length: 8 }, (_, i) => ({ text: 'PERFECT', x: i * 40, y: HIT_Y - 46, color: '#fff', size: 17, life: 9, born: rt }));
      rings = Array.from({ length: 4 }, (_, i) => ({ x: trackX(i), born: rt - .1, color: tracks[i].color }));
      flash = { color: '#fff', born: rt - .1 }; dash = { from: trackX(0), to: trackX(1), at: rt - .1 };
      missAt = rt - .1; laneHit.fill(rt - .1); press.fill(rt - .05);
      for (let i = 0; i < 60; i++) {
        ac.currentTime = 300 + i / 60;
        counts.calls = counts.gradients = counts.blurs = 0;
        draw(now(), true);
        for (const k in most) most[k] = Math.max(most[k], counts[k]);
      }
    }
    worst[key] = most;
  }
  worst;
`, context);
for (const [key, most] of Object.entries(measured))
  console.log(`worst frame, ${key}: ${most.calls} canvas calls, ${most.gradients} gradients, ${most.blurs} glowing draws`);
for (const [key, most] of Object.entries(measured)) {
  for (const k of Object.keys(most))
    assert.ok(most[k] <= CEILINGS[key][k], `${key} ${k}: ${most[k]} exceeds ceiling ${CEILINGS[key][k]}`);
}
console.log('ok: worst-case frame stays under the canvas call, gradient and glow ceilings for every theme');

// Without ?perf or ?autoplay nothing is observed or recorded, and bests save as before.
vm.runInContext(`
  assert.equal(PERF, false); assert.equal(AUTOPLAY, false);
  song = demoSong(); reset(); t0 = 0; best = {};
  assert.equal(frameStats, null);
  tracks.forEach(tr => tr.notes.forEach(n => (n.hit = true)));
  ac.currentTime = song.duration + LEAD_IN + 2; logic(now());
  assert.equal(mode, 'over'); assert.ok(best['demo:2'], 'best saved');
`, context);
assert.equal(observers, 0, 'no long-task observer without ?perf');

// ?perf&autoplay plays the demo to the results screen with no input and reports one JSON line.
const lines = [];
let clock = 0;
const auto = vm.createContext({ ...appImports, assert, AudioContext, URL, PerformanceObserver, Float32Array,
  console: { ...console, log: (...args) => lines.push(args.join(' ')) },
  location: { href: 'https://game.example/lockstep/?perf&autoplay' },
  performance: { now: () => clock * 1000 },
  localStorage: {},
  document: { getElementById: () => ({ getContext: () => g, addEventListener() {} }) },
  addEventListener() {}, requestAnimationFrame() {}, fetch: () => Promise.reject(new Error('offline')),
  setTimeout() {}, clearTimeout() {},
});
vm.runInContext(appSource, auto);
assert.equal(observers, 1, 'long-task observer with ?perf');
const result = vm.runInContext(`
  initAudio(); song = demoSong(); reset();
  let frames = 0;
  while (mode === 'play' && frames < 10000) { frames++; ac.currentTime += 1 / 60; globalThis.tick(); frame(); }
  ({ mode, hits: run.hits, misses: run.misses, captures: run.captures, saved: localStorage.lockstepBest, perfLine, frameStats });
`, Object.assign(auto, { tick: () => (clock += 1 / 60) }));
assert.equal(result.mode, 'over');
assert.equal(result.misses, 0, 'autoplay misses nothing');
assert.ok(result.hits > 100 && result.captures >= 4, `autoplay hits ${result.hits}, captures ${result.captures}`);
assert.equal(result.saved, undefined, 'autoplay saves no best');
assert.equal(result.frameStats, null, 'the run reports once');
assert.match(result.perfLine, /^PERF \d+ frames/);
const report = JSON.parse(lines.find((line) => line.startsWith('{')));
assert.ok(report.frames > 3900 && report.autoplay && report.dropped === 0 && report.longTasks === 0, JSON.stringify(report));
vm.runInContext('drawResults()', auto);
console.log(`ok: flags off by default; autoplay finished the demo with ${result.hits} hits, ${result.captures} captures, no misses; perf reported ${report.frames} frames`);
