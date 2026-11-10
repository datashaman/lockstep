import type { SongAudio, SongChart } from "./song";
export type FloatStems = Record<
  string,
  { left: Float32Array; right: Float32Array }
>;
export type WorkerRequest =
  | { id: string; left: Float32Array; right: Float32Array; stems?: never }
  | { id: string; stems: FloatStems; left?: never; right?: never };
export type WorkerProgress = {
  id: string;
  type: "progress";
  phase: "model" | "separate" | "chart";
  progress: number;
};
export type WorkerDone = {
  id: string;
  type: "done";
  song: SongChart;
  pcm?: SongAudio;
};
export type WorkerResponse =
  | WorkerProgress
  | WorkerDone
  | { id: string; type: "error"; message: string };
export type InferenceTensor = { data: Float32Array; dims: readonly number[] };
/** separator.js → inference.js. Each request gets exactly one reply. */
export type InferenceRequest =
  | { type: "load"; model: ArrayBuffer }
  | { type: "run"; feeds: Record<string, InferenceTensor> };
/** inference.js → separator.js; "lost" may also arrive unprompted once the GPU is gone. */
export type InferenceResponse =
  | { type: "ready"; inputNames: string[]; outputNames: string[] }
  | { type: "result"; outputs: Record<string, InferenceTensor> }
  | { type: "error" | "lost"; message: string };
/** What lib/inference-session.js needs from an inference.js worker (the page-hosted relay). */
export interface InferenceChild {
  onmessage: ((event: { data: InferenceResponse }) => void) | null;
  onerror: ((event: { message?: string }) => void) | null;
  postMessage(message: InferenceRequest, transfer?: Transferable[]): void;
  terminate(): void;
}
/** Safari gives workers started by workers no WebGPU, so the page starts inference.js workers for
 * the separator and relays their messages, keyed by child id (lib/inference-relay.js). */
export type InferenceRelay =
  | {
      type: "inference";
      child: number;
      msg: InferenceRequest | InferenceResponse;
    }
  | { type: "inference-end"; child: number };
export interface InferenceScope {
  onmessage: ((event: MessageEvent<InferenceRequest>) => void) | null;
  postMessage(message: InferenceResponse, transfer?: Transferable[]): void;
}
/** Dedicated worker messaging subset; avoids confusing Window.postMessage overloads. */
export interface SeparatorScope {
  onmessage:
    | ((event: MessageEvent<WorkerRequest | InferenceRelay>) => void)
    | null;
  postMessage(
    message: WorkerResponse | InferenceRelay,
    transfer?: Transferable[],
  ): void;
}
