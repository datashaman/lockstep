/**
 * Owns the persistent master/echo graph and all temporary synthesized sounds.
 * The caller owns the AudioContext and supplies absolute audio-clock times.
 * @param {AudioContext} context
 * @param {{step: number, barLength: number, chords: number[][]}} music
 */
export function createAudioEngine(context, { step, barLength, chords }) {
  /** @type {Map<AudioScheduledSourceNode, () => void>} */
  const voices = new Map();
  const midiFrequency = (/** @type {number} */ midi) =>
    440 * 2 ** ((midi - 69) / 12);
  const noise = context.createBuffer(1, context.sampleRate, context.sampleRate);
  noise.getChannelData(0).forEach((_, i, a) => (a[i] = Math.random() * 2 - 1));
  const compressor = context.createDynamicsCompressor();
  compressor.threshold.value = -14;
  compressor.ratio.value = 4;
  compressor.connect(context.destination);
  const output = context.createGain();
  output.gain.value = 0.8;
  output.connect(compressor);
  // dotted-eighth feedback echo for arp / lead / stingers
  const echoDelay = context.createDelay(1);
  echoDelay.delayTime.value = 3 * step;
  const feedback = context.createGain(),
    echoFilter = context.createBiquadFilter(),
    echoVolume = context.createGain();
  feedback.gain.value = 0.38;
  echoFilter.frequency.value = 2200;
  echoVolume.gain.value = 0.35;
  echoDelay.connect(echoFilter).connect(feedback).connect(echoDelay);
  echoFilter.connect(echoVolume).connect(output);
  /** @param {AudioScheduledSourceNode} node @param {(AudioNode | undefined)[]} graph */
  function voice(node, ...graph) {
    const cleanup = () => {
      node.disconnect();
      for (const part of graph) part?.disconnect();
      voices.delete(node);
      node.onended = null;
    };
    voices.set(node, cleanup);
    node.onended = cleanup;
    return node;
  }
  function stopVoices() {
    for (const [node, cleanup] of voices) {
      node.stop();
      cleanup();
    }
  }
  function restoreVolume() {
    if (output) {
      output.gain.cancelScheduledValues(context.currentTime);
      output.gain.setValueAtTime(0.8, context.currentTime);
    }
  }
  /** @param {OscillatorType} type @param {number} midi @param {number} when @param {number} duration @param {number} amplitude @param {number} cutoff @param {number} echo */
  function tone(
    type,
    midi,
    when,
    duration,
    amplitude,
    cutoff = 8000,
    echo = 0,
  ) {
    const oscillator = context.createOscillator(),
      volume = context.createGain(),
      filter = context.createBiquadFilter();
    oscillator.type = type;
    oscillator.frequency.value = midiFrequency(midi);
    filter.frequency.value = cutoff;
    volume.gain.setValueAtTime(amplitude, when);
    volume.gain.exponentialRampToValueAtTime(1e-4, when + duration);
    oscillator.connect(filter).connect(volume).connect(output);
    oscillator.start(when);
    oscillator.stop(when + duration);
    let echoSend;
    if (echo) {
      echoSend = context.createGain();
      echoSend.gain.value = echo;
      volume.connect(echoSend).connect(echoDelay);
    }
    voice(oscillator, volume, filter, echoSend);
  }
  /** @param {number} when @param {number} duration @param {number} amplitude @param {number} highpass */
  function hiss(when, duration, amplitude, highpass) {
    const source = context.createBufferSource(),
      volume = context.createGain(),
      filter = context.createBiquadFilter();
    source.buffer = noise;
    filter.type = "highpass";
    filter.frequency.value = highpass;
    volume.gain.setValueAtTime(amplitude, when);
    volume.gain.exponentialRampToValueAtTime(1e-4, when + duration);
    source.connect(filter).connect(volume).connect(output);
    source.start(when);
    source.stop(when + duration);
    voice(source, volume, filter);
  }
  /** @param {number} bar @param {number} when */
  function pad(bar, when) {
    // soft detuned chord bed so the song is never silent
    for (const midi of chords[bar % 4])
      for (const detune of [-8, 8]) {
        const oscillator = context.createOscillator(),
          volume = context.createGain(),
          filter = context.createBiquadFilter();
        oscillator.type = "sawtooth";
        oscillator.frequency.value = midiFrequency(midi);
        oscillator.detune.value = detune;
        filter.frequency.value = 900;
        volume.gain.setValueAtTime(1e-4, when);
        volume.gain.exponentialRampToValueAtTime(0.02, when + 0.4);
        volume.gain.setValueAtTime(0.02, when + barLength - 0.3);
        volume.gain.exponentialRampToValueAtTime(1e-4, when + barLength + 0.2);
        oscillator.connect(filter).connect(volume).connect(output);
        oscillator.start(when);
        oscillator.stop(when + barLength + 0.25);
        voice(oscillator, volume, filter);
      }
  }
  /** @param {string} kind @param {number} lane @param {number} bar @param {number} when */
  function play(kind, lane, bar, when) {
    const chord = chords[bar % 4];
    if (kind === "drums") {
      if (lane === 0) {
        const oscillator = context.createOscillator(),
          volume = context.createGain();
        oscillator.frequency.setValueAtTime(150, when);
        oscillator.frequency.exponentialRampToValueAtTime(40, when + 0.15);
        volume.gain.setValueAtTime(0.9, when);
        volume.gain.exponentialRampToValueAtTime(1e-4, when + 0.2);
        oscillator.connect(volume).connect(output);
        oscillator.start(when);
        oscillator.stop(when + 0.2);
        voice(oscillator, volume);
      } else if (lane === 1) hiss(when, 0.15, 0.5, 1200);
      else hiss(when, 0.05, 0.25, 7000);
    } else if (kind === "bass")
      tone("sawtooth", chord[lane] - 24, when, 0.22, 0.35, 700);
    else if (kind === "arp")
      tone("square", chord[lane] + 12, when, 0.12, 0.08, 8000, 0.4);
    else tone("sawtooth", chord[lane] + 12, when, 0.35, 0.15, 2400, 0.5);
  }
  /** @param {number} bar */
  function captureSfx(bar) {
    const at = context.currentTime;
    chords[bar % 4].forEach((midi, index) =>
      tone("triangle", midi + 24, at + index * 0.06, 0.5, 0.12, 8000, 0.6),
    );
    const source = context.createBufferSource(),
      filter = context.createBiquadFilter(),
      volume = context.createGain();
    source.buffer = noise;
    filter.type = "bandpass";
    filter.Q.value = 4;
    filter.frequency.setValueAtTime(300, at);
    filter.frequency.exponentialRampToValueAtTime(8000, at + 0.6);
    volume.gain.setValueAtTime(0.25, at);
    volume.gain.exponentialRampToValueAtTime(1e-4, at + 0.7);
    source.connect(filter).connect(volume).connect(output);
    source.start(at);
    source.stop(at + 0.7);
    voice(source, volume, filter);
  }

  return {
    output: output,
    playNote: play,
    playPad: pad,
    playCapture: captureSfx,
    /** @param {number} when */
    playCountIn(when) {
      tone("square", 84, when, 0.06, 0.05);
    },
    /** @param {number} when */
    playSwitch(when) {
      hiss(when, 0.12, 0.06, 3000);
    },
    /** @param {number} when */
    playHiHat(when) {
      hiss(when, 0.03, 0.05, 9000);
    },
    stopSounds: stopVoices,
    restoreVolume,
    mute() {
      output.gain.setTargetAtTime(0, context.currentTime, 0.02);
    },
  };
}
