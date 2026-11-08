import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Exercise the real renderer without audio, network, or a browser animation loop.
let calls = [];
const record = (name, args) => {
  for (const value of args) if (typeof value === 'number') assert.ok(Number.isFinite(value), `${name}: finite coordinates`);
  calls.push([name, ...args]);
};
const canvas = {};
for (const name of ['setTransform', 'translate', 'rotate', 'save', 'restore', 'beginPath', 'closePath', 'moveTo', 'lineTo', 'arc', 'ellipse', 'fill', 'stroke', 'fillRect', 'strokeRect', 'roundRect', 'fillText', 'clip', 'rect']) {
  canvas[name] = (...args) => record(name, args);
}
for (const name of ['createLinearGradient', 'createRadialGradient']) canvas[name] = (...args) => {
  record(name, args); return { addColorStop() {} };
};
canvas.measureText = text => ({ width: text.length * 7 });
const motion = { matches: false };
const events = {};
const context = vm.createContext({
  console: { ...console, assert: (value, ...message) => assert.ok(value, message.join(' ')) },
  document: { addEventListener: (name, fn) => events[name] = fn, getElementById: () => ({ getContext: () => canvas, addEventListener() {} }) },
  performance: { now: () => 0 }, matchMedia: () => motion,
  addEventListener() {}, requestAnimationFrame() {},
  fetch: () => Promise.reject(new Error('offline test')),
  assert,
});
const source = readFileSync(new URL('./index.html', import.meta.url), 'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
vm.runInContext(source, context);
vm.runInContext(`
  mode = 'play'; rt = 10;
  assert.equal(captureLight(tracks[0], 0), 0);
  tracks[0].capFrom = 0; tracks[0].capTo = 8; tracks[0].capAt = 10;
  assert.equal(captureLight(tracks[0], 0), 0);
  rt = 10.325; assert.ok(Math.abs(captureLight(tracks[0], 0) - .5) < 1e-9);
  rt = 11; assert.equal(captureLight(tracks[0], 0), 1);
  assert.equal(captureLight(tracks[0], BARLEN * 7.5), .5);
  assert.equal(captureLight(tracks[0], BARLEN * 8), 0);
  const notes = tracks[0].notes; tracks[0].notes = [];
  assert.equal(captureLight(tracks[0], 0), 0); tracks[0].notes = notes;
  for (let count = 0; count <= 4; count++) {
    tracks.forEach((tr, i) => { tr.capTo = i < count ? 8 : -1; tr.capAt = 10; });
    for (const age of [0, .2, .65, .9, 1.4]) { rt = 10 + age; draw(1, true); }
    draw(BARLEN * 8, true);
  }
`, context);
assert.ok(calls.some(([name]) => name === 'strokeRect'), 'drum architecture rendered');
motion.matches = true;
calls = [];
vm.runInContext('rt = 12; drawWorld(1, true, 400, 190)', context);
const still = calls;
calls = [];
vm.runInContext('pulse = .9; drawWorld(2, true, 400, 190)', context);
assert.deepEqual(calls, still, 'reduced motion keeps world geometry still');
calls = [];
vm.runInContext('drawWorld(2, false, 400, 190)', context);
assert.ok(!calls.some(([name]) => name === 'stroke' || name === 'fillRect'), 'no captured scenery on menu');
console.log('ok: capture fade, expiration, silent tracks, 0–4 captures, handoff, finite geometry, reduced motion');

// Rapid switches start from the craft's visible position, without teleporting.
motion.matches = false;
vm.runInContext(`
  ac = { currentTime: 0 }; t0 = 0; hiss = () => {};
  tracks.forEach(tr => tr.capTo = -1); cur = 0; dash = null; rt = 20;
  assert.equal(craftX(), trackX(0));
  move(1); assert.equal(cur, 1); assert.equal(craftX(), trackX(0));
  rt += .08; const midway = craftX();
  assert.ok(midway > trackX(0) && midway < trackX(1));
  move(-1); assert.equal(craftX(), midway);
  rt += .2; assert.equal(craftX(), trackX(0));
  const previous = dash; move(-1); assert.equal(dash, previous);
  flash = { color: '#ff4d6d', born: rt }; laneHit.fill(-9);
`, context);
calls = [];
vm.runInContext('drawCraft()', context);
const idleFlames = calls.filter(([name]) => name === 'lineTo').map(call => call[2]);
for (let lane = 0; lane < 3; lane++) {
  calls = [];
  vm.runInContext(`laneHit.fill(-9); laneHit[${lane}] = rt; drawCraft()`, context);
  const flameYs = calls.filter(([name]) => name === 'lineTo').map(call => call[2]);
  assert.equal(flameYs.filter((y, i) => y !== idleFlames[i]).length, 1, 'one hit extends only its own thruster');
  for (const [name, , y] of calls) if (name === 'moveTo' || name === 'lineTo') assert.ok(y > 500 && y < 530, 'craft stays between hit line and key hints');
}
motion.matches = true;
vm.runInContext('move(1); assert.equal(craftX(), trackX(cur))', context);
calls = [];
vm.runInContext('drawCraft()', context);
assert.equal(calls.filter(([name]) => name === 'stroke').length, 1, 'reduced motion omits dash trail');
vm.runInContext('reset(); assert.equal(dash, null); assert.ok(laneHit.every(t => t === -9))', context);
console.log('ok: craft dash, rapid reversal, blocked switch, independent thrusters, clearance, reduced motion, restart');

vm.runInContext(`
  const sleeve = { duration: 10, tracks: [
    { name: 'DRUMS', notes: [[0, 0], [5, 2], [10, 1]] },
    { name: 'BASS', notes: [] },
  ] };
  const bands = sleeveBands(sleeve);
  assert.equal(bands[0].length, 48);
  assert.ok(bands[0][0] > 0 && bands[0][24] > 0 && bands[0][47] > 0);
  assert.ok(bands[1].every(n => n === 0));
  assert.equal(sleeveBands(sleeve), bands);
  assert.ok(bands.flat().every(n => n >= 0 && n <= 1));
  const original = sleeveBands(demoSleeve); setLevel(0);
  assert.equal(sleeveBands(demoSleeve), original); setLevel(1);
  mode = 'title'; catalog = [DEMO, ADD, FIND]; pvFor = DEMO;
  for (sel = 0; sel < catalog.length; sel++) { zones = []; drawCard(); assert.ok(zones.length > 0); }
  sel = 0; zones = []; drawCard();
  assert.equal(zones.length, 4, 'three difficulty controls and play');
  for (const z of zones) {
    assert.ok(z.x >= CARD.x && z.y >= CARD.y && z.x + z.w <= CARD.x + CARD.w && z.y + z.h <= CARD.y + CARD.h);
  }
  zones[0].fn(); assert.equal(level, 0); setLevel(1);
  catalog = [{ title: 'A very long title that should fit in the selected song card — Artist', meta: sleeve, lib: 'test' }];
  sel = 0; pvFor = null; mode = 'loading'; zones = []; drawCard();
  catalog = [{ title: 'Unloaded song', slug: 'pending' }]; drawCard();
`, context);
motion.matches = true;
calls = [];
vm.runInContext('pulse = 0; drawSleeve(demoSleeve, 450, 142, 296, 140, true)', context);
const quietSleeve = calls;
calls = [];
vm.runInContext('pulse = 1; drawSleeve(demoSleeve, 450, 142, 296, 140, true)', context);
assert.deepEqual(calls, quietSleeve, 'reduced motion keeps the sleeve still');
motion.matches = false;
calls = [];
vm.runInContext('drawSleeve(demoSleeve, 450, 142, 296, 140, false)', context);
assert.deepEqual(calls, quietSleeve, 'stopped preview keeps the sleeve still');
console.log('ok: sleeve bins, empty stems, caching, difficulty stability, menu controls, loading and reduced motion');

const composites = [], scoreOpacity = [];
canvas.drawImage = (...args) => { record('drawImage', args); composites.push(canvas.globalAlpha); };
canvas.fillText = (...args) => { record('fillText', args); if (args[0] === 'SCORE') scoreOpacity.push(canvas.globalAlpha); };
context.document.createElement = () => ({ width: 0, height: 0, getContext: () => canvas });
context.clearTimeout = () => {};
vm.runInContext("catalog = [DEMO]; sel = 0; mode = 'title'; rt = 0; ac = { currentTime: 20 }; camX = 100;", context);
await vm.runInContext('start()', context);
vm.runInContext(`
  assert.equal(mode, 'play'); assert.ok(entrance);
  assert.equal(t0, 20 + LEAD_IN, 'entrance does not delay audio');
  assert.equal(sched, -LEAD_IN);
  rt = .2; draw(-2.8, true);
`, context);
assert.equal(composites.at(-1), .5, 'menu is halfway faded at 200 ms');
assert.equal(scoreOpacity.at(-1), 0, 'HUD waits for menu fade');
const compositeCount = composites.length;
vm.runInContext('rt = .575; draw(-2.425, true)', context);
assert.equal(composites.length, compositeCount, 'menu gone after 400 ms');
assert.ok(Math.abs(scoreOpacity.at(-1) - .5) < 1e-9, 'HUD fades in next');
vm.runInContext('rt = .8; draw(-2.2, true); assert.equal(entrance, null)', context);
assert.equal(scoreOpacity.at(-1), 1);
motion.matches = true;
vm.runInContext('camX = 100; reset({}); assert.equal(camX, trackX(cur)); rt = .1; draw(0, true); assert.equal(entrance, null)', context);
assert.equal(scoreOpacity.at(-1), 1, 'first notes always have full HUD');
vm.runInContext('reset({}); reset(); assert.equal(entrance, null)', context);
console.log('ok: entrance fade, HUD sequence, unchanged audio scheduling, reduced-motion camera, first-note clearance, replay');

vm.runInContext(`
  song = demoSong(); setGrid(song); tracks = buildTracks(); cur = 0;
  ac = { currentTime: 1 }; t0 = 0; rt = 30;
  tracks[1].capFrom = 0; tracks[1].capTo = 8;
  move(1); assert.equal(cur, 1, 'can enter an auto track');
  const beforeScore = score, beforeHits = hits;
  const autoNote = tracks[1].notes[0]; ac.currentTime = autoNote.t;
  tryHit(autoNote.lane); assert.equal(score, beforeScore); assert.equal(hits, beforeHits);
  assert.equal(tracks[1].capTo, 8, 'entering leaves capture intact');
  move(1); assert.equal(cur, 2, 'can leave an auto track');
  move(-1); assert.equal(cur, 1, 'can return to an auto track');
  tracks[2].notes = []; move(1); assert.equal(cur, 3, 'still skips silent tracks');
  move(1); assert.equal(cur, 3, 'does not wrap at boundary');
  tracks.forEach(tr => { tr.capFrom = 0; tr.capTo = 8; });
  move(-1); assert.equal(cur, 1, 'can move when every populated track is auto');
`, context);
console.log('ok: auto-track entry, exit and re-entry, capture intact, silent tracks and boundaries');

vm.runInContext(`
  song = demoSong(); song.synth = false; ac = { currentTime: 0 }; reset(); t0 = 0; offset = 0;
  captureSfx = () => {}; tone = () => {}; rt = 40;
  const note = t => ({ t, lane: 0, bar: 0, hit: false, missed: false });
  tracks[0].notes = [note(0), note(1)]; tracks[1].notes = [note(0)];
  tracks[2].notes = [note(1)]; tracks[3].notes = [];
  cur = 0; tryHit(0); assert.equal(tracks[0].hits, 1);
  cur = 1; tryHit(0); assert.equal(tracks[1].caps, 1);
  const capturedUntil = tracks[1].capTo;
  cur = 0; logic(1.3);
  assert.equal(tracks[0].misses, 1);
  assert.equal(tracks[2].misses, 0, 'inactive notes are not counted as manual misses');
  assert.equal(tracks.reduce((n, tr) => n + tr.hits, 0), hits);
  assert.equal(tracks.reduce((n, tr) => n + tr.misses, 0), misses);
  assert.equal(tracks.reduce((n, tr) => n + tr.caps, 0), caps);
  assert.equal(captureRemaining(tracks[1], 0), 1);
  assert.equal(captureRemaining(tracks[1], BARLEN * (capturedUntil - 4)), .5);
  assert.equal(captureRemaining(tracks[1], BARLEN * capturedUntil), 0);
  assert.equal(captureRemaining(tracks[1], BARLEN * (capturedUntil + 2)), 0);
  mode = 'over'; saveBest(); drawResults();
`, context);
assert.ok(calls.some(([name, text]) => name === 'fillText' && text === 'UNPLAYED'));
assert.ok(calls.some(([name, text]) => name === 'fillText' && text === 'SILENT'));
vm.runInContext(`
  newBest = false; drawResults();
  reset(); assert.ok(tracks.every(tr => tr.hits === 0 && tr.misses === 0 && tr.caps === 0));
`, context);
console.log('ok: per-instrument totals match scorekeeping, inactive notes excluded, capture drain, results states and restart');

vm.runInContext(`
  reset(); song.synth = false; rt = 50;
  tracks[3].notes = [];
  tracks.forEach((tr, i) => { tr.capTo = i < 2 ? 8 : -1; tr.capAt = 49; });
  updateSync(0); assert.equal(inSync, false, 'partial capture is not full sync');
  tracks[2].capTo = 8;
  const syncScore = score;
  logic(0); assert.equal(inSync, true); assert.equal(syncAt, 50, 'silent track does not block sync');
  rt = 50.2; updateSync(0); assert.equal(syncAt, 50, 'holding full capture does not retrigger');
  draw(0, true);
  updateSync(BARLEN * 8); assert.equal(inSync, false, 'expiry ends full sync');
  tracks.forEach(tr => tr.capTo = 16); rt = 51;
  updateSync(BARLEN * 8); assert.equal(inSync, true); assert.equal(syncAt, 51, 'recapture triggers again');
  assert.equal(score, syncScore, 'celebration adds no score');
`, context);
assert.ok(calls.some(([name, text]) => name === 'fillText' && text === 'IN SYNC'));
motion.matches = true;
calls = [];
vm.runInContext('rt = 51.1; drawCraft(); drawWorld(0, true, 400, 190)', context);
const staticSync = calls;
calls = [];
vm.runInContext('rt = 51.3; pulse = .2; drawCraft(); drawWorld(0, true, 400, 190)', context);
assert.deepEqual(calls, staticSync, 'reduced-motion celebration has static geometry');
vm.runInContext(`
  tracks.forEach(tr => tr.notes = []); updateSync(0);
  assert.equal(inSync, false, 'empty song cannot earn sync');
  reset(); assert.equal(inSync, false); assert.equal(syncAt, -9);
`, context);
console.log('ok: sync entry, no repeated trigger, expiry, recapture, silent/empty tracks, unchanged score, reduced motion and restart');

let wallTime = 100;
context.performance.now = () => wallTime * 1000;
vm.runInContext(`
  ac = { currentTime: 10, state: 'running', suspend: async () => { ac.state = 'suspended'; }, resume: async () => { ac.state = 'running'; } };
  reset(); t0 = 0; sched = 10.1; rt = 100; visualOffset = 0;
  score = 1234; tracks[0].capTo = 8;
  pauseGame(); assert.equal(mode, 'pause'); assert.equal(ac.state, 'suspended');
  assert.equal(score, 1234); assert.equal(tracks[0].capTo, 8);
`, context);
wallTime = 115;
vm.runInContext(`
  frame(); assert.equal(rt, 100); assert.equal(now(), 10); assert.equal(sched, 10.1);
  resumeCountdown(); assert.equal(pauseState.deadline, 118);
`, context);
context.document.hidden = true;
events.visibilitychange();
vm.runInContext('assert.equal(pauseState.deadline, 0); assert.equal(mode, "pause")', context);
context.document.hidden = false;
wallTime = 120;
await vm.runInContext('resumeGame()', context);
vm.runInContext(`
  assert.equal(mode, 'play'); assert.equal(visualOffset, 20); assert.equal(now(), 10);
  assert.equal(t0, 0); assert.equal(sched, 10.1); assert.equal(score, 1234); assert.equal(tracks[0].capTo, 8);
  pauseGame();
`, context);
wallTime = 125;
await vm.runInContext("resumeGame('restart')", context);
vm.runInContext(`
  assert.equal(mode, 'play'); assert.equal(score, 0); assert.equal(t0, ac.currentTime + LEAD_IN);
  pauseGame(); ac.resume = async () => { throw new Error('audio unavailable'); };
`, context);
await vm.runInContext('resumeGame()', context);
vm.runInContext(`
  assert.equal(mode, 'pause'); assert.equal(pauseState.busy, false); assert.equal(pauseState.deadline, 0);
`, context);
console.log('ok: pause freezes song/effects, preserves score/captures/scheduler, countdown cancellation, restart and resume failure');

vm.runInContext(`
  pauseState = null; song = demoSong(); song.synth = false; ac = { currentTime: .95 }; reset(); t0 = 0; offset = 0;
  cur = 0; rt = 150;
  tracks[0].notes = [1, 2, 3].map(t => ({ t, lane: 0, bar: 0, hit: false, missed: false }));
  tryHit(0); assert.equal(pops.at(-1).text, '50 ms EARLY'); assert.equal(score, 10);
  ac.currentTime = 2.01; tryHit(0); assert.equal(pops.at(-1).text, 'PERFECT'); assert.equal(score, 25);
  offset = .02; ac.currentTime = 3.07; tryHit(0);
  assert.ok(pops.some(p => p.text === '50 ms LATE'), 'feedback uses calibrated song time');
  assert.equal(tracks[0].hits, 3); assert.ok(Math.abs(tracks[0].timing - .01) < 1e-9);
  assert.equal(timingLabel(tracks[0].timing / 3), '3 ms LATE');
  assert.equal(score, 135, 'hit and capture points unchanged');
  const before = tracks[0].timing; ac.currentTime = 50; tryHit(0);
  assert.equal(tracks[0].timing, before, 'stray presses excluded');
  assert.equal(timingLabel(0), 'ON TIME');
  drawResults(); reset(); assert.ok(tracks.every(tr => tr.timing === 0));
`, context);
console.log('ok: signed timing, perfect/early/late feedback, calibration, unchanged scoring, stray exclusion and reset');

vm.runInContext(`
  pauseState = null; song = demoSong(); song.synth = false;
  ac = { currentTime: 0 }; offset = 0; reset(); t0 = 0;
  const rateEvents = [], stopped = [];
  srcs = [0, 1, 2, 3].map(i => ({ playbackRate: { setValueAtTime: (rate, at) => rateEvents.push([i, rate, at]) }, stop: () => stopped.push(i) }));
  ac.currentTime = 10;
  changeGroove(-80);
  assert.equal(groove, 20); assert.equal(tempo.at(-1).rate, .775);
  assert.equal(rateEvents.length, 4); assert.ok(rateEvents.every(e => e[1] === .775 && e[2] === 10.15));
  assert.equal(songTime(10.1), 10.1, 'committed synth lookahead is unchanged');
  assert.ok(Math.abs(songTime(11.15) - 10.925) < 1e-9);
  for (const elapsed of [-3, 0, 10, 10.15, 11.15, 20]) assert.ok(Math.abs(audioTime(songTime(elapsed)) - elapsed) < 1e-9);
  ac.currentTime = 12; const beforeRecovery = now(); changeGroove(25);
  assert.equal(groove, 45); assert.equal(tempo.at(-1).rate, 1); assert.equal(now(), beforeRecovery, 'recovery does not jump chart time');
  for (let i = 0; i < 100; i++) {
    ac.currentTime += .2; setTempo(i % 2 ? .65 : 1);
    const elapsed = ac.currentTime + .3;
    assert.ok(Math.abs(audioTime(songTime(elapsed)) - elapsed) < 1e-8, 'transport remains invertible through repeated changes');
  }
  const priorBest = JSON.stringify(best);
  voice({ stop: () => stopped.push('synth') }); changeGroove(-100);
  assert.equal(mode, 'failed'); assert.equal(srcs.length, 0); assert.equal(voices.size, 0);
  assert.equal(stopped.length, 5); assert.equal(JSON.stringify(best), priorBest, 'failed run does not save a best');
  const frozen = now(); ac.currentTime += 20; assert.equal(now(), frozen); drawFailure();
  reset(); assert.equal(groove, 100); assert.equal(missStreak, 0); assert.equal(tempo.length, 1); assert.equal(mode, 'play');
`, context);
vm.runInContext(`
  t0 = 0; ac.currentTime = 0; sched = 0; song.synth = false;
  const grooveNote = t => ({ t, lane: 0, bar: Math.floor(t / BARLEN), hit: false, missed: false });
  tracks.forEach(tr => tr.notes = []); tracks[0].notes = [grooveNote(0), grooveNote(1), grooveNote(2), grooveNote(3)];
  tracks[1].notes = [grooveNote(0), grooveNote(1), grooveNote(2), grooveNote(3)];
  tracks[2].notes = [grooveNote(0)]; tracks[2].capFrom = 0; tracks[2].capTo = 8;
  cur = 0;
  ac.currentTime = .2; logic(now()); assert.equal(groove, 95); assert.equal(missStreak, 1);
  ac.currentTime = 1.2; logic(now()); assert.equal(groove, 89); assert.equal(missStreak, 2);
  assert.equal(tracks[1].misses, 0, 'unselected track has no penalty');
  cur = 2; ac.currentTime = 2.2; logic(now()); assert.equal(groove, 89, 'AUTO has no penalty or passive recovery');
  cur = 0; ac.currentTime = 3; tryHit(0); assert.equal(groove, 92); assert.equal(missStreak, 0);
  tracks[0].notes = [grooveNote(4)]; ac.currentTime = 4; tryHit(0); assert.equal(groove, 100, 'capture restores extra groove, capped at 100');
  reset(); t0 = 0; ac.currentTime = 0; groove = 20; setTempo(.5);
  tracks.forEach(tr => tr.notes = []); tracks[0].notes = [grooveNote(1), grooveNote(2)]; cur = 0;
  ac.currentTime = audioTime(1) + .08; tryHit(0);
  assert.equal(tracks[0].hits, 1); assert.ok(Math.abs(tracks[0].timing - .08) < 1e-9, 'judgement remains in real milliseconds');
  ac.currentTime = audioTime(2) + .11; tryHit(0); assert.equal(tracks[0].hits, 1, 'slowdown does not widen the hit window');
`, context);
vm.runInContext(`
  reset(); t0 = 0; ac.currentTime = 0; song.synth = true; groove = 20; setTempo(.5);
  const scheduled = []; play = (kind, lane, b, when) => scheduled.push(when); hiss = () => {}; pad = () => {}; tone = () => {};
  tracks.forEach(tr => { tr.notes = []; tr.capFrom = 0; tr.capTo = 8; });
  tracks[0].notes = [{ t: 1, lane: 0, bar: 0, hit: false, missed: false }];
  sched = .9; ac.currentTime = audioTime(1) - .05;
  logic(now()); assert.equal(scheduled.length, 1); assert.equal(scheduled[0], audioTime(1), 'synth onset follows the same transport as stems');
  assert.equal(groove, 20);
`, context);
console.log('ok: groove loss/recovery, shared stem/synth clock, repeated tempo changes, fixed judgement windows, failure silence, no failed best and retry');

vm.runInContext(`
  song.synth = false; reset(); t0 = 0; ac.currentTime = 0; offset = 0;
  tracks.forEach(tr => tr.notes = []);
  tracks[0].notes = Array.from({ length: 20 }, (_, i) => ({ t: i * .5, lane: 0, bar: Math.floor(i * .5 / BARLEN), hit: false, missed: false }));
  cur = 0;
  for (let i = 0; i < 20 && mode === 'play'; i++) { ac.currentTime = audioTime(i * .5) + .2; logic(now()); }
  assert.equal(mode, 'failed'); assert.equal(groove, 0); assert.equal(misses, 14, 'consecutive misses exhaust the initial groove');
  drawFailure(); assert.equal(zones.length, 2); zones[0].fn(); assert.equal(mode, 'play'); assert.equal(groove, 100);
`, context);
vm.runInContext(`
  const sourceStarts = [], volumeEvents = [];
  const gainParam = { value: 0, cancelScheduledValues() {}, setValueAtTime: v => volumeEvents.push(v), setTargetAtTime: v => volumeEvents.push(v) };
  out = { gain: gainParam };
  ac = { currentTime: 10, state: 'running',
    createBufferSource: () => ({ playbackRate: { setValueAtTime() {} }, connect: target => target, start: at => sourceStarts.push(at), stop() {} }),
    createGain: () => ({ gain: gainParam, connect() {} }),
    suspend: async () => { ac.state = 'suspended'; }, resume: async () => { ac.state = 'running'; }
  };
  song.buffers = [{}, {}, {}, {}]; reset(); assert.deepEqual(sourceStarts, [13, 13, 13, 13]);
  ac.currentTime = 20; changeGroove(-80); ac.currentTime = 21;
  const lowTempoPosition = now(), lowTempoSchedule = JSON.stringify(tempo);
  pauseGame();
`, context);
wallTime += 15;
await vm.runInContext('resumeGame()', context);
vm.runInContext(`
  assert.equal(now(), lowTempoPosition); assert.equal(JSON.stringify(tempo), lowTempoSchedule);
  assert.equal(groove, 20); assert.equal(srcs.length, 4, 'pause does not restart stems');
  changeGroove(-100); assert.equal(volumeEvents.at(-1), 0);
  reset(); assert.equal(volumeEvents.at(-1), .8); assert.equal(srcs.length, 4); assert.equal(tempo.length, 1);
`, context);
console.log('ok: consecutive-miss failure, clickable retry, stem start alignment, low-tempo pause/resume and volume restoration');

vm.runInContext(`
  assert.equal(titleOffset(100, 250, 50), 0, 'short titles stay still');
  assert.equal(titleOffset(530, 250, 1), 0, 'pause at start');
  assert.equal(titleOffset(530, 250, 6.25), 140, 'scroll forward');
  assert.equal(titleOffset(530, 250, 11.5), 280, 'hold full ending');
  assert.equal(titleOffset(530, 250, 17.5), 140, 'scroll back');
  assert.equal(titleOffset(530, 250, 22.5), 0, 'return to beginning');
  for (let age = 0; age < 50; age += .1) assert.ok(titleOffset(530, 250, age) >= 0 && titleOffset(530, 250, age) <= 280);
  assert.equal(titleOffset(530, 250, 2.9, true), 0);
  assert.equal(titleOffset(530, 250, 3, true), 200);
  assert.equal(titleOffset(530, 250, 6, true), 280, 'reduced-motion pages expose the end');
  const entryA = { title: 'A' }, entryB = { title: 'B' };
  rt = 200; selectedTitle('A long title', 0, 40, 50, '700 15px sans-serif', '#fff', entryA);
  rt = 205; selectedTitle('A long title', 0, 40, 50, '700 15px sans-serif', '#fff', entryA);
  assert.equal(titleStarted, 200, 'list and panel share selection start');
  selectedTitle('Another title', 0, 40, 50, '700 15px sans-serif', '#fff', entryB);
  assert.equal(titleStarted, 205, 'selection change restarts title');
`, context);
console.log('ok: selected-title scrolling, endpoint holds, looping, short titles, reduced-motion pages and selection reset');
