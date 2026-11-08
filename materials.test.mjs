import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

let surfaces = 0, builds = 0, blits = 0, depth = 0;
const calls = [];
function drawing(offscreen = false) {
  return new Proxy({}, {
    get: (o, key) => o[key] ?? (key === 'measureText' ? s => ({ width: s.length * 7 }) : key.startsWith('create') ? () => ({ addColorStop() {} }) : (...args) => {
      for (const n of args) if (typeof n === 'number') assert.ok(Number.isFinite(n), `${key}: finite coordinates`);
      if (offscreen) builds++;
      else {
        if (key === 'save') depth++; if (key === 'restore') depth--;
        if (key === 'drawImage') blits++;
        calls.push([key, ...args]);
      }
    }),
    set: (o, key, value) => (o[key] = value, true),
  });
}
const g = drawing(), motion = { matches: false };
const context = vm.createContext({ assert, console, URL, performance: { now: () => 0 },
  document: {
    getElementById: () => ({ getContext: () => g, addEventListener() {} }), addEventListener() {},
    createElement: tag => {
      if (tag !== 'canvas') return {};
      surfaces++; const c = drawing(true); return { width: 0, height: 0, getContext: () => c };
    },
  },
  addEventListener() {}, requestAnimationFrame() {}, matchMedia: () => motion,
  fetch: () => Promise.reject(new Error('offline')),
});
const source = readFileSync(new URL('./index.html', import.meta.url), 'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
vm.runInContext(source, context);
vm.runInContext(`
  for (const style of Object.values(THEMES)) {
    theme = style;
    const material = materialTexture();
    assert.equal(material.width, 400); assert.equal(material.height, 300);
    assert.equal(materialTexture(), material, 'reuse each theme material');
  }
  assert.equal(materialCache.size, 4);
`, context);
assert.equal(surfaces, 4);
const built = builds;
calls.length = 0;
vm.runInContext(`
  for (let play = 0; play < 20; play++) for (const style of Object.values(THEMES)) {
    theme = style;
    for (let frame = 0; frame < 60; frame++) drawMaterial(400, 190);
  }
`, context);
assert.equal(surfaces, 4, 'replays and theme changes retain exactly four surfaces');
assert.equal(builds, built, 'no texture regeneration during rendering');
assert.equal(blits, 20 * 4 * 60, 'one cached blit per frame');
assert.equal(depth, 0, 'drawing state restored');
assert.ok(calls.some(([key]) => key === 'clip'), 'texture excludes the highway centre');
console.log('ok: four cached 400×300 materials (~1.83 MiB RGBA), one blit/frame, no regeneration over 20 plays, finite clipped geometry');
