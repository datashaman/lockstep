import assert from 'node:assert/strict';
import { appSource, appImports } from './test/app-harness.mjs';
import vm from 'node:vm';

// Exercise the real renderer without audio, network, or a browser animation loop.
let calls = [];
let snapshots = 0;
const record = (name, args) => {
  for (const value of args) if (typeof value === 'number') assert.ok(Number.isFinite(value), `${name}: finite coordinates`);
  calls.push([name, ...args]);
};
const canvas = {};
for (const name of ['setTransform', 'translate', 'rotate', 'save', 'restore', 'beginPath', 'closePath', 'moveTo', 'lineTo', 'arc', 'ellipse', 'fill', 'stroke', 'fillRect', 'strokeRect', 'roundRect', 'quadraticCurveTo', 'fillText', 'clip', 'rect']) {
  canvas[name] = (...args) => record(name, args);
}
for (const name of ['createLinearGradient', 'createRadialGradient']) canvas[name] = (...args) => {
  record(name, args); return { addColorStop() {} };
};
canvas.measureText = text => ({ width: text.length * 7 });
const motion = { matches: false };
const events = {}, windowEvents = {};
const context = vm.createContext({ ...appImports,
  createSceneRenderer: (g, readFrame, document) => appImports.createSceneRenderer(g, () => { snapshots++; return readFrame(); }, document),
  console: { ...console, assert: (value, ...message) => assert.ok(value, message.join(' ')) },
  document: { addEventListener: (name, fn) => events[name] = fn, getElementById: () => ({ getContext: () => canvas, addEventListener() {} }) },
  performance: { now: () => 0 }, matchMedia: () => motion,
  addEventListener: (name, fn) => (windowEvents[name] ??= []).push(fn), requestAnimationFrame() {},
  fetch: () => Promise.reject(new Error('offline test')),
  assert, URL,
});
const source = appSource;
// Allow the import tests to replace the IndexedDB boundary without a browser database.
vm.runInContext(source, context);
vm.runInContext(`
  for (const vertical of [-81, -50, 0, 50, 81]) {
    bendY = vertical; bendX = 170; camX = 291;
    assert.deepEqual(Array.from(P(291, 0)), [400, HIT_Y], 'judgement line stays fixed');
    let previous = P(291, 0)[1];
    for (let d = .05; d <= LOOK; d += .05) {
      const y = P(291, d)[1]; assert.ok(y < previous, 'road must recede monotonically, never curl back'); previous = y;
    }
  }
  bendY = bendX = camX = 0;
`, context);
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
  audio = { stopSounds() {}, restoreVolume() {}, mute() {} }; ac = { currentTime: 0 }; t0 = 0; audio.playSwitch = () => {};
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
  assert.equal(zones.length, 7, 'theme, default, four difficulty controls and play');
  for (const z of zones) {
    assert.ok(z.x >= CARD.x && z.y >= CARD.y - 38 && z.x + z.w <= CARD.x + CARD.w && z.y + z.h <= CARD.y + CARD.h + 28);
  }
  zones[2].fn(); assert.equal(level, 0); setLevel(1);
  const levelZones = zones.slice(2, 6); assert.equal(levelZones.length, LEVELS.length);
  assert.ok(levelZones.every((z, i) => !i || z.x >= levelZones[i - 1].x + levelZones[i - 1].w), 'four difficulty segments do not overlap');
  assert.deepEqual(LEVELS.map(l => l.name), ['EASY', 'NORMAL', 'HARD', 'EXPERT']);
  setLevel(0); for (let i = 0; i < 5; i++) dispatchAction({ type: 'difficulty', delta: 1 });
  assert.equal(level, 3, 'stepping right stops at EXPERT'); setLevel(1);
  const artwork = { x: CARD.x + 22, y: CARD.y + 14, w: CARD.w - 44, h: 140 };
  catalog = [{ title: 'Shared track', url: 'https://audius.co/artist/song', lib: 'shared', meta: { duration: 120, tracks: [] } }];
  zones = []; drawCard();
  assert.equal(zones.length, 8, 'Audius adds a share control');
  for (const z of zones) assert.ok(z.x + z.w <= artwork.x || z.x >= artwork.x + artwork.w || z.y + z.h <= artwork.y || z.y >= artwork.y + artwork.h, 'controls never cover signature artwork');
  assert.ok(zones[0].y + zones[0].h < CARD.y && zones[1].y + zones[1].h < CARD.y, 'theme and share occupy the separate toolbar');

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
canvas.drawImage = (...args) => { record('drawImage', args); if (args[1] === 0) composites.push(canvas.globalAlpha); };
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
  audio.playCapture = () => {}; audio.playCountIn = () => {}; rt = 40;
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

