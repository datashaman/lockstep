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
