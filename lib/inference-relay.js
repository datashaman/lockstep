/** Safari gives workers started by other workers no WebGPU, and without it the model falls back to
 * WebAssembly, which needs more memory than an iPad tab gets. So the page starts the inference.js
 * workers on the separator's behalf and relays messages between them, keyed by child id. Large
 * buffers are transferred at every hop, never copied. Protocol: lib/worker.ts InferenceRelay. */

/** Separator side: Worker-like handles for page-hosted inference.js workers.
 * @param {{ postMessage(message: import("./worker").InferenceRelay, transfer?: Transferable[]): void }} scope
 *   the separator's worker scope */
export function createRelayClient(scope) {
  /** @type {Map<number, import("./worker").InferenceChild>} */
  const children = new Map();
  let next = 0;
  return {
    /** @returns {import("./worker").InferenceChild} */
    spawn() {
      const id = ++next;
      /** @type {import("./worker").InferenceChild} */
      const child = {
        onmessage: null,
        onerror: null,
        postMessage: (msg, transfer = []) =>
          scope.postMessage({ type: "inference", child: id, msg }, transfer),
        terminate() {
          if (children.delete(id))
            scope.postMessage({ type: "inference-end", child: id });
        },
      };
      children.set(id, child);
      return child;
    },
    /** @param {unknown} data a message from the page
     * @returns {boolean} whether it was a relayed inference reply */
    receive(data) {
      const relay = /** @type {import("./worker").InferenceRelay} */ (data);
      if (relay?.type !== "inference") return false;
      const msg = /** @type {import("./worker").InferenceResponse} */ (
        relay.msg
      );
      children.get(relay.child)?.onmessage?.({ data: msg });
      return true;
    },
  };
}

/** Page side: starts, feeds and stops inference.js workers for one separator worker.
 * @param {{ postMessage(message: import("./worker").InferenceRelay, transfer?: Transferable[]): void }} separator
 * @param {() => Worker} [spawn] */
export function createRelayHost(
  separator,
  spawn = () => new Worker("inference.js", { type: "module" }),
) {
  /** @type {Map<number, Worker>} */
  const children = new Map();
  return {
    /** @param {unknown} data a message from the separator
     * @returns {boolean} whether it was for an inference worker */
    receive(data) {
      const relay = /** @type {import("./worker").InferenceRelay} */ (data);
      if (relay?.type === "inference-end") {
        children.get(relay.child)?.terminate();
        children.delete(relay.child);
        return true;
      }
      if (relay?.type !== "inference") return false;
      const id = relay.child;
      let child = children.get(id);
      if (!child) {
        const started = spawn();
        started.onmessage = ({ data: msg }) =>
          separator.postMessage(
            { type: "inference", child: id, msg },
            buffersOf(msg),
          );
        started.onerror = (event) => {
          event.preventDefault();
          separator.postMessage({
            type: "inference",
            child: id,
            msg: {
              type: "error",
              message: event.message || "inference worker failed",
            },
          });
        };
        children.set(id, (child = started));
      }
      child.postMessage(relay.msg, buffersOf(relay.msg));
      return true;
    },
    /** Stops every inference worker, e.g. when the separator is terminated. */
    close() {
      for (const child of children.values()) child.terminate();
      children.clear();
    },
  };
}

/** The large buffers in a relayed message, to transfer rather than copy.
 * @param {import("./worker").InferenceRequest | import("./worker").InferenceResponse} msg
 * @returns {ArrayBuffer[]} */
function buffersOf(msg) {
  const tensors =
    msg.type === "run"
      ? Object.values(msg.feeds)
      : msg.type === "result"
        ? Object.values(msg.outputs)
        : [];
  const buffers = tensors.map(
    ({ data }) => /** @type {ArrayBuffer} */ (data.buffer),
  );
  return msg.type === "load" ? [msg.model] : buffers;
}