calls.length = 0;
vm.runInContext(`
  mode = 'over'; offset = 0; calibrated = false; run.hits = 30; tracks[0].timing = 30 * .028; drawResults();
`, context);
assert.ok(calls.some(([name, text]) => name === 'fillText' && text === 'apply +28 ms audio offset'), 'results offer the one-key correction');
calls.length = 0;
vm.runInContext(`mode = 'failed'; drawResults(); calibrated = true; mode = 'over'; drawResults(); tracks[0].timing = 0; reset();`, context);
assert.ok(!calls.some(([name, text]) => name === 'fillText' && /audio offset/.test(text)), 'no offer on the failed screen or after applying');

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
  pauseState = null; song = demoSong(); song.synth = false; ac = { currentTime: 0 }; reset(); t0 = 0; offset = 0;
  mode = 'play'; cur = 0; rt = 150;
  tracks[0].notes = [2, 4, 6, 8, 10].map(t => ({ t, lane: 0, bar: 0, hit: false, missed: false }));
  const judged = () => pops.filter(p => /PERFECT|EARLY|LATE|ON TIME/.test(p.text)).at(-1).text;
  const savedNow = performance.now;
  let wall = 0;
  performance.now = () => wall;
  // The handler runs at audio time \${at} s (performance.now() in step); the key went down at \${pressed} s.
  const pressAt = (at, pressed) => {
    wall = 1000 + at * 1000; ac.currentTime = at;
    handleKey({ key: 'j', timeStamp: pressed === undefined ? undefined : 1000 + pressed * 1000 });
  };
  pressAt(2.05, 2);
  assert.equal(judged(), 'PERFECT'); assert.ok(Math.abs(tracks[0].timing) < 1e-9, 'judged at the key press: delta 0');
  pressAt(4.15, 4);
  assert.equal(judged(), 'PERFECT'); assert.ok(Math.abs(tracks[0].timing) < 1e-9, 'a press handled 150 ms late is still on time');
  pressAt(6.05);
  assert.equal(judged(), '50 ms LATE', 'without an event time, judged when handled, as before');
  pressAt(8.05, 8.2);
  assert.equal(judged(), '50 ms LATE', 'an event time ahead of the clock is not trusted');
  offset = .02; ac.outputLatency = .03; pressAt(10.1, 10.05);
  assert.equal(judged(), 'PERFECT', 'output latency and calibration apply as in now()');
  performance.now = savedNow; offset = 0;
`, context);
console.log('ok: presses are judged at their event time; no event time keeps judging when handled');

vm.runInContext(`
  pauseState = null; song = demoSong(); song.synth = false;
  ac = { currentTime: 0 }; offset = 0; reset(); t0 = 0;
  const rateEvents = [], stopped = [];
  stemPlayer = { playing: true, setRate(rate, at) { for (let i = 0; i < 4; i++) rateEvents.push([i, rate, at]); }, stop() { if (this.playing) for (let i = 0; i < 4; i++) stopped.push(i); this.playing = false; }, setLevel() {} };
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
  audio.stopSounds = () => stopped.push('synth'); changeGroove(-100);
  assert.equal(mode, 'failed'); assert.equal(stemPlayer.playing, false);
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
  const scheduled = []; audio.playNote = (kind, lane, b, when) => scheduled.push(when); audio.playSwitch = () => {}; audio.playPad = () => {}; audio.playCountIn = () => {}; audio.playHiHat = () => {};
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
  audio.output = { gain: gainParam };
  audio.restoreVolume = () => gainParam.setValueAtTime(.8);
  audio.mute = () => gainParam.setTargetAtTime(0);
  ac = { currentTime: 10, state: 'running',
    createBufferSource: () => ({ playbackRate: { setValueAtTime() {} }, disconnect() {}, connect: target => target, start: at => sourceStarts.push(at), stop() {} }),
    createGain: () => ({ gain: gainParam, connect() {}, disconnect() {} }),
    suspend: async () => { ac.state = 'suspended'; }, resume: async () => { ac.state = 'running'; }
  };
  stemPlayer = createStemPlayer(ac, audio.output);
  song.buffers = [{}, {}, {}, {}]; reset(); assert.deepEqual(sourceStarts, [13, 13, 13, 13]);
  ac.currentTime = 20; changeGroove(-80); ac.currentTime = 21;
  const lowTempoPosition = now(), lowTempoSchedule = JSON.stringify(tempo);
  pauseGame();
`, context);
wallTime += 15;
await vm.runInContext('resumeGame()', context);
vm.runInContext(`
  assert.equal(now(), lowTempoPosition); assert.equal(JSON.stringify(tempo), lowTempoSchedule);
  assert.equal(groove, 20); assert.equal(stemPlayer.playing, true); assert.equal(sourceStarts.length, 4, 'pause does not restart stems');
  changeGroove(-100); assert.equal(volumeEvents.at(-1), 0);
  reset(); assert.equal(volumeEvents.at(-1), .8); assert.equal(stemPlayer.playing, true); assert.equal(tempo.length, 1);
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

context.localStorage = {};
vm.runInContext(`
  song = demoSong(); setGrid(song); tracks = buildTracks();
  catalog = [DEMO, { title: 'Another song', slug: 'another' }]; sel = 0; mode = 'title';
  themeSettings = { default: 'neon', songs: {} }; applyTheme(DEMO);
  const notePositions = tracks.map(tr => tr.notes.map(n => [n.t, n.lane]));
  const beforeThemeScore = score, beforeThemeTime = t0, projected = P(20, 1);
  chooseTheme(); assert.equal(theme.name, 'Liquid Dream');
  assert.equal(JSON.parse(localStorage.lockstepThemes).songs.demo, 'liquid');
  assert.deepEqual(tracks.map(tr => tr.notes.map(n => [n.t, n.lane])), notePositions);
  assert.deepEqual(P(20, 1), projected); assert.equal(score, beforeThemeScore); assert.equal(t0, beforeThemeTime);
  assert.equal(tracks[0].color, THEMES.liquid.colors[0]);
  chooseTheme(true); sel = 1; applyTheme(catalog[sel]); assert.equal(theme.name, 'Liquid Dream');
  chooseTheme(); assert.equal(theme.name, 'Paper City');
  sel = 0; applyTheme(DEMO); assert.equal(theme.name, 'Liquid Dream', 'per-song choice survives default/other-song changes');
  mode = 'play'; rt = 300; flash = null; dash = null; inSync = false;
  tracks.forEach((tr, i) => { tr.capAt = 299; tr.capTo = i < 2 ? 8 : -1; });
  draw(2, true); drawCraft(); drawSleeve(song, 48, 136, 310, 190, false); drawResults();
`, context);
assert.ok(calls.some(([name]) => name === 'quadraticCurveTo'), 'liquid craft has curved geometry');
motion.matches = true;
calls = [];
vm.runInContext('drawLiquidWorld(2, false, 400, 190)', context);
const stillWater = calls;
calls = [];
vm.runInContext('drawLiquidWorld(4, false, 400, 190)', context);
assert.deepEqual(calls, stillWater, 'reduced-motion water is static');
for (const stored of ['{invalid', 'null', JSON.stringify({ default: 'unknown', songs: { demo: 'unknown' } }), JSON.stringify({ default: 'neon', songs: { demo: 'liquid' } })]) {
  const fresh = vm.createContext({ ...appImports, ...context, localStorage: { lockstepThemes: stored } });
  vm.runInContext(source, fresh);
  assert.equal(vm.runInContext('theme.name', fresh), stored.includes('liquid') ? 'Liquid Dream' : 'Neon');
}
console.log('ok: per-song/default theme persistence, invalid storage fallback, unchanged gameplay geometry, liquid rendering and reduced motion');

