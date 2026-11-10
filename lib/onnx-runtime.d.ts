// The subset of the CDN runtime that inference.js uses.
declare module "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.21.0/dist/ort.all.mjs" {
  export const env: {
    wasm: { numThreads: number };
    /** `device` is set once the WebGPU backend has started. */
    webgpu: { device?: { lost: Promise<{ message: string }> } };
  };
  export class Tensor {
    constructor(type: "float32", data: Float32Array, dims: readonly number[]);
    readonly data: Float32Array;
    readonly dims: readonly number[];
    dispose(): void;
  }
  export class InferenceSession {
    static create(
      model: ArrayBuffer,
      options: {
        executionProviders: string[];
        graphOptimizationLevel: "basic";
      },
    ): Promise<InferenceSession>;
    readonly inputNames: string[];
    readonly outputNames: string[];
    run(feeds: Record<string, Tensor>): Promise<Record<string, Tensor>>;
    release(): Promise<void>;
  }
}
