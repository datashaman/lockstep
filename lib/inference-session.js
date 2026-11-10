/** A Demucs session whose ONNX runtime lives in a replaceable child worker (inference.js).
 *
 * On iPad Safari the GPU process can be reset mid-song; the WebGPU device is then lost and
 * `session.run` never settles. A failed, lost or stalled run replaces the child and retries the
 * same chunk: twice on the GPU (a fresh device usually succeeds), then once on the CPU. After two
 * chunks have needed the CPU, the rest of the song stays there instead of resetting the GPU again.
 *
 * @param {() => Promise<ArrayBuffer>} model fresh ONNX bytes for each child, which takes
 *   ownership; reading them per child (from Cache Storage) avoids holding 180 MB between restarts
 * @param {() => Worker} spawn starts an inference.js worker
 * @param {{ firstRunMs?: number, minStallMs?: number }} [limits] a run is stalled after
 *   `firstRunMs` until one has finished, then after 5x the slowest run (at least `minStallMs`)
 */
export async function createInferenceSession(
  model,
  spawn,
  { firstRunMs = 10 * 60e3, minStallMs = 60e3 } = {},
) {
  /** @type {ReturnType<typeof startChild> | null} */
  let child = null;
  let slowest = 0,
    cpuChunks = 0;

  /** @param {boolean} cpu */
  async function open(cpu) {
    const bytes = await model();
    const next = startChild(spawn(), cpu);
    try {
      const ready = await next.call(
        { type: "load", model: bytes, cpu },
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

  const first = await open(false);
  child = first;
  return {
    inputNames: first.inputNames,
    outputNames: first.outputNames,
    /** @param {Record<string, import("./worker").InferenceTensor>} feeds */
    async run(feeds) {
      /** @type {Record<string, import("./worker").InferenceTensor>} */
      const plain = {};
      for (const [name, { data, dims }] of Object.entries(feeds))
        plain[name] = { data, dims };
      for (let attempt = 0; ; attempt++) {
        const cpu = attempt === 2 || cpuChunks >= 2;
        try {
          if (child && child.cpu !== cpu) child.worker.terminate();
          if (!child || child.cpu !== cpu) child = await open(cpu);
          const started = Date.now();
          const reply = await child.call(
            { type: "run", feeds: plain },
            slowest && !cpu ? Math.max(minStallMs, 5 * slowest) : firstRunMs,
          );
          if (reply.type !== "result")
            throw new Error("unexpected inference reply");
          if (!cpu) slowest = Math.max(slowest, Date.now() - started);
          if (attempt === 2) cpuChunks++;
          /** @type {Record<string, import("./worker").InferenceTensor & { dispose(): void }>} */
          const outputs = {};
          for (const [name, tensor] of Object.entries(reply.outputs))
            outputs[name] = { ...tensor, dispose() {} };
          return outputs;
        } catch (err) {
          child?.worker.terminate();
          child = null;
          if (attempt === 2 || cpu) throw err;
        }
      }
    },
  };
}

/** One child worker; requests are sequential, so a single pending reply slot is enough.
 * @param {Worker} worker @param {boolean} cpu */
function startChild(worker, cpu) {
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
  worker.onmessage = (
    /** @type {MessageEvent<import("./worker").InferenceResponse>} */ { data },
  ) => {
    if (data.type === "error" || data.type === "lost")
      return fail(data.message);
    waiting?.ok(data);
    waiting = null;
  };
  worker.onerror = (event) => fail(event.message || "inference worker failed");
  return {
    worker,
    cpu,
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
