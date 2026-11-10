import assert from 'node:assert/strict';
import { createInferenceSession } from './lib/inference-session.js';

// Fake inference.js workers. child(...runs) answers 'load' with ready, then its runs in order:
// RESULT, LOST (GPU reset), FAIL (runtime error) or HANG (never replies). Each spawn takes the next child.
const RESULT = { type: 'result', outputs: { audio: { data: new Float32Array([1]), dims: [1] } } };
const LOST = { type: 'lost', message: 'GPU lost: reset' };
const FAIL = { type: 'error', message: 'run failed' };
const HANG = null;
const ready = { type: 'ready', inputNames: ['waveform'], outputNames: ['audio'] };
const child = (...runs) => msg => (msg.type === 'load' ? ready : runs.length ? runs.shift() : RESULT);
let workers;
function open(...children) {
  workers = [];
  const spawn = () => {
    const behave = children.shift() ?? child();
    const worker = {
      cpu: null, terminated: false, onmessage: null, onerror: null,
      postMessage(msg, transfer) {
        if (msg.type === 'load') assert.deepEqual(transfer, [msg.model], 'model bytes are handed over, not copied');
        if (msg.type === 'load') worker.cpu = msg.cpu;
        const reply = behave(msg);
        if (reply) setTimeout(() => worker.onmessage?.({ data: reply }));
      },
      terminate() { worker.terminated = true; },
    };
    workers.push(worker);
    return worker;
  };
  return createInferenceSession(async () => new ArrayBuffer(8), spawn, { firstRunMs: 100, minStallMs: 50 });
}
const feeds = { waveform: { data: new Float32Array(4), dims: [4], dispose() {} } };
const state = () => workers.map(w => `${w.cpu ? 'cpu' : 'gpu'}${w.terminated ? ' ✗' : ''}`);

let session = await open(child(RESULT, LOST), child());
assert.deepEqual([session.inputNames, session.outputNames], [['waveform'], ['audio']]);
const out = await session.run(feeds);
assert.equal(out.audio.data[0], 1);
out.audio.dispose();
assert.equal(workers.length, 1, 'a healthy child serves every chunk');
await session.run(feeds);
assert.deepEqual(state(), ['gpu ✗', 'gpu'], 'a lost GPU is replaced by a fresh GPU child for the same chunk');
console.log('ok: GPU loss replaces the child and retries the chunk');

session = await open(child(HANG), child(LOST), child(), child());
await session.run(feeds);
assert.deepEqual(state(), ['gpu ✗', 'gpu ✗', 'cpu'], 'stall, then loss: the chunk finishes on the CPU');
await session.run(feeds);
assert.deepEqual(state(), ['gpu ✗', 'gpu ✗', 'cpu ✗', 'gpu'], 'the next chunk returns to the GPU');
console.log('ok: stalled runs time out; two GPU failures fall back to the CPU for that chunk');

session = await open(child(LOST), child(LOST), child(), child(LOST), child(LOST), child());
for (let chunk = 0; chunk < 4; chunk++) await session.run(feeds);
assert.deepEqual(state(), ['gpu ✗', 'gpu ✗', 'cpu ✗', 'gpu ✗', 'gpu ✗', 'cpu'], 'after two CPU chunks the song stays on the CPU');
console.log('ok: repeated GPU failure settles on the CPU');

await assert.rejects(open(() => FAIL), /run failed/);
assert.deepEqual(state(), ['gpu ✗'], 'a failed load terminates its child');
session = await open(child(FAIL), child(FAIL), child(FAIL));
await assert.rejects(session.run(feeds), /run failed/, 'a chunk failing on every backend rejects');
assert.deepEqual(state(), ['gpu ✗', 'gpu ✗', 'cpu ✗']);
console.log('ok: load failures and chunks failing on every backend reject');
