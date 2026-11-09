import assert from 'node:assert/strict';
import { DemucsProcessor } from './vendor/demucs-web/processor.js';
import { CONSTANTS } from './vendor/demucs-web/constants.js';

const live = new Set();
class Tensor {
  constructor(type, data, dims) { this.data = data; this.dims = dims; live.add(this); }
  dispose() { assert.ok(live.delete(this), 'tensor disposed exactly once'); this.data = null; }
}
const processor = new DemucsProcessor({ ort: { Tensor }, onProgress() {
  assert.equal(live.size, 0, 'every chunk releases input/output tensors before the next chunk');
} });
processor.session = {
  inputNames: ['waveform', 'spectrum'], outputNames: ['audio'],
  async run() { return { audio: new Tensor('float32', new Float32Array(4 * 2 * CONSTANTS.TRAINING_SAMPLES).fill(.25), [1, 4, 2, CONSTANTS.TRAINING_SAMPLES]) }; },
};
const audio = new Float32Array(CONSTANTS.TRAINING_SAMPLES + 10);
const stems = await processor.separate(audio, audio);
assert.equal(live.size, 0);
assert.ok(Math.abs(stems.drums.left[100] - .25) < 1e-6, 'overlap-add audio remains correct');
console.log('ok: chunk tensors released and overlap-add preserved');

let chunks = 0;
processor.onProgress = ({ progress }) => { chunks++; assert.equal(live.size, 0); assert.ok(progress > 0 && progress <= 1); };
const longAudio = new Float32Array(148 * CONSTANTS.SAMPLE_RATE);
await processor.separate(longAudio, longAudio);
assert.ok(chunks > 20, 'exercise the reported 2:28 duration across many chunks');
assert.equal(live.size, 0);
processor.session.run = async () => { throw Error('inference failed'); };
await assert.rejects(processor.separate(audio, audio), /inference failed/);
assert.equal(live.size, 0, 'input tensors released when inference rejects');
processor.session.run = async () => ({ audio: new Tensor('float32', new Float32Array(1), [1]) });
await assert.rejects(processor.separate(audio, audio), /time-domain/);
assert.equal(live.size, 0, 'all tensors released when output validation fails');
processor.session.outputNames = ['audio', 'spectrum'];
processor.session.run = async () => ({
  audio: new Tensor('float32', new Float32Array(4 * 2 * CONSTANTS.TRAINING_SAMPLES).fill(.25), [1, 4, 2, CONSTANTS.TRAINING_SAMPLES]),
  spectrum: new Tensor('float32', new Float32Array(4 * 4 * CONSTANTS.MODEL_SPEC_BINS * CONSTANTS.MODEL_SPEC_FRAMES), [1, 4, 4, CONSTANTS.MODEL_SPEC_BINS, CONSTANTS.MODEL_SPEC_FRAMES]),
});
let shortProgress; processor.onProgress = p => shortProgress = p.progress;
const combined = await processor.separate(new Float32Array(256), new Float32Array(256));
assert.equal(shortProgress, 1, 'short clips finish at 100%, not Infinity');
for (const stem of Object.values(combined)) {
  assert.ok(Math.abs(stem.left[100] - .25) < 1e-6);
  assert.ok(Math.abs(stem.right[100] - .25) < 1e-6);
}
assert.equal(live.size, 0, 'time/frequency outputs released after reconstruction');
console.log(`ok: 2:28 chunk processing, inference/validation failures, spectral reconstruction and explicit tensor cleanup (${chunks} chunks)`);
