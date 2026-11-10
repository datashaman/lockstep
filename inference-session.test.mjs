import assert from 'node:assert/strict';
import { createInferenceSession } from './lib/inference-session.js';
import { createRelayClient, createRelayHost } from './lib/inference-relay.js';

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
      terminated: false, onmessage: null, onerror: null,
      postMessage(msg, transfer) {
        if (msg.type === 'load') assert.deepEqual(transfer, [msg.model], 'model bytes are handed over, not copied');
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
const terminated = () => workers.map(w => w.terminated);

let session = await open(child(RESULT, LOST), child());
assert.deepEqual([session.inputNames, session.outputNames], [['waveform'], ['audio']]);
const out = await session.run(feeds);
assert.equal(out.audio.data[0], 1);
out.audio.dispose();
assert.equal(workers.length, 1, 'a healthy child serves every chunk');
await session.run(feeds);
assert.deepEqual(terminated(), [true, false], 'a lost GPU is replaced by a fresh child for the same chunk');
console.log('ok: GPU loss replaces the child and retries the chunk');

session = await open(child(HANG), child(LOST), child());
await session.run(feeds);
assert.deepEqual(terminated(), [true, true, false], 'a stall, then a loss: the third child finishes the chunk');
await session.run(feeds);
assert.equal(workers.length, 3, 'the recovered child carries on');
console.log('ok: stalled runs time out and are retried');

await assert.rejects(open(() => FAIL), /run failed/);
assert.deepEqual(terminated(), [true], 'a failed load terminates its child');
session = await open(child(FAIL), child(LOST), child(FAIL));
await assert.rejects(session.run(feeds), /run failed/, 'a chunk failing three times rejects');
assert.deepEqual(terminated(), [true, true, true]);
console.log('ok: load failures and chunks failing three times reject');

// Relay: separator ↔ page ↔ inference.js, transferring the large buffers at each hop.
const toPage = [], toSeparator = [], started = [];
const client = createRelayClient({ postMessage: (msg, transfer) => toPage.push({ msg, transfer }) });
const host = createRelayHost({ postMessage: (msg, transfer) => toSeparator.push({ msg, transfer }) }, () => {
  const worker = { sent: [], terminated: false, onmessage: null, onerror: null,
    postMessage(msg, transfer) { worker.sent.push({ msg, transfer }); }, terminate() { worker.terminated = true; } };
  started.push(worker);
  return worker;
});
const handle = client.spawn();
const model = new ArrayBuffer(8);
handle.postMessage({ type: 'load', model }, [model]);
assert.deepEqual(toPage[0].transfer, [model]);
assert.equal(host.receive(toPage[0].msg), true);
assert.equal(started.length, 1, 'the page starts the inference worker on first contact');
assert.deepEqual(started[0].sent[0].transfer, [model], 'the page forwards the model without copying it');
const input = new Float32Array(4);
host.receive({ type: 'inference', child: 1, msg: { type: 'run', feeds: { waveform: { data: input, dims: [4] } } } });
assert.deepEqual(started[0].sent[1].transfer, [input.buffer], 'the page hands its copy of the feeds over');
const replies = [];
handle.onmessage = ({ data }) => replies.push(data);
const output = new Float32Array(2);
started[0].onmessage({ data: { type: 'result', outputs: { audio: { data: output, dims: [2] } } } });
assert.deepEqual(toSeparator[0].transfer, [output.buffer], 'outputs are transferred back to the separator');
assert.equal(client.receive(toSeparator[0].msg), true);
assert.equal(replies[0].outputs.audio.data, output);
let prevented = false;
started[0].onerror({ message: 'boom', preventDefault: () => (prevented = true) });
client.receive(toSeparator[1].msg);
assert.deepEqual(replies[1], { type: 'error', message: 'boom' }, 'a crashed worker reaches the session as an error');
assert.ok(prevented);
handle.terminate();
assert.equal(host.receive(toPage.at(-1).msg), true);
assert.ok(started[0].terminated, 'terminating the handle stops the page-hosted worker');
const second = client.spawn();
second.postMessage({ type: 'load', model: new ArrayBuffer(1) });
host.receive(toPage.at(-1).msg);
host.close();
assert.ok(started[1].terminated, 'closing the host stops its workers');
assert.equal(client.receive({ id: 'job', type: 'progress' }), false, 'job messages pass through');
assert.equal(host.receive({ id: 'job', type: 'done' }), false);
console.log('ok: relay starts, feeds, transfers and stops page-hosted inference workers');