vm.runInContext(`
  themeSettings = { default: 'neon', songs: {} }; catalog = [DEMO]; sel = 0; applyTheme(DEMO);
  const themeCycle = [];
  for (let i = 0; i < 4; i++) { chooseTheme(); themeCycle.push(theme.name); }
  assert.deepEqual(themeCycle, ['Liquid Dream', 'Paper City', 'Circuit Cathedral', 'Neon']);
  const themeNotes = tracks.map(tr => tr.notes.map(n => [n.t, n.lane]));
  for (const key of ['paper', 'circuit']) {
    themeSettings.songs.demo = key; applyTheme(DEMO); chooseTheme(true);
    assert.equal(JSON.parse(localStorage.lockstepThemes).default, key);
    draw(2, true); drawCraft(); drawSleeve(song, 48, 136, 310, 190, false); drawResults();
    assert.deepEqual(tracks.map(tr => tr.notes.map(n => [n.t, n.lane])), themeNotes);
  }
`, context);
for (const key of ['paper', 'circuit']) {
  const fresh = vm.createContext({ ...appImports, ...context, localStorage: { lockstepThemes: JSON.stringify({ default: key }) } });
  vm.runInContext(source, fresh);
  assert.equal(vm.runInContext('theme.name', fresh), key === 'paper' ? 'Paper City' : 'Circuit Cathedral');
  calls = [];
  vm.runInContext(`theme = THEMES.${key}; drawBuiltWorld(2, false, 400, 190)`, context);
  const still = calls;
  calls = [];
  vm.runInContext('drawBuiltWorld(4, false, 400, 190)', context);
  assert.deepEqual(calls, still, 'new scenery has no continuous idle motion');
}
console.log('ok: four-theme cycle, new theme persistence, rendering, unchanged chart data and static scenery');

motion.matches = true; calls = [];
vm.runInContext(`song = demoSong(); tracks = buildTracks(); shake = 12; camX = 100; camTo = -100; draw(12, true); assert.equal(bendX, 0); assert.equal(bendY, 0);`, context);
assert.ok(calls.filter(c => c[0] === 'rotate').every(c => c[1] === 0), 'reduced motion disables camera banking');
assert.ok(calls.some(c => c[0] === 'translate' && c[1] === 400 && c[2] === 300), 'camera stays centered despite shake');
motion.matches = false;

context.location = { href: 'https://game.example/lockstep/?old=1#old' };
await vm.runInContext(`(async () => {
  assert.equal(shareLink({ title: 'local file' }), null);
  for (const url of ['https://audius.co.evil.test/a/b', 'http://audius.co/a/b', 'https://evil.test/a/b', 'https://user@audius.co/a/b', 'https://audius.co/a']) assert.equal(audiusURL(url), null);
  const sourceURL = 'https://audius.co/artist/song';
  const link = new URL(shareLink({ url: sourceURL }));
  assert.equal(link.origin + link.pathname, 'https://game.example/lockstep/');
  assert.equal(link.searchParams.get('audius'), sourceURL); assert.equal(link.hash, ''); assert.equal(link.searchParams.size, 1);
  let requests = [];
  const track = { id: 'abc123', title: 'Shared song', user: { name: 'Artist' }, permalink: '/artist/song', duration: 120, is_streamable: true, access: { stream: true } };
  fetch = async url => { requests.push(url); return { ok: true, json: async () => ({ data: [track] }) }; };
  assert.equal(await resolveSharedTrack(sourceURL), track);
  assert.ok(requests[0].startsWith('https://api.audius.co/v1/resolve?url='));
  await assert.rejects(resolveSharedTrack('https://evil.test/song'), /not an Audius/); assert.equal(requests.length, 1);
  track.access.stream = false; await assert.rejects(resolveSharedTrack(sourceURL), /no longer/); track.access.stream = true;
  track.duration = 601; await assert.rejects(resolveSharedTrack(sourceURL), /10 minutes/); track.duration = 120;
  fetch = async () => ({ ok: false, status: 404 }); await assert.rejects(resolveSharedTrack(sourceURL), /404/);

  // Exercise real import completion, duplicate detection and error propagation.
  crypto = { subtle: { digest: async () => new Uint8Array(32).buffer } };
  OfflineAudioContext = class { async decodeAudioData() { return { duration: 120, numberOfChannels: 1, getChannelData: () => new Float32Array(4) }; } };
  navigator = { storage: {} };
  const writes = [];
  songLibrary.save = async (...args) => writes.push(args);
  importDuration = async () => {};
  work = async () => ({ song: { bpm: 120, tracks: [] }, pcm: [] });
  library = []; jobs = []; job = null;
  let imported;
  jobs.push({ title: 'Shared song', url: sourceURL, bytes: async () => new ArrayBuffer(4), done: e => imported = e });
  await nextJob(); assert.equal(imported.url, sourceURL); assert.equal(library.length, 1); assert.equal(writes.length, 1); assert.equal(job, null);
  let duplicate;
  jobs.push({ title: 'Shared song', bytes: async () => new ArrayBuffer(4), done: e => duplicate = e });
  await nextJob(); assert.equal(duplicate, imported); assert.equal(writes.length, 1);
  let failure;
  jobs.push({ title: 'Broken', bytes: async () => { throw Error('offline'); }, failed: e => failure = e });
  await nextJob(); assert.equal(failure.message, 'offline'); assert.equal(job, null);

  // A closed landing prompt must never start a game when its import finishes.
  let dialogOpen = true, button, closeDialog, pendingImport, played = 0;
  const status = {};
  trackDialog = () => ({ d: { get open() { return dialogOpen; }, insertBefore: b => button = b, close: () => { dialogOpen = false; } }, status, close: {} });
  document.createElement = () => ({ focus() {} });
  resolveSharedTrack = async () => track;
  ac = { resume: async () => {} }; previewPlayer = undefined; start = async () => played++;
  setInterval = () => 1; clearInterval = () => {};
  queueAudius = (t, done) => pendingImport = done;
  library = [];
  await openSharedTrack(sourceURL);
  const preparing = button.onclick(); await Promise.resolve(); dialogOpen = false;
  pendingImport(imported); await preparing; assert.equal(played, 0);
  dialogOpen = true; library = [imported]; catalog = [imported];
  await openSharedTrack(sourceURL); await button.onclick(); assert.equal(played, 1); assert.equal(sel, 0);
})()`, context);
console.log('ok: Audius-only share URLs, resolver validation, unavailable tracks, import completion/errors, deduplication, cancel and cached playback');

