/**
 * Demucs audio processor - Core separation logic
 *
 * Lockstep change: every per-segment buffer is allocated once per separate() call and reused.
 * Upstream allocated ~145 MB of short-lived arrays per 7.8 s segment. WebKit collects large
 * garbage only once it has grown in proportion to the heap, and next to ONNX Runtime's
 * multi-gigabyte WebAssembly heap that let memory climb ~200 MB per segment until iOS killed
 * the tab. The arithmetic follows upstream's prepareModelInput, standaloneMask and
 * standaloneIspec step for step, in float32, so the separated audio is unchanged.
 */

import { CONSTANTS } from './constants.js';
import { fft, ifft, getHannWindow } from './fft.js';

const { FFT_SIZE, HOP_SIZE, TRAINING_SAMPLES, MODEL_SPEC_BINS, MODEL_SPEC_FRAMES, SEGMENT_OVERLAP, TRACKS } = CONSTANTS;

// Segment geometry shared by the model input and the spectral reconstruction.
const STFT_PAD = Math.floor(HOP_SIZE / 2) * 3;
const STFT_PAD_RIGHT = STFT_PAD + Math.ceil(TRAINING_SAMPLES / HOP_SIZE) * HOP_SIZE - TRAINING_SAMPLES;
const CENTER_PAD = FFT_SIZE / 2;
const FRAME_OFFSET = 2; // the model's spectrogram starts at the third STFT frame
const PADDED_FRAMES = MODEL_SPEC_FRAMES + 2 * FRAME_OFFSET;
const SPEC_BINS = FFT_SIZE / 2 + 1;
const ISTFT_LENGTH = (PADDED_FRAMES - 1) * HOP_SIZE + FFT_SIZE;
const OUTPUT_OFFSET = CENTER_PAD + STFT_PAD;
const PLANE = MODEL_SPEC_BINS * MODEL_SPEC_FRAMES;

/** reflectPad from fft.js, writing into a preallocated array. */
function reflectPadInto(signal, padLeft, padRight, out) {
  const length = signal.length;
  for (let i = 0; i < padLeft; i++) out[i] = signal[Math.min(padLeft - i, length - 1)];
  out.set(signal, padLeft);
  for (let i = 0; i < padRight; i++) out[padLeft + length + i] = signal[Math.max(0, length - 2 - i)];
  return out;
}

/** Every buffer one segment needs, plus the iSTFT window sum, which is the same for every segment. */
function createWorkspace() {
  const window = getHannWindow(FFT_SIZE);
  const windowSum = new Float32Array(ISTFT_LENGTH);
  for (let frame = 0; frame < PADDED_FRAMES; frame++) {
    const start = frame * HOP_SIZE;
    for (let i = 0; i < FFT_SIZE && start + i < ISTFT_LENGTH; i++) windowSum[start + i] += window[i] * window[i];
  }
  const stftLength = TRAINING_SAMPLES + STFT_PAD + STFT_PAD_RIGHT;
  return {
    window,
    windowSum,
    segment: [new Float32Array(TRAINING_SAMPLES), new Float32Array(TRAINING_SAMPLES)],
    stftInput: new Float32Array(stftLength),
    centered: new Float32Array(stftLength + 2 * CENTER_PAD),
    waveform: new Float32Array(2 * TRAINING_SAMPLES),
    magSpec: new Float32Array(4 * PLANE),
    windowed: new Float32Array(FFT_SIZE),
    re: new Float32Array(FFT_SIZE),
    im: new Float32Array(FFT_SIZE),
    fullRe: new Float32Array(FFT_SIZE),
    fullIm: new Float32Array(FFT_SIZE),
    istft: new Float32Array(ISTFT_LENGTH),
    overlap: new Float32Array(TRAINING_SAMPLES),
  };
}

/** Model inputs for the segment in ws.segment: the stereo waveform and the
 * [leftReal, leftImag, rightReal, rightImag] spectrogram (upstream prepareModelInput). */
