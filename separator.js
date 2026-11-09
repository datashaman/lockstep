// Module worker: Demucs stem separation (onnxruntime-web, WebGPU with WASM fallback) + charting, off the main thread.
// in:  { id, left, right }  stereo Float32Array @ 44.1 kHz (transferred) — separate + chart
//  or  { id, stems }  already-separated stems — re-chart only (no model needed)
// out: { id, type: 'progress', phase: 'model' | 'separate' | 'chart', progress }  then  { id, type: 'done', song, pcm }  or  { id, type: 'error', message }
import { DemucsProcessor, CONSTANTS } from './vendor/demucs-web/index.js';
import { analyze } from './analyze.js';

const MODEL = CONSTANTS.DEFAULT_MODEL_URL; // ~180 MB HTDemucs ONNX on Hugging Face; cached after the first download

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

const f2i = a => { const o = new Int16Array(a.length); for (let i = 0; i < a.length; i++) o[i] = Math.max(-1, Math.min(1, a[i])) * 32767; return o; };

let proc, queue = Promise.resolve();
onmessage = ({ data: { id, left, right, stems: given } }) => queue = queue.then(async () => {
  const post = (phase, progress) => postMessage({ id, type: 'progress', phase, progress });
  try {
    if (given) return postMessage({ id, type: 'done', song: analyze(given, { onProgress: p => post('chart', p) }) });
    if (!proc) {
      const ort = await import('https://cdn.jsdelivr.net/npm/onnxruntime-web@1.21.0/dist/ort.all.mjs');
      ort.env.wasm.numThreads = self.crossOriginIsolated ? navigator.hardwareConcurrency : 1;
      const candidate = new DemucsProcessor({ ort });
      post('model', 0);
      await candidate.loadModel(await modelBytes(post));
      proc = candidate;
    }
    proc.onProgress = p => post('separate', p.progress);
    post('separate', 0);
    const stems = await proc.separate(left, right);
    left = right = null; // Input is no longer needed during charting and PCM packing.
    const song = analyze(stems, { onProgress: p => post('chart', p) });
    // Replace channels one at a time; never send the full float stems alongside their stored PCM copy.
    for (const stem of Object.values(stems)) for (const channel of ['left', 'right']) stem[channel] = f2i(stem[channel]);
    const pcm = song.tracks.map(tr => [stems[tr.stem].left, stems[tr.stem].right]);
    postMessage({ id, type: 'done', song, pcm }, pcm.flat().map(channel => channel.buffer));
  } catch (err) {
    postMessage({ id, type: 'error', message: String(err?.message || err) });
  }
});
