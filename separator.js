// @ts-check
// Module worker: Demucs stem separation (onnxruntime-web, WebGPU with WASM fallback) + charting, off the main thread.
// in:  { id, left, right }  stereo Float32Array @ 44.1 kHz (transferred) — separate + chart
//  or  { id, stems }  already-separated stems — re-chart only (no model needed)
// out: { id, type: 'progress', phase: 'model' | 'separate' | 'chart', progress }  then  { id, type: 'done', song, pcm }  or  { id, type: 'error', message }
import { DemucsProcessor, CONSTANTS } from "./vendor/demucs-web/index.js";
import { analyze } from "./analyze.js";

/** @type {import("./lib/worker").SeparatorScope} */
const workerScope = /** @type {import("./lib/worker").SeparatorScope} */ (
  /** @type {unknown} */ (globalThis)
);

const MODEL = CONSTANTS.DEFAULT_MODEL_URL; // ~180 MB HTDemucs ONNX on Hugging Face; cached after the first download

/** @param {(phase:"model",progress:number)=>void} post */
async function modelBytes(post) {
  const cache = await caches.open("lockstep-models");
  const hit = await cache.match(MODEL);
  if (hit) return hit.arrayBuffer();
  const res = await fetch(MODEL);
  if (!res.ok) throw new Error(`model download failed: ${res.status}`);
  if (!res.body) throw new Error("Model download returned no body.");
  const total = Number(res.headers.get("content-length")) || 180e6,
    reader = res.body.getReader(),
    parts = [];
  for (let got = 0; ; ) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    got += value.length;
    post("model", got / total);
  }
  const blob = new Blob(parts);
  await cache.put(MODEL, new Response(blob));
  return blob.arrayBuffer();
}

/** @param {Float32Array} a */
const f2i = (a) => {
  const o = new Int16Array(a.length);
  for (let i = 0; i < a.length; i++)
    o[i] = Math.max(-1, Math.min(1, a[i])) * 32767;
  return o;
};

let proc,
  queue = Promise.resolve();
workerScope.onmessage = ({ data: { id, left, right, stems: given } }) =>
  (queue = queue.then(async () => {
    /** @param {"model"|"separate"|"chart"} phase @param {number} progress */
    const post = (phase, progress) =>
      workerScope.postMessage({ id, type: "progress", phase, progress });
    try {
      if (given)
        return workerScope.postMessage({
          id,
          type: "done",
          song: analyze(given, { onProgress: (p) => post("chart", p) }),
        });
      if (!proc) {
        const ort = await import(
          "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.21.0/dist/ort.all.mjs"
        );
        ort.env.wasm.numThreads = self.crossOriginIsolated
          ? navigator.hardwareConcurrency
          : 1;
        const candidate = new DemucsProcessor({ ort });
        post("model", 0);
        await candidate.loadModel(await modelBytes(post));
        proc = candidate;
      }
      proc.onProgress = (p) => post("separate", p.progress);
      post("separate", 0);
      /** @type {import("./lib/worker").FloatStems} */
      const stems = await proc.separate(left, right);
      left = right = undefined; // Input is no longer needed during charting and PCM packing.
      const song = analyze(stems, { onProgress: (p) => post("chart", p) });
      // Replace channels one at a time; never send the full float stems alongside their stored PCM copy.
      /** @type {Record<string,{left:Float32Array|Int16Array,right:Float32Array|Int16Array}>} */
      const packed = stems;
      for (const stem of Object.values(packed))
        for (const channel of /** @type {const} */ (["left", "right"]))
          stem[channel] = f2i(/** @type {Float32Array} */ (stem[channel]));
      const pcm = song.tracks.map(
        (tr) =>
          /** @type {[Int16Array,Int16Array]} */ ([
            packed[tr.stem].left,
            packed[tr.stem].right,
          ]),
      );
      workerScope.postMessage(
        { id, type: "done", song, pcm },
        pcm.flat().map((channel) => channel.buffer),
      );
    } catch (err) {
      workerScope.postMessage({
        id,
        type: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }));