function fillModelInput(ws) {
  const scale = 1.0 / Math.sqrt(FFT_SIZE);
  ws.waveform.set(ws.segment[0], 0);
  ws.waveform.set(ws.segment[1], TRAINING_SAMPLES);
  for (let channel = 0; channel < 2; channel++) {
    reflectPadInto(ws.segment[channel], STFT_PAD, STFT_PAD_RIGHT, ws.stftInput);
    reflectPadInto(ws.stftInput, CENTER_PAD, CENTER_PAD, ws.centered);
    const realBase = 2 * channel * PLANE;
    const imagBase = realBase + PLANE;
    for (let f = 0; f < MODEL_SPEC_FRAMES; f++) {
      const start = (f + FRAME_OFFSET) * HOP_SIZE;
      for (let i = 0; i < FFT_SIZE; i++) ws.windowed[i] = ws.centered[start + i] * ws.window[i];
      fft(ws.re, ws.im, ws.windowed, FFT_SIZE);
      for (let b = 0; b < MODEL_SPEC_BINS; b++) {
        ws.magSpec[realBase + b * MODEL_SPEC_FRAMES + f] = ws.re[b] * scale;
        ws.magSpec[imagBase + b * MODEL_SPEC_FRAMES + f] = ws.im[b] * scale;
      }
    }
  }
}

/** Inverse STFT of one track channel of the model's spectral output into ws.istft, before
 * window-sum normalisation (upstream standaloneMask + standaloneIspec). The padding frames
 * are silent, so only the model's frames are transformed. */
function istftInto(ws, freqData, realBase, imagBase) {
  const scale = Math.sqrt(FFT_SIZE);
  const out = ws.istft;
  out.fill(0);
  for (let f = 0; f < MODEL_SPEC_FRAMES; f++) {
    ws.fullRe.fill(0);
    ws.fullIm.fill(0);
    for (let b = 0; b < MODEL_SPEC_BINS; b++) {
      ws.fullRe[b] = freqData[realBase + b * MODEL_SPEC_FRAMES + f];
      ws.fullIm[b] = freqData[imagBase + b * MODEL_SPEC_FRAMES + f];
    }
    for (let k = 1; k < SPEC_BINS - 1; k++) {
      ws.fullRe[FFT_SIZE - k] = ws.fullRe[k];
      ws.fullIm[FFT_SIZE - k] = -ws.fullIm[k];
    }
    ifft(ws.re, ws.im, ws.fullRe, ws.fullIm, FFT_SIZE);
    const start = (f + FRAME_OFFSET) * HOP_SIZE;
    for (let i = 0; i < FFT_SIZE; i++) out[start + i] += ws.re[i] * ws.window[i] * scale;
  }
}

/**
 * Main Demucs processor class
 */
export class DemucsProcessor {
  constructor(options = {}) {
    this.ort = options.ort || null;
    this.session = null;
    this.modelPath = options.modelPath || './htdemucs_embedded.onnx';
    this.sessionOptions = options.sessionOptions || {};
    this.onProgress = options.onProgress || (() => {});
    this.onLog = options.onLog || (() => {});
    this.onDownloadProgress = options.onDownloadProgress || (() => {});
  }

  async loadModel(modelPathOrBuffer) {
    if (!this.ort) {
      throw new Error('ONNX Runtime not provided. Pass ort in constructor options.');
    }

    this.onLog('model', 'Loading model...');

    let modelBuffer;
    if (modelPathOrBuffer instanceof ArrayBuffer) {
      modelBuffer = modelPathOrBuffer;
    } else {
      const response = await fetch(modelPathOrBuffer || this.modelPath);

      // Check if we can track progress
      const contentLength = response.headers.get('Content-Length');
      if (contentLength && response.body) {
        const totalSize = parseInt(contentLength, 10);
        const reader = response.body.getReader();
        const chunks = [];
        let loadedSize = 0;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          loadedSize += value.length;
          this.onDownloadProgress(loadedSize, totalSize);
        }

        // Combine chunks into single ArrayBuffer
        const combined = new Uint8Array(loadedSize);
        let offset = 0;
        for (const chunk of chunks) {
          combined.set(chunk, offset);
          offset += chunk.length;
        }
        modelBuffer = combined.buffer;
      } else {
        // Fallback: no progress tracking
        modelBuffer = await response.arrayBuffer();
      }
    }

    const defaultSessionOptions = {
      executionProviders: ['webgpu', 'wasm'],
      graphOptimizationLevel: 'basic'
    };

    this.session = await this.ort.InferenceSession.create(modelBuffer, {
      ...defaultSessionOptions,
      ...this.sessionOptions
    });

