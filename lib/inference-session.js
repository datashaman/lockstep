/** A Demucs session whose ONNX runtime lives in a replaceable inference.js worker.
 *
 * On iPad Safari the GPU process can be reset mid-song; the WebGPU device is then lost and
 * `session.run` never settles. A lost, failed or stalled run replaces the child, whose fresh
 * worker gets a fresh device, and retries the chunk up to twice more before giving up. There is
 * deliberately no CPU fallback: the WebAssembly path needs more memory than an iPad tab gets.
 *
 * @param {() => Promise<ArrayBuffer>} model fresh ONNX bytes for each child, which takes
 *   ownership; reading them per child (from Cache Storage) avoids holding 180 MB between restarts
 * @param {() => import("./worker").InferenceChild} spawn starts an inference.js worker
 * @param {{ firstRunMs?: number, minStallMs?: number }} [limits] a run is stalled after
 *   `firstRunMs` until one has finished, then after 5x the slowest run (at least `minStallMs`)
 */
export async function createInferenceSession(
  model,
  spawn,
  { firstRunMs = 10 * 60e3, minStallMs = 60e3 } = {},
) {
  async function open() {
    const bytes = await model();
    const next = startChild(spawn());
    try {
      const ready = await next.call(
        { type: "load", model: bytes },
        firstRunMs,
        [bytes],
      );
      if (ready.type !== "ready") throw new Error("inference worker not ready");
      return {
        ...next,
        inputNames: ready.inputNames,
        outputNames: ready.outputNames,
      };
    } catch (err) {
      next.worker.terminate();
      throw err;
    }
  }

  /** @type {Awaited<ReturnType<typeof open>> | null} */
  let child = await open();
  const { inputNames, outputNames } = child;
  let slowest = 0;
  return {
    inputNames,
    outputNames,
    /** @param {Record<string, import("./worker").InferenceTensor>} feeds */
    async run(feeds) {
      /** @type {Record<string, import("./worker").InferenceTensor>} */
      const plain = {};
      for (const [name, { data, dims }] of Object.entries(feeds))
        plain[name] = { data, dims };
      for (let attempt = 0; ; attempt++) {
        try {
          child ??= await open();
          const started = Date.now();
          const reply = await child.call(
            { type: "run", feeds: plain },
            slowest ? Math.max(minStallMs, 5 * slowest) : firstRunMs,
          );
          if (reply.type !== "result")
            throw new Error("unexpected inference reply");
          slowest = Math.max(slowest, Date.now() - started);
          /** @type {Record<string, import("./worker").InferenceTensor & { dispose(): void }>} */
          const outputs = {};
          for (const [name, tensor] of Object.entries(reply.outputs))
            outputs[name] = { ...tensor, dispose() {} };
          return outputs;
        } catch (err) {
          child?.worker.terminate();
          child = null;
          if (attempt === 2) throw err;
        }
      }
    },
  };
}

/** One child worker; requests are sequential, so a single pending reply slot is enough.
 * @param {import("./worker").InferenceChild} worker */
function startChild(worker) {
  /** @type {{ ok: (reply: import("./worker").InferenceResponse) => void, no: (err: Error) => void } | null} */
  let waiting = null;
  /** @type {Error | null} */
  let failed = null;
  /** @param {string} message */
  const fail = (message) => {
    failed = new Error(message);
    waiting?.no(failed);
    waiting = null;
  };
  worker.onmessage = ({ data }) => {
    if (data.type === "note") return;
    if (data.type === "error" || data.type === "lost")
      return fail(data.message);
    waiting?.ok(data);
    waiting = null;
  };
  worker.onerror = (event) => fail(event.message || "inference worker failed");
  return {
    worker,
    /** @param {import("./worker").InferenceRequest} msg @param {number} ms @param {Transferable[]} [transfer]
     * @returns {Promise<import("./worker").InferenceResponse>} */
    call(msg, ms, transfer = []) {
      if (failed) return Promise.reject(failed);
      return new Promise((ok, no) => {
        const timer = setTimeout(
          () => fail(`inference stalled for ${Math.round(ms / 1000)} s`),
          ms,
        );
        waiting = {
          ok: (reply) => (clearTimeout(timer), ok(reply)),
          no: (err) => (clearTimeout(timer), no(err)),
        };
        worker.postMessage(msg, transfer);
      });
    },
  };
}
