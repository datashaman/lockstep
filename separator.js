// Module worker: Demucs stem separation (onnxruntime-web, WebGPU with WASM fallback) + charting, off the main thread.
// in:  { id, left, right }  stereo Float32Array @ 44.1 kHz (transferred) — separate + chart
//  or  { id, stems }  already-separated stems — re-chart only (no model needed)
// out: { id, type: 'progress', phase: 'model' | 'separate' | 'chart', progress }  then  { id, type: 'done', song, stems }  or  { id, type: 'error', message }
import * as ort from 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.21.0/dist/ort.all.mjs';
import { DemucsProcessor, CONSTANTS } from './vendor/demucs-web/index.js';
import { analyze } from './analyze.js';

const MODEL = CONSTANTS.DEFAULT_MODEL_URL; // ~180 MB HTDemucs ONNX on Hugging Face; cached after the first download
ort.env.wasm.numThreads = self.crossOriginIsolated ? navigator.hardwareConcurrency : 1; // threads need COOP/COEP; WebGPU doesn't

async function modelBytes(post) {
  const cache = await caches.open('lockstep-models');
  const hit = await cache.match(MODEL);
  if (hit) return hit.arrayBuffer();
  const res = await fetch(MODEL);
  if (!res.ok) throw new Error(`model download failed: ${res.status}`);
  const total = +res.headers.get('content-length') || 180e6, reader = res.body.getReader(), parts = [];
  for (let got = 0; ;) { const { done, value } = await reader.read(); if (done) break; parts.push(value); got += value.length; post('model', got / total); }
  const blob = new Blob(parts);
  await cache.put(MODEL, new Response(blob));
  return blob.arrayBuffer();
}

let proc, queue = Promise.resolve();
onmessage = ({ data: { id, left, right, stems: given } }) => queue = queue.then(async () => {
  const post = (phase, progress) => postMessage({ id, type: 'progress', phase, progress });
  try {
    if (given) return postMessage({ id, type: 'done', song: analyze(given, { onProgress: p => post('chart', p) }) });
    if (!proc) {
      proc = new DemucsProcessor({ ort, onProgress: p => post('separate', p.progress) });
      post('model', 0);
      await proc.loadModel(await modelBytes(post));
    }
    post('separate', 0);
    const stems = await proc.separate(left, right);
    const song = analyze(stems, { onProgress: p => post('chart', p) });
    const buffers = Object.values(stems).flatMap(s => [s.left.buffer, s.right.buffer]);
    postMessage({ id, type: 'done', song, stems }, buffers);
  } catch (err) {
    postMessage({ id, type: 'error', message: String(err?.message || err) });
  }
});