context.location = { href: 'https://game.example/lockstep/' };
{
  const texts = [], fillText = canvas.fillText;
  canvas.fillText = (...args) => { fillText(...args); texts.push([args[0], canvas.fillStyle]); };
  const has = (text, color) => texts.some(([t, c]) => t === text && (!color || c === color));
  await vm.runInContext(`(async () => {
    const meta = { v: 7, duration: 60, beats: [], downbeat: 0, tracks: [{ name: 'A', notes: [[0, 0], [1, 1]] }] };
    const e = { title: 'Song — Artist', lib: 'id1', url: 'https://audius.co/artist/song', meta };
    best = {}; level = 1;
    assert.equal(new URL(shareLink(e)).searchParams.size, 1, 'no best: the plain link, audius only');
    best['id1:1'] = { score: 48200, grade: 'A' };
    const link = new URL(shareLink(e));
    assert.deepEqual([...link.searchParams.keys()].sort(), ['audius', 'chart', 'level', 'score'], 'nothing but the challenge rides along');
    assert.equal(JSON.stringify(challengeFrom(link.searchParams, LEVELS.length)), JSON.stringify({ score: 48200, level: 1, chart: chartHash(meta) }), 'reads back what was written');
    level = 2; assert.equal(new URL(shareLink(e)).searchParams.size, 1, 'a best on another level does not count');
    assert.equal(shareLink({ ...e, meta: undefined }), shareLink({ ...e, meta: undefined }), 'no chart, no challenge');
    assert.equal(new URL(shareLink({ ...e, lib: 'other', meta })).searchParams.size, 1, 'a song without a best');

    // Opening a challenge link for a song already in the library.
    let startedAt = null, dialogOpen = true, button;
    trackDialog = () => ({ d: { get open() { return dialogOpen; }, insertBefore: b => button = b, close: () => { dialogOpen = false; } }, status: {}, close: {} });
    document.createElement = () => ({ focus() {} });
    resolveSharedTrack = async () => ({ id: 'abc', title: 'Song', user: { name: 'Artist' }, permalink: '/artist/song' });
    ac = { resume: async () => {} }; previewPlayer = undefined; setInterval = () => 1; clearInterval = () => {};
    start = async () => { startedAt = level; };
    library = [e]; catalog = [e]; level = 0;
    await openSharedTrack('https://audius.co/artist/song', { score: 48200, level: 3, chart: chartHash(meta) });
    await button.onclick();
    assert.deepEqual([startedAt, level], [3, 3], 'the challenge level is set before starting');
    assert.equal(challenge.score, 48200);
    judgeChart(e); assert.equal(challenge.same, true);

    song = demoSong(); reset(); mode = 'play'; run.score = 48000; shown = 48000;
    for (const score of [48000, 48201]) { run.score = shown = score; draw(1, true); }
    reset(); mode = 'over'; run.score = 49440; drawResults();
    reset(); mode = 'over'; run.score = 47000; drawResults();
    judgeChart({ meta: { ...meta, v: 8 } }); assert.equal(challenge.same, false);
    reset(); mode = 'over'; run.score = 47000; drawResults();
    reset(); mode = 'over'; run.score = 48200; drawResults();
    reset(); assert.equal(challenge.score, 48200, 'the challenge survives a retry');

    // Plain over screen for an Audius track offers sharing; a failed one does not.
    challenge = null; menu.selected = menu.entries.indexOf(e);
    reset(); mode = 'over'; drawResults();
    reset(); mode = 'failed'; drawResults();
    challenge = { score: 1, level: 0, chart: 'aaaaaaaa' }; mode = 'over'; setTimeout = () => 0; clearTimeout = () => {}; toTitle(); assert.equal(challenge, null, 'the title clears the challenge');
  })()`, context);
  canvas.fillText = fillText;
  const hud = texts.filter(([t]) => /^TARGET|^@/.test(t)).map(([t, c]) => t + (c ? ' ' + c : ''));
  assert.ok(has('TARGET 048200', 'rgba(255,255,255,.55)') && has('TARGET 048200', '#3ddc97'), 'the HUD target turns green once passed: ' + hud.join(' | '));
  assert.ok(has('CHALLENGE BEATEN BY 1,240'));
  assert.ok(has('1,200 SHORT OF THE CHALLENGE'));
  assert.ok(has('1,200 SHORT OF THE CHALLENGE · different chart'), 'a mismatched hash is flagged');
  assert.ok(has('TIED THE CHALLENGE · different chart'));
  assert.ok(has('share this score'), 'an Audius result offers sharing');
}
console.log('ok: challenge links round-trip, set the level, show on the HUD and results, flag a different chart, and clear on the title');

