import assert from 'node:assert/strict';
import vm from 'node:vm';
import { appSource, appImports } from './test/app-harness.mjs';
import { createAudioHarness } from './test/audio-context.mjs';

// Plays the demo in a VM with a no-op canvas, advancing the audio clock frame by frame.
const { AudioContext } = createAudioHarness();
const g = new Proxy({}, { get: (o, k) => o[k] ?? (typeof k !== 'string' ? undefined : (...args) =>
  k === 'measureText' ? { width: args[0].length * 7 } : k.startsWith('create') ? { addColorStop() {} } : undefined) });
const context = vm.createContext({ ...appImports, assert, AudioContext, console, Float32Array,
  performance: { now: () => 0 }, localStorage: {},
  document: { getElementById: () => ({ getContext: () => g, addEventListener() {} }), createElement: () => ({ getContext: () => g }) },
  addEventListener() {}, requestAnimationFrame() {}, fetch: () => Promise.reject(new Error('offline')), setTimeout() {}, clearTimeout() {},
});
vm.runInContext(appSource, context);

// A masher presses J, K and L together every 150 ms on NORMAL and never aims.
const mash = vm.runInContext(`
  initAudio(); song = { ...demoSong(), synth: false }; level = 1; reset();
  let frames = 0;
  while (mode === 'play' && frames < 20000) {
    frames++; ac.currentTime += 1 / 60; frame();
    if (frames % 9 === 0) for (const lane of [0, 1, 2]) tryHit(lane);
  }
  ({ mode, hits: run.hits, misses: run.misses, strays: run.strays, accuracy: accuracy(run), grade: grade(accuracy(run)),
     unpenalised: grade(run.hits / Math.max(1, run.hits + run.misses)) });
`, context);
assert.ok(mash.strays > 20, `the masher strays (${mash.strays})`);
assert.ok(mash.mode === 'failed' || !['S', 'A'].includes(mash.grade),
  `mashing fails or grades below A: ${JSON.stringify(mash)}`);
console.log(`ok: mashing ${mash.mode === 'failed' ? 'fails the song' : `grades ${mash.grade}`} (${mash.hits} hits, ${mash.strays} strays; ${mash.unpenalised} without stray penalties)`);

// Presses during the count-in and on a locked (captured) track change nothing.
vm.runInContext(`
  song = { ...demoSong(), synth: false }; level = 1; reset(); t0 = ac.currentTime + 2; mode = 'play';
  assert.ok(now() < 0, 'still counting in');
  const before = JSON.stringify(run);
  for (const lane of [0, 1, 2]) tryHit(lane);
  assert.equal(JSON.stringify(run), before, 'count-in presses are free');
  ac.currentTime = t0 + 5; const tr = tracks[run.currentTrack];
  tr.capTo = bar(now()) + 4; tr.live = true;
  assert.ok(locked(tr, now()));
  const locked0 = JSON.stringify(run);
  for (const lane of [0, 1, 2]) tryHit(lane);
  assert.equal(JSON.stringify(run), locked0, 'presses on a locked track are free');
  assert.equal(tr.live, true);
  tr.capTo = 0; tr.notes = [];
  tryHit(0);
  assert.equal(run.strays, 0, 'a silent track takes no strays');
  tr.notes = [{ t: now() + 5, lane: 0, bar: bar(now() + 5), hit: false, missed: false }];
  assert.ok(playable(tr, now()));
  run.multiplier = 3; const groove0 = run.groove, misses0 = run.misses, streak0 = run.missStreak; const pops0 = pops.length;
  rt = 77; tryHit(0);
  assert.equal(run.strays, 1); assert.equal(run.multiplier, 1); assert.equal(run.groove, groove0 - 2);
  assert.deepEqual([run.misses, run.missStreak], [misses0, streak0]); assert.equal(tr.live, false);
  assert.equal(missAt, 77, 'the hit line flashes'); assert.equal(pops.length, pops0, 'no popup for a stray');
  drawResults();
`, context);
console.log('ok: count-in, locked and silent-track presses are free; a stray costs groove, multiplier and the stem');
