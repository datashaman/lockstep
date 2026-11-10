// @ts-check
// Module worker owning onnxruntime-web and the Demucs session. The page starts it for separator.js
// (Safari gives nested workers no WebGPU) and replaces it when the GPU is lost or a run stalls:
// a new worker is the only way to get a fresh WebGPU device.
// Protocol: lib/worker.ts InferenceRequest / InferenceResponse.

/** @type {import("./lib/worker").InferenceScope} */
const scope = /** @type {import("./lib/worker").InferenceScope} */ (
  /** @type {unknown} */ (globalThis)
);

/** @type {Promise<import("https://cdn.jsdelivr.net/npm/onnxruntime-web@1.21.0/dist/ort.all.mjs").InferenceSession> | undefined} */
let session;
/** @type {typeof import("https://cdn.jsdelivr.net/npm/onnxruntime-web@1.21.0/dist/ort.all.mjs") | undefined} */
let ort;

/** Releases a typed array's memory immediately by detaching its buffer.
 * ArrayBuffer.prototype.transfer is ES2024 (Safari 17.4+); older engines leave it to the GC.
 * @param {{ buffer: object }} array */
function free(array) {
  const buffer = /** @type {{ transfer?: (length: number) => unknown }} */ (
    array.buffer
  );
  buffer.transfer?.(0);
}

/** @param {import("./lib/worker").InferenceRequest} msg */
async function handle(msg) {
  if (msg.type === "load") {
    ort = await import(
      "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.21.0/dist/ort.all.mjs"
    );
    ort.env.wasm.numThreads = self.crossOriginIsolated
      ? navigator.hardwareConcurrency
      : 1;
    const ready = await (session = ort.InferenceSession.create(msg.model, {
      executionProviders: ["webgpu", "wasm"],
      graphOptimizationLevel: "basic",
    }));
    free(new Uint8Array(msg.model)); // the runtime has copied the model into its own memory
    // On iPad a GPU process reset leaves session.run pending forever; this is the only signal.
    ort.env.webgpu.device?.lost.then((info) =>
      scope.postMessage({
        type: "lost",
        message: `GPU lost: ${info.message || "reset"}`,
      }),
    );
    return scope.postMessage({
      type: "ready",
      inputNames: ready.inputNames,
      outputNames: ready.outputNames,
    });
  }
  if (!session || !ort) throw new Error("Model not loaded.");
  const { Tensor } = ort;
  /** @type {Record<string, InstanceType<typeof Tensor>>} */
  const feeds = {};
  for (const [name, { data, dims }] of Object.entries(msg.feeds))
    feeds[name] = new Tensor("float32", data, dims);
  let results;
  try {
    results = await (await session).run(feeds);
  } finally {
    // The feeds were copied into this worker; free them now rather than at the next full GC.
    for (const { data } of Object.values(msg.feeds)) free(data);
  }
  /** @type {Record<string, import("./lib/worker").InferenceTensor>} */
  const outputs = {};
  for (const [name, { data, dims }] of Object.entries(results))
    outputs[name] = { data, dims };
  // Transferring moves the outputs out of this worker, whose heap the WebAssembly runtime dominates.
  scope.postMessage(
    { type: "result", outputs },
    Object.values(outputs).map(({ data }) => data.buffer),
  );
}

scope.onmessage = ({ data }) =>
  handle(data).catch((err) =>
    scope.postMessage({
      type: "error",
      message: err instanceof Error ? err.message : String(err),
    }),
  );