{
  // Mastery on the sleeve: grades by level in the list and card, CLEAN, and untrusted stored records.
  const texts = [], fillText = canvas.fillText;
  canvas.fillText = (...args) => { fillText(...args); texts.push(args[0]); };
  const count = text => texts.filter(t => t === text).length;
  const drawTitleWith = (stored, lv) => {
    texts.length = 0;
    vm.runInContext(`catalog = [DEMO]; sel = 0; mode = 'title'; rt = 5; best = loadBest(${JSON.stringify(stored)}); level = ${lv}; drawList(); drawCard();`, context);
  };
  const stored = JSON.stringify({
    'demo:0': { score: 100, grade: 'B' },
    'demo:2': { score: 900, grade: 'S', clean: true, tracks: [1, .5, null, .9] },
  });
  drawTitleWith(stored, 0);
  assert.equal(count('B'), 2, 'level 0: its grade in the list row and under its name on the card');
  assert.equal(count('S'), 1, 'only the card shows the other level');
  assert.equal(count('◆ CLEAN'), 0, 'today\'s shape is not clean');
  drawTitleWith(stored, 2);
  assert.equal(count('S'), 2, 'changing the level changes the list row');
  assert.equal(count('B'), 1);
  assert.equal(count('◆ CLEAN'), 1, 'a clean level is tagged on the card');
  drawTitleWith(JSON.stringify({ 'demo:1': { score: 'x', grade: 5, clean: 'yes', tracks: 'nope' }, 'demo:0': { score: 100, grade: 'B', clean: 1, tracks: [5] } }), 1);
  assert.deepEqual(texts.filter(t => /^[SABCD]$/.test(t)), ['B'], 'a wrong-typed record is dropped; the other keeps only its sound fields');
  assert.equal(count('◆ CLEAN'), 0);
  drawTitleWith('not json', 0);
  assert.equal(vm.runInContext('Object.keys(best).length', context), 0, 'unreadable storage is empty');

  // A completed run merges into the record; a failed run leaves it alone.
  vm.runInContext(`{
    best = loadBest(${JSON.stringify(stored)}); song = demoSong(); level = 0; playKey = 'demo'; reset();
    run.score = 50; run.hits = 30; run.captures = 1; tracks[0].hits = 10; saveBest();
    assert.equal(best['demo:0'].score, 100, 'a lower score keeps the old score'); assert.equal(newBest, false);
    assert.equal(best['demo:0'].clean, true, 'but a clean run earns CLEAN'); assert.equal(best['demo:0'].tracks[0], 1);
    const before = JSON.stringify(best); reset(); run.score = 99999; run.hits = 50; changeGroove(-1000);
    assert.equal(mode, 'failed'); assert.equal(JSON.stringify(best), before, 'a failed run saves nothing');
  }`, context);
  canvas.fillText = fillText;
}
console.log('ok: mastery marks follow the level, CLEAN, wrong-typed records, run merging and failed runs');

