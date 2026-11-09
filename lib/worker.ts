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
/** Dedicated worker messaging subset; avoids confusing Window.postMessage overloads. */
export interface SeparatorScope {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(message: WorkerResponse, transfer?: Transferable[]): void;
}
