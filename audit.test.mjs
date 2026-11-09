import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const html = readFileSync('index.html', 'utf8');
// Exercise commit/abort timing and verify both records share one transaction.
let tx;
const records = { songs: new Map(), pcm: new Map() };
const db = { transaction(stores) {
  const staged = Object.fromEntries(Object.entries(records).map(([k,v]) => [k,new Map(v)]));
  tx = { stores, objectStore(name) { assert.ok(stores.includes(name)); return {
    put(value, key = value.id) { staged[name].set(key, value); return { result: key }; },
    delete(key) { staged[name].delete(key); return {}; },
  }; }, abort() { this.onabort(); }, commit() { Object.assign(records, staged); this.oncomplete(); } };
  return tx;
} };
const c = vm.createContext({ dbp: Promise.resolve(db) });
vm.runInContext(html.slice(html.indexOf('const dbTransaction ='), html.indexOf('const i2f =')), c);
let settled = false;
let saving = vm.runInContext("saveSong({ id: 'a' }, [1])", c).then(() => settled = true);
await new Promise(setImmediate); assert.equal(settled, false); assert.deepEqual(Array.from(tx.stores), ['songs','pcm']);
tx.commit(); await saving; assert.ok(records.songs.has('a')); assert.ok(records.pcm.has('a'));
let deleting = vm.runInContext("deleteSong('a')", c);
const aborted = assert.rejects(deleting, /aborted/);
await new Promise(setImmediate); tx.abort(); await aborted;
assert.ok(records.songs.has('a')); assert.ok(records.pcm.has('a'));
saving = vm.runInContext("saveSong({ id: 'b' }, [2])", c);
const failed = assert.rejects(saving, /aborted/); await new Promise(setImmediate); tx.abort(); await failed;
assert.equal(records.songs.has('b'), false); assert.equal(records.pcm.has('b'), false);
deleting = vm.runInContext("deleteSong('a')", c); await new Promise(setImmediate); tx.commit(); await deleting;
assert.equal(records.songs.size + records.pcm.size, 0);
console.log('ok: library mutations wait for commit, save/delete both records atomically, abort preserves data');

const imports = vm.createContext({ navigator: {}, Number, Blob, setTimeout, clearTimeout });
vm.runInContext(html.slice(html.indexOf('const MAX_IMPORT_BYTES'), html.indexOf('const AUDIO =')), imports);
vm.runInContext('checkImportSize(64 * 1024 * 1024); checkImportDuration(600)', imports);
for (const code of ['checkImportSize(64 * 1024 * 1024 + 1)', 'checkImportDuration(Infinity)', 'checkImportDuration(601)', 'checkImportDuration(0)']) assert.throws(() => vm.runInContext(code, imports));
assert.ok(!html.includes('checkImportDevice'), 'imports are not blocked by device identity');
let cancelled = false;
imports.response = { ok:true, headers: { get:()=>null }, body: { getReader:()=>({ read:async()=>({value:{byteLength:64*1024*1024+1}}), cancel:async()=>cancelled=true, releaseLock(){} }) } };
await assert.rejects(vm.runInContext('importBytes(response)', imports), /64 MiB/); assert.ok(cancelled);
let audio, revoked = false;
imports.URL = { createObjectURL:()=> 'blob:test', revokeObjectURL:()=>revoked=true };
imports.document = { createElement:()=> audio = { removeAttribute(){}, load(){} } };
const metadata = vm.runInContext('importDuration(new ArrayBuffer(1))', imports);
audio.duration = 601; const rejectedMetadata = assert.rejects(metadata, /10 minutes/); audio.onloadedmetadata(); await rejectedMetadata;
assert.ok(revoked); assert.equal(audio.onloadedmetadata, null);
console.log('ok: import byte and duration limits, bounded download cancellation, metadata cleanup');

let runtimeLoads = 0, modelAttempts = 0;
const messages = [];
class Processor {
  async loadModel() { if (++modelAttempts === 1) throw Error('model failed'); }
  async separate() { this.onProgress({ progress: .5 }); return { drums: { left:new Float32Array([-2, 0, .5, 2]), right:new Float32Array([1, -.5, 0, -1]) } }; }
}
const worker = vm.createContext({ DemucsProcessor:Processor, CONSTANTS:{ DEFAULT_MODEL_URL:'model' }, self:{}, navigator:{},
  loadRuntime:async()=>{ runtimeLoads++; return { env:{ wasm:{} } }; }, analyze:()=>({tracks:[{stem:'drums'}]}), postMessage:m=>messages.push(m),
  caches:{ open:async()=>({match:async()=>({arrayBuffer:async()=>new ArrayBuffer(0)})}) } });
const source = readFileSync('separator.js','utf8').replace(/^import .*;$/gm,'').replace(/import\('https:[^']+'\)/, 'loadRuntime()');
vm.runInContext(source, worker);
await vm.runInContext("onmessage({data:{id:'chart',stems:{}}})", worker);
assert.equal(runtimeLoads, 0, 'rechart works without loading remote runtime');
for (const id of ['failed','first','second']) await vm.runInContext(`onmessage({data:{id:'${id}'}})`, worker);
assert.equal(messages.find(m=>m.id==='failed').type, 'progress');
assert.ok(messages.some(m=>m.id==='failed' && m.type==='error'));
for (const id of ['first','second']) assert.ok(messages.some(m=>m.id===id && m.progress===.5));
assert.equal(runtimeLoads, 2, 'failed model can retry, then successful model is reused');
console.log('ok: offline rechart, model retry and correctly addressed queued progress');

const saved = messages.find(m=>m.id==='second' && m.type==='done');
assert.equal(saved.stems, undefined);
assert.deepEqual(Array.from(saved.pcm[0][0]), [-32767, 0, 16383, 32767]);
assert.deepEqual(Array.from(saved.pcm[0][1]), [32767, -16383, 0, -32767]);
assert.equal(saved.pcm[0][0].byteLength, 8, 'transfer is 16-bit, half the float stem size');
console.log('ok: worker sends clipped 16-bit PCM without duplicate float stems');