{
  // Practice: no failure, a loop that seeks back, a slower transport judged in real milliseconds, nothing saved.
  const texts = [], fillText = canvas.fillText;
  canvas.fillText = (...args) => { fillText(...args); texts.push(args[0]); };
  vm.runInContext(`{
    song = demoSong(); song.synth = false; ac = { currentTime: 0 }; localStorage = { lockstepBest: 'untouched' };
    audio.playCapture = () => {}; audio.playCountIn = () => {};
    practice = true; practiceRate = 1; loop = null; reset(); mode = 'play'; offset = 0;
    assert.equal(tempo[0].rate, 1);

    // Miss 40 notes in a row: the run goes on at full groove.
    const mk = t => ({ t, lane: 0, bar: bar(t), hit: false, missed: false, len: 0, holding: false, ended: false, broken: false });
    tracks.forEach(tr => { tr.notes = []; tr.judged = 0; });
    tracks[0].notes = Array.from({ length: 40 }, (_, k) => mk(k * .25 + 4));
    cur = 0; run.currentTrack = 0; ac.currentTime = 100; t0 = 0; logic(30);
    assert.deepEqual([run.misses, run.groove, mode], [40, 100, 'play'], 'forty misses in practice');
    assert.equal(tempo.at(-1).rate, 1, 'and no groove slowdown');

    // A fully hit phrase shows PHRASE CLEAR and the track stays playable (nothing locks).
    reset(); mode = 'play'; tracks.forEach(tr => { tr.notes = []; tr.judged = 0; });
    tracks[0].notes = [mk(bars[0]), mk(bars[0] + .1)]; cur = 0; run.currentTrack = 0; t0 = 0; ac.currentTime = bars[0];
    tryHit(0, undefined, bars[0]); tryHit(0, undefined, bars[0] + .1);
    assert.ok(tracks[0].notes.every(n => n.hit), 'the whole phrase was hit'); assert.equal(run.captures, 0);
    assert.ok(pops.some(p => p.text === 'PHRASE CLEAR'), 'PHRASE CLEAR is shown');
    assert.ok(!locked(tracks[0], bars[0]), 'practice never locks a phrase');
  }`, context);
  vm.runInContext(`{
    // Loop one phrase, run past its end: back one bar before its start, with its notes playable again.
    song = demoSong(); song.synth = false; ac = { currentTime: 50 }; practice = true; practiceRate = 1; loop = null; reset(); mode = 'play';
    const t1 = bars[2] + .1;
    toggleLoop(t1); assert.deepEqual({ ...loop }, { from: bars[2], to: null });
    toggleLoop(t1); assert.deepEqual({ ...loop }, { from: bars[2], to: bars[4] }, 'B twice loops the phrase');
    for (const tr of tracks) { tr.judged = tr.notes.length; for (const n of tr.notes) if (n.t >= bars[1]) n.hit = true; }
    ac.currentTime = 60; logic(bars[4] + .01);
    assert.ok(Math.abs(now() - (bars[1] - SEEK_LEAD)) < 1e-9, 'one bar before the loop start (less the lead)');
    assert.ok(Math.abs(sched - (bars[1] - SEEK_LEAD)) < 1e-9);
    for (const tr of tracks) {
      assert.equal(tr.judged, noteIndex(tr.notes, bars[1]), 'judged cursor at the pre-roll');
      assert.ok(tr.notes.every(n => !n.hit && !n.missed), 'notes from the pre-roll on are unhit');
    }
    toggleLoop(t1); assert.equal(loop, null, 'a third B clears it');
    ac.currentTime = 70; const before = t0; logic(bars[4] + .5); assert.equal(t0, before, 'no loop, no seek');

    // The speed steps from 1.0 to 0.5 by tenths; hit windows stay in real milliseconds.
    for (let i = 0; i < 9; i++) stepRate(-1); assert.equal(practiceRate, .5, 'clamped at 0.5');
    for (let i = 0; i < 9; i++) stepRate(1); assert.equal(practiceRate, 1, 'and at 1.0');
    for (let i = 0; i < 3; i++) stepRate(-1); assert.equal(practiceRate, .7);
    assert.equal(tempo.at(-1).rate, .7);
    const note = tracks[0].notes[10]; cur = 0; run.currentTrack = 0; note.hit = false; note.missed = false;
    ac.currentTime = audioTime(note.t) + .05; tryHit(note.lane);
    assert.equal(pops.at(-1).text, '50 ms LATE', 'a press 50 ms late at 0.7 speed is 50 ms late');
    assert.equal(run.groove, 100);

    // Seeking resets the transport to one segment at the current rate.
    seek(bars[4]); assert.equal(tempo.length, 1); assert.equal(tempo[0].rate, .7);
  }`, context);
  // Finishing a practice run saves nothing and says so.
  vm.runInContext(`{
    song = demoSong(); song.synth = false; ac = { currentTime: 0 }; localStorage = { lockstepBest: 'untouched' };
    practice = true; reset(); mode = 'play'; playKey = 'demo'; best = {}; tracks.forEach(tr => { tr.notes = []; tr.judged = 0; });
    run.score = 5000; run.hits = 50; run.captures = 3; logic(song.duration + 2);
    assert.equal(mode, 'over'); assert.equal(localStorage.lockstepBest, 'untouched'); assert.deepEqual({ ...best }, {}); assert.equal(newBest, false);
  }`, context);
  texts.length = 0; vm.runInContext('drawResults()', context);
  assert.ok(texts.some(t => /^PRACTICE \/ /.test(t)) && texts.includes('PRACTICE · BEST NOT SAVED'), 'results are labelled PRACTICE');
  vm.runInContext(`{
    practice = false; reset(); mode = 'play'; tracks.forEach(tr => { tr.notes = []; tr.judged = 0; }); run.score = 5000; run.hits = 50; run.captures = 3; logic(song.duration + 2);
    assert.notEqual(localStorage.lockstepBest, 'untouched', 'the same run outside practice does save');
    toTitle(); assert.equal(practice, false);
  }`, context);
  canvas.fillText = fillText;
}
console.log('ok: practice never fails or locks, loops by seeking, judges slowed presses in real milliseconds and saves nothing');