    this.onLog('model', 'Model loaded successfully');
    return this.session;
  }

  async separate(leftChannel, rightChannel) {
    if (!this.session) {
      throw new Error('Model not loaded. Call loadModel() first.');
    }

    const totalSamples = leftChannel.length;
    const stride = Math.floor(TRAINING_SAMPLES * (1 - SEGMENT_OVERLAP));
    const numSegments = Math.ceil(totalSamples / stride);

    const outputs = TRACKS.map(() => ({
      left: new Float32Array(totalSamples),
      right: new Float32Array(totalSamples)
    }));
    const weights = new Float32Array(totalSamples);
    const ws = createWorkspace();
    const [segLeft, segRight] = ws.segment;

    let segmentIdx = 0;

    for (let start = 0; start < totalSamples; start += stride) {
      const end = Math.min(start + TRAINING_SAMPLES, totalSamples);
      const segmentLength = end - start;

      segLeft.set(leftChannel.subarray(start, end));
      segLeft.fill(0, segmentLength);
      segRight.set(rightChannel.subarray(start, end));
      segRight.fill(0, segmentLength);
      fillModelInput(ws);

      let waveformTensor, magSpecTensor, inferResults;
      try {
        waveformTensor = new this.ort.Tensor('float32', ws.waveform, [1, 2, TRAINING_SAMPLES]);
        magSpecTensor = new this.ort.Tensor('float32', ws.magSpec, [1, 4, MODEL_SPEC_BINS, MODEL_SPEC_FRAMES]);

        const feeds = {};
        feeds[this.session.inputNames[0]] = waveformTensor;
        if (this.session.inputNames.length > 1) {
          feeds[this.session.inputNames[1]] = magSpecTensor;
        }

        inferResults = await this.session.run(feeds);

        let timeData = null, timeShape = null;
        let freqData = null;

        for (const name of this.session.outputNames) {
          const tensor = inferResults[name];
          if (tensor.dims.length === 4 && tensor.dims[2] === 2) {
            timeData = tensor.data;
            timeShape = tensor.dims;
          } else if (tensor.dims.length === 5 && tensor.dims[2] === 4) {
            freqData = tensor.data;
          }
        }

        if (!timeData) {
          throw new Error('Could not find time-domain output tensor');
        }

        const numTracks = timeShape[1];
        const numChannels = timeShape[2];
        const samples = timeShape[3];

        const overlapWindow = ws.overlap;
        for (let i = 0; i < segmentLength; i++) {
          const fadeIn = Math.min(i / (stride * 0.5), 1);
          const fadeOut = Math.min((segmentLength - i) / (stride * 0.5), 1);
          overlapWindow[i] = Math.min(fadeIn, fadeOut);
        }

        for (let t = 0; t < numTracks; t++) {
          for (let channel = 0; channel < 2; channel++) {
            const output = channel ? outputs[t].right : outputs[t].left;
            const timeBase = t * numChannels * samples + channel * samples;
            if (freqData) istftInto(ws, freqData, (4 * t + 2 * channel) * PLANE, (4 * t + 2 * channel + 1) * PLANE);
            for (let i = 0; i < segmentLength && start + i < totalSamples; i++) {
              let value = timeData[timeBase + i];
              if (freqData) {
                // Upstream stored each step in a Float32Array; fround keeps the same rounding.
                const j = OUTPUT_OFFSET + i;
                let spectral = ws.istft[j];
                if (ws.windowSum[j] > 1e-8) spectral = Math.fround(spectral / ws.windowSum[j]);
                value = Math.fround(value + (spectral || 0));
              }
              output[start + i] += value * overlapWindow[i];
            }
          }
        }

        for (let i = 0; i < segmentLength && start + i < totalSamples; i++) {
          weights[start + i] += overlapWindow[i];
        }
      } finally {
        // Inference resources must not accumulate across song chunks, including failed runs.
        // ONNX Runtime copies each run's ~55 MB of outputs into fresh arrays; detaching their
        // buffers frees them now instead of whenever WebKit's heap-sized GC budget runs out.
        // (ArrayBuffer.prototype.transfer: Safari 17.4+; older engines leave them to the GC.)
        for (const tensor of Object.values(inferResults || {})) {
          const data = tensor.data;
          if (data?.buffer?.byteLength === data.byteLength) data.buffer.transfer?.(0);
        }
        for (const tensor of new Set([waveformTensor, magSpecTensor, ...Object.values(inferResults || {})])) tensor?.dispose();
      }

      segmentIdx++;
      this.onProgress({
        progress: segmentIdx / numSegments,
        currentSegment: segmentIdx,
        totalSegments: numSegments
      });
    }

    for (let t = 0; t < TRACKS.length; t++) {
      for (let i = 0; i < totalSamples; i++) {
        if (weights[i] > 0) {
          outputs[t].left[i] /= weights[i];
          outputs[t].right[i] /= weights[i];
        }
      }
    }

    return {
      drums: outputs[0],
      bass: outputs[1],
      other: outputs[2],
      vocals: outputs[3]
    };
  }
}
