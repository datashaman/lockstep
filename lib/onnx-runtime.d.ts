// The CDN runtime is injected into the vendored Demucs processor. Only this
// configuration is accessed by first-party code; inference stays in the vendor.
declare module "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.21.0/dist/ort.all.mjs" {
  export const env: { wasm: { numThreads: number } };
}
