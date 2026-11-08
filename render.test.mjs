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
const context = vm.createContext({
  console: { ...console, assert: (value, ...message) => assert.ok(value, message.join(' ')) },
  document: { getElementById: () => ({ getContext: () => canvas, addEventListener() {} }) },
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
vm.runInContext("catalog = [DEMO]; sel = 0; mode = 'title'; ac = { currentTime: 20 }; camX = 100;", context);
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
