import assert from 'node:assert/strict';
import { createLiquidShader } from './liquid-shader.js';
import { createThemeShader, THEME_FRAGMENTS } from './theme-shaders.js';

function harness({ unsupported = false, compile = true, link = true, factory = createLiquidShader } = {}) {
  let draws = 0, copies = 0, canvases = 0, buffers = 0, programs = 0, deletedShaders = 0, lost = false;
  const events = {}, values = {};
  const gl = new Proxy({
    getShaderParameter: () => compile, getProgramParameter: () => link,
    createShader: () => ({}), deleteShader: () => deletedShaders++,
    createProgram: () => { programs++; return {}; }, deleteProgram: () => programs--,
    createBuffer: () => { buffers++; return {}; }, deleteBuffer: () => buffers--,
    getUniformLocation: (_, name) => name,
    uniform1f: (name, v) => values[name] = v,
    uniform4fv: (name, v) => values[name] = [...v],
    drawArrays: () => draws++, isContextLost: () => lost,
    getExtension: () => ({ loseContext: () => lost = true }),
  }, { get: (o, key) => o[key] ?? (() => {}) });
  const create = () => {
    const index = canvases++;
    return { addEventListener: (name, fn) => events[name] = fn,
      getContext: (type, options) => {
        if (index === 0) { assert.equal(type, 'webgl'); assert.equal(options.preserveDrawingBuffer, false); assert.equal(options.failIfMajorPerformanceCaveat, true); return unsupported ? null : gl; }
        assert.equal(type, '2d'); return { drawImage: () => copies++ };
      },
    };
  };
  const shader = factory(create);
  return { shader, events, values, stats: () => ({ draws, copies, canvases, buffers, programs, deletedShaders }),
    lose() { lost = true; events.webglcontextlost({ preventDefault() {} }); buffers = programs = 0; },
    restore() { lost = false; events.webglcontextrestored(); } };
}
const h = harness(), ages = new Float32Array([.1, .4, -1, 1.7]);
let surface;
for (let play = 0; play < 20; play++) for (let frame = 0; frame < 60; frame++) surface = h.shader.render(play + frame / 60, ages, .75);
assert.equal(surface.width, 320); assert.equal(surface.height, 240);
assert.ok(h.stats().draws <= 600, 'at most 30 shader draws per second');
assert.equal(h.stats().copies, h.stats().draws, 'copy each completed frame immediately');
assert.equal(h.stats().canvases, 2); assert.equal(h.stats().buffers, 1); assert.equal(h.stats().programs, 1);
assert.equal(h.stats().deletedShaders, 2, 'shader objects released after linking');
assert.deepEqual(h.values.captures, [...ages]);
const before = h.stats().draws;
for (let i = 0; i < 60; i++) h.shader.render(30 + i, ages, 1, true);
assert.equal(h.stats().draws, before + 1, 'reduced motion renders one still frame');
assert.equal(h.values.time, 0); assert.equal(h.values.energy, 0); assert.deepEqual(h.values.captures, [-1, -1, -1, -1]);
h.lose(); assert.equal(h.shader.render(40, ages, 1), null, 'lost context requests Canvas fallback');
h.restore(); assert.equal(h.shader.render(41, ages, 1), surface, 'restore rebuilds GPU resources, reuses surface');
assert.equal(h.stats().buffers, 1); assert.equal(h.stats().programs, 1); assert.equal(h.stats().canvases, 2);
for (const options of [{ unsupported: true }, { compile: false }, { link: false }]) {
  const failed = harness(options); assert.equal(failed.shader, null);
  assert.equal(failed.stats().programs, 0); assert.equal(failed.stats().buffers, 0);
}
console.log('ok: 30 fps ceiling, stable GPU resources across 20 plays, immediate frame copy, reduced motion, unsupported/compile/link fallback and context restoration');

const themes = harness({ factory: createThemeShader });
const keys = Object.keys(THEME_FRAGMENTS);
for (let play = 0; play < 20; play++) for (const key of keys) {
  themes.shader.select(key);
  assert.ok(themes.shader.render(key, 1, ages, .5));
  assert.equal(themes.stats().buffers, 1, 'switch releases the old buffer');
  assert.equal(themes.stats().programs, 1, 'switch releases the old program');
}
assert.equal(themes.stats().canvases, 2, 'all themes share one WebGL context and copy surface');
assert.equal(themes.stats().draws, 20 * keys.length, 'switch invalidates cached image even in the same time slot');
assert.equal(themes.shader.render('unknown', 2, ages, 0), null);
assert.equal(themes.shader.render('__proto__', 2, ages, 0), null);
themes.lose(); assert.equal(themes.shader.render(keys[0], 2, ages, 0), null);
themes.restore(); assert.ok(themes.shader.render(keys[0], 2, ages, 0));
console.log('ok: theme switching retains one program/buffer and two surfaces, refreshes cached output, rejects unknown themes and restores the selected shader');
