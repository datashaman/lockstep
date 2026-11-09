import assert from 'node:assert/strict';
import { appSource, appImports } from './test/app-harness.mjs';
import vm from 'node:vm';
const gradient = { addColorStop() {} };
const canvas = new Proxy({}, { get: (o, k) => o[k] ?? (k === 'measureText' ? s => ({ width: s.length * 7 }) : k.startsWith('create') ? () => gradient : () => {}), set: (o, k, v) => (o[k] = v, true) });
const handlers = {};
const context = vm.createContext({ ...appImports, assert, console, URL,
  document: { getElementById: () => ({ getContext: () => canvas, addEventListener() {} }), addEventListener() {} },
  addEventListener: (name, fn) => handlers[name] = fn, requestAnimationFrame() {}, performance: { now: () => 0 },
  fetch: () => Promise.reject(new Error('offline')), clearTimeout() {}, setTimeout() {},
});
const source = appSource;
vm.runInContext(source, context);
function button(key) {
  const events = {}, classes = new Set();
  const b = { dataset: { pad: key }, addEventListener: (name, fn) => events[name] = fn, setPointerCapture() {}, classList: { add: c => classes.add(c), remove: c => classes.delete(c) } };
  context.button = b; vm.runInContext('bindTouchPad(button)', context);
  return { events, classes };
}
const pads = ['j', 'k', 'l', 'ArrowLeft', 'ArrowRight', ' '].map(button);
vm.runInContext(`
  const inputs = []; mode = 'play'; ac = { currentTime: 42 };
  tryHit = lane => inputs.push(['hit', lane, ac.currentTime]);
  move = dir => inputs.push(['move', dir]);
  pauseGame = () => { mode = 'pause'; inputs.push(['pause']); };
`, context);
let prevented = 0;
const down = id => ({ pointerId: id, button: 0, preventDefault() { prevented++; } });
for (let i = 0; i < 3; i++) pads[i].events.pointerdown(down(i + 1));
vm.runInContext("assert.deepEqual(inputs, [['hit',0,42],['hit',1,42],['hit',2,42]]); assert.equal(touchPointers.size, 3)", context);
assert.equal(prevented, 3, 'every simultaneous pointer is accepted immediately');
pads[0].events.pointerdown(down(1)); // duplicate pointer must not double-hit
pads[0].events.click({ detail: 1 });
vm.runInContext('assert.equal(inputs.length, 3)', context);
pads[0].events.pointercancel({ pointerId: 1 }); assert.equal(pads[0].classes.size, 0);
pads[1].events.lostpointercapture({ pointerId: 2 }); pads[2].events.pointerup({ pointerId: 3 });
vm.runInContext('assert.equal(touchPointers.size, 0)', context);
pads[3].events.pointerdown(down(4)); pads[4].events.pointerdown(down(5));
pads[0].events.click({ detail: 0 }); // native keyboard/assistive activation
vm.runInContext("assert.deepEqual(inputs.slice(3), [['move',-1],['move',1],['hit',0,42]])", context);
pads[5].events.pointerdown(down(6)); pads[0].events.pointerdown(down(7));
vm.runInContext("assert.equal(mode, 'pause'); assert.equal(inputs.length, 7); clearTouchPointers(); assert.equal(touchPointers.size, 0)", context);
for (const pad of pads) assert.equal(pad.classes.size, 0);
vm.runInContext(`
  offset = 0; handleKey({ key: ']' }); assert.equal(offset, .01, 'touch calibration works while paused');
  handleKey({ key: '[' }); assert.equal(offset, 0);
  mode = 'find'; au.q = 'song';
  handleKey({ key: 'x', target: { closest: () => true } }); assert.equal(au.q, 'song', 'native search owns text input');
  mode = 'title'; catalog = [DEMO, ADD]; sel = 0; delArm = rt;
  pick(1); assert.equal(delArm, -9, 'changing songs disarms delete confirmation');
`, context);
console.log('ok: simultaneous pads, immediate audio-clock input, no duplicate clicks, pointer cancellation, track switching, pause gating, keyboard activation, native search and touch calibration');

vm.runInContext(`
  assert.throws(() => context2D({ getContext: () => null }), /Canvas 2D is unavailable/);
  const originalGetElement = document.getElementById;
  document.getElementById = () => null;
  assert.throws(() => requiredElement('missing'), /Missing required element: missing/);
  document.getElementById = originalGetElement;
`, context);
assert.doesNotThrow(() => handlers.drop({ preventDefault() {}, dataTransfer: null }));
context.crypto = { subtle: { digest: async () => new Uint8Array([1, 2]).buffer } };
context.OfflineAudioContext = class {
  async decodeAudioData() { return { duration: 2, numberOfChannels: 1, getChannelData: () => new Float32Array(4) }; }
};
await vm.runInContext(`
  (async () => {
    importDuration = async () => {};
    work = async () => ({ song: {} });
    let saves = 0, failure;
    songLibrary.save = async () => saves++;
    menu.library = [];
    jobs.push({ title: 'missing PCM', bytes: async () => new ArrayBuffer(4), failed: error => failure = error });
    await nextJob();
    assert.equal(saves, 0, 'missing audio must not save an incomplete song');
    assert.match(failure.message, /Separator returned no audio/);
    assert.equal(job, null, 'failed import releases the queue');
  })()
`, context);