const beforeSnapshots = snapshots;
vm.runInContext("mode = 'title'; scene.renderScene(1, false)", context);
assert.equal(snapshots - beforeSnapshots, 1, 'one frame snapshot, including nested menu text calls');
// Drawing cannot mutate scoring, captures or note judgement.
context.document.createElement = () => ({ width: 0, height: 0, getContext: () => canvas });
context.windowEvents = windowEvents;
// Hold notes: held to the tail, released early, released by pause, track switch and blur, missed heads and drawing.
vm.runInContext(`{
  ac = { currentTime: 0, state: 'running', suspend: async () => { ac.state = 'suspended'; }, resume: async () => { ac.state = 'running'; } };
  song = demoSong(); song.synth = false; level = 3; reset(); t0 = 0; offset = 0; rt = 400; visualOffset = 0;
  audio.playSwitch = () => {}; audio.playCountIn = () => {};
  const mk = (t, lane, len = 0) => ({ t, lane, bar: 0, hit: false, missed: false, len, holding: false, ended: false, broken: false });
  const sixteenths = (a, b) => (fractionalBeat(beats, b) - fractionalBeat(beats, a)) * 4;
  const hold = (hit = true) => {
    pauseState = null; mode = 'play'; ac.currentTime = 0; groove = 100;
    for (const tr of tracks) { tr.notes = []; tr.holds = []; tr.judged = 0; tr.live = true; }
    tracks[0].notes = [mk(0, 0, 1)]; tracks[0].maxHold = 1; tracks[1].notes = [mk(5, 0)];
    cur = 0; score = 0; mult = 1;
    if (hit) tryHit(0);
    return tracks[0].notes[0];
  };
  let n = hold(); const head = score;
  assert.deepEqual([n.holding, tracks[0].holds.length], [true, 1]);
  ac.currentTime = 1.05; logic(now());
  assert.deepEqual([n.holding, n.ended, n.broken], [false, true, false], 'a hold completes when the song reaches its tail');
  assert.equal(score - head, HOLD_SCORE * mult * Math.round(sixteenths(0, 1)), 'scored at the multiplier the head earned');

  n = hold(); const before = score; ac.currentTime = .5; dispatchAction({ type: 'release', lane: 0 });
  assert.deepEqual([n.holding, n.broken, tracks[0].live], [false, true, false], 'early release breaks the hold and cues the stem');
  assert.equal(score - before, HOLD_SCORE * mult * Math.floor(sixteenths(0, .5)));
  n = hold(); dispatchAction({ type: 'release', lane: 1 }); assert.equal(n.holding, true, 'another lane leaves it held');

  n = hold(); ac.currentTime = .3; pauseGame(); assert.equal(mode, 'pause');
  assert.deepEqual([n.holding, n.broken], [false, true], 'pause releases held notes');
  n = hold(); ac.currentTime = .3; move(1); assert.deepEqual([n.holding, n.broken], [false, true], 'switching track releases held notes');
  n = hold(); ac.currentTime = .3; windowEvents.blur.forEach(fn => fn()); assert.deepEqual([n.holding, n.broken], [false, true], 'window blur releases held notes');

  n = hold(false); ac.currentTime = .5; logic(now()); const misses = run.misses; tryHit(0);
  assert.deepEqual([n.missed, n.holding, misses], [true, false, 1], 'a missed head is a miss and its tail cannot be picked up');
  assert.equal(tracks[0].holds.length, 0);
}`, context);
{
  const bodyCalls = (maxHold, time) => vm.runInContext(`
    pauseState = null; mode = 'play'; tracks[0].notes = [{ t: 0, lane: 1, bar: 0, hit: true, missed: false, len: 4, holding: true, ended: false, broken: false }];
    tracks[0].maxHold = ${maxHold}; tracks[1].notes = []; cur = 0; ac.currentTime = ${time}; run.currentTrack = 0;
    calls = []; draw(${time}, true); 0`, context) ?? 0;
  const count = (maxHold, time) => { calls.length = 0; bodyCalls(maxHold, time); return calls.length; };
  assert.ok(count(4, 2) > count(0, 2), 'a held note whose head passed 2 s ago still draws its body');
  assert.equal(count(4, 5), count(0, 5), 'nothing is drawn once the tail has passed');
}
console.log('ok: holds complete at the tail, break early, release on pause, track switch and blur, and draw behind the line');

vm.runInContext(`{
  // Encores: while IN SYNC, a clean pass over the current track's AUTO phrase extends every lock.
  song = demoSong(); song.synth = true; ac = { currentTime: 0 }; reset(); t0 = 0; offset = 0;
  audio.playCapture = () => {}; audio.playCountIn = () => {};
  let played = 0; audio.playNote = () => { played++; };
  const mk = t => ({ t, lane: 0, bar: bar(t), hit: false, missed: false, len: 0, holding: false, ended: false, broken: false });
  const setup = () => {
    reset(); mode = 'play'; played = 0;
    tracks.forEach((tr, i) => { tr.notes = i === 0 ? [mk(0), { ...mk(.2), lane: 1 }] : []; tr.capFrom = 0; tr.capTo = 8; });
    cur = 0; run.currentTrack = 0; run.multiplier = 2; run.groove = 90; updateSync(0);
    assert.equal(inSync, true);
  };
  setup();
  const before = { ...run };
  tryHit(0, undefined, 0); tryHit(1, undefined, .2);
  assert.deepEqual([run.bonusHits, run.hits, run.strays, run.encores], [2, 0, 0, 1]);
  assert.equal(run.score - before.score, 2 * 15 * 2 * 2 + 100 * 2, 'two doubled hits plus the encore bonus at the multiplier');
  assert.ok(tracks.every(tr => tr.capTo === 8 + ENCORE_BARS), 'every locked track gets two bars');
  assert.equal(played, 0, 'the synth already sounds AUTO notes; the press adds no second voice');
  assert.equal(accuracy(run), accuracy(before), 'accuracy is untouched');
  assert.equal(encoreOpen(run, inSync), false, 'the same track cannot encore twice running');
  const done = { ...run }; tracks[0].notes.push({ ...mk(.4), bar: 0 }); tryHit(0, undefined, .4);
  assert.deepEqual({ ...run }, done, 'a locked track that already gave the encore ignores presses');
  updateSync(BARLEN * 20); assert.equal(run.encoreTrack, -1, 'losing sync resets pass-it-on');

  setup(); const base = { ...run };
  tryHit(2, undefined, 0);
  assert.deepEqual([run.multiplier, run.strays, run.misses, run.groove, run.encoreVoid], [1, 0, 0, 90, 0], 'a stray in sync only breaks the multiplier and voids the phrase');
  tryHit(0, undefined, 0); tryHit(1, undefined, .2);
  assert.deepEqual([run.encores, run.bonusHits, tracks[1].capTo], [0, 2, 8], 'a voided phrase gives no encore');
  assert.equal(run.score - base.score, 2 * 15 * 1 * 2, 'but the notes still score');

  setup(); const idle = JSON.stringify(run); logic(.5); updateSync(.5);
  assert.equal(JSON.stringify(run), idle, 'an idle player in sync changes nothing');
}`, context);
console.log('ok: encores double-score outside accuracy, extend every lock, pass between tracks, and a stray voids the phrase');
{
  // Scenery follows the music: stem energy through the extended grid, section hues, and the demo/reduced-motion fallbacks.
  const probes = [];
  const fill = canvas.fill, stroke = canvas.stroke, gradient = canvas.createLinearGradient;
  canvas.createLinearGradient = (...args) => { record('createLinearGradient', args); return { addColorStop(_, color) { this.color = color; } }; };
  canvas.fill = (...args) => { fill(...args); if (canvas.fillStyle?.color) probes.push(['floor', canvas.fillStyle.color, canvas.globalAlpha]); };
  canvas.stroke = (...args) => { stroke(...args); if (canvas.lineWidth === 1.5) probes.push(['rail', canvas.strokeStyle, canvas.globalAlpha]); };
  const alphas = (kind, track) => probes.filter(([k, c]) => k === kind && c === vm.runInContext(`tracks[${track}].color`, context)).map(p => p[2]);
  const drawOnce = () => { probes.length = 0; vm.runInContext(`mode = 'play'; rt = 80; run.currentTrack = 0; updateEnergy(barAt(4)); draw(barAt(4), true)`, context); };
  vm.runInContext(`
    var barAt = k => song.beats[song.downbeat + 4 * k] + .01;
    const built = down => {
      const s = demoSong(); s.downbeat = down;
      s.tracks[0].energy = Array.from({ length: s.beats.length }, (_, k) => k >= down && k < down + 32 ? 15 : 0);
      s.sections = [0, 8]; return s;
    };
    for (const down of [0, 2]) {
      song = built(down); setGrid(song); tracks = buildTracks(); phase = 0;
      updateEnergy(barAt(2)); assert.equal(stemEnergy[0], 1, 'loud stem in bar 2, downbeat ' + down);
      assert.equal(stemEnergy[1], 0, 'a stem without energy is silent');
      updateEnergy(barAt(10)); assert.equal(stemEnergy[0], 0, 'quiet in bar 10, downbeat ' + down);
      updateEnergy(-1); assert.equal(intensity, 0, 'zero before the first beat');
      updateEnergy(song.duration + 5); assert.equal(intensity, 0, 'zero after the last');
      updateEnergy(barAt(2)); assert.equal(intensity, .25, 'intensity is the mean');
      const hues = Array.from({ length: 16 }, (_, k) => hueIndex(barAt(k)));
      assert.deepEqual(hues, [...Array(8).fill(0), ...Array(8).fill(1)], 'hue changes at the section and nowhere else, downbeat ' + down);
    }
    phase = .5; updateEnergy(barAt(2)); const mid = stemEnergy[0]; assert.equal(mid, 1, 'blends toward the next beat');
    song = demoSong(); setGrid(song); tracks = buildTracks();
    assert.deepEqual(Array.from({ length: 6 }, (_, k) => hueIndex(barAt(k))), [0, 1, 2, 3, 4, 5], 'without sections the hue steps per bar');
    updateEnergy(barAt(2)); assert.equal(reactive, false, 'the demo has no energy');
  `, context);
  vm.runInContext(`song = demoSong(); setGrid(song); tracks = buildTracks(); phase = 0;`, context);
  drawOnce();
  assert.ok(alphas('floor', 1).every(a => a === .07) && alphas('floor', 1).length, 'the demo keeps the fixed floor glow');
  assert.ok(alphas('rail', 1).includes(.35), 'and the fixed rail alpha');

  vm.runInContext(`
    song = demoSong(); song.sections = [0, 8];
    song.tracks[1].energy = Array.from({ length: song.beats.length }, () => 7.5);
    setGrid(song); tracks = buildTracks(); phase = 0; hue = theme.hues[0];
  `, context);
  vm.runInContext(`updateEnergy(barAt(4)); assert.equal(reactive, true)`, context);
  drawOnce();
  const near = (list, v) => list.length && list.every(a => Math.abs(a - v) < 1e-9);
  assert.ok(near(alphas('floor', 1), .05 + .1 * .5), 'floor glow follows the stem');
  assert.ok(alphas('rail', 1).some(a => Math.abs(a - (.25 + .3 * .5)) < 1e-9), 'rail alpha follows the stem');
  assert.ok(near(alphas('floor', 2), .05), 'a silent stem rests at the low end');

  motion.matches = true;
  drawOnce();
  assert.ok(near(alphas('floor', 1), .07) && alphas('rail', 1).includes(.35), 'reduced motion keeps today\'s glow and rails');
  vm.runInContext(`hue = theme.hues[0]; for (let i = 0; i < 300; i++) draw(barAt(9), true); assert.ok(Math.abs(hue - theme.hues[1]) < 1, 'reduced motion still changes hue at the section')`, context);
  motion.matches = false;
  Object.assign(canvas, { fill, stroke, createLinearGradient: gradient });
}
console.log('ok: stem energy through the extended grid, section hues, floor and rail response, demo and reduced-motion fallbacks');
vm.runInContext(`
  Object.freeze(run);
  for (const track of tracks) {
    track.notes.forEach(Object.freeze); Object.freeze(track.notes); Object.freeze(track);
  }
  Object.freeze(tracks);
  scene.renderScene(1, true);
`, context);
console.log('ok: renderer accepts frozen gameplay state');

