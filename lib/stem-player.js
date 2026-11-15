/**
 * Plays a synchronized group of recorded stems. Owns source/gain nodes, but
 * never suspends the shared context or changes the application's song clock.
 * @param {AudioContext} context
 * @param {AudioNode} output
 */
export function createStemPlayer(context, output) {
  /** @type {Map<number, {source: AudioBufferSourceNode, gain: GainNode, level: number, started: boolean, cleanup: () => void}>} */
  const channels = new Map();

  function stop() {
    for (const channel of channels.values()) {
      if (channel.started) channel.source.stop();
      channel.cleanup();
    }
  }

  return {
    get playing() {
      return channels.size > 0;
    },
    /**
     * Replaces the previous group. Every source starts at the same clock time.
     * @param {AudioBuffer[]} buffers
     * @param {number} when
     * `offset` is the position (seconds into the buffers) that plays at `when`; before the start of the audio it delays
     * the start by the time to get there, and `rate` is the initial playback rate.
     * @param {{volume?: number, loop?: {from: number, to: number}, offset?: number, rate?: number}} options
     */
    start(buffers, when, { volume = 0, loop, offset = 0, rate } = {}) {
      if (offset < 0) {
        when += -offset / (rate ?? 1);
        offset = 0;
      }
      stop();
      try {
        buffers.forEach((buffer, index) => {
          const source = context.createBufferSource();
          const gain = context.createGain();
          const cleanup = () => {
            source.disconnect();
            gain.disconnect();
            source.onended = null;
            channels.delete(index);
          };
          const channel = {
            source,
            gain,
            level: volume,
            started: false,
            cleanup,
          };
          channels.set(index, channel);
          source.onended = cleanup;
          source.buffer = buffer;
          gain.gain.value = volume;
          if (rate !== undefined) source.playbackRate.value = rate;
          source.connect(gain).connect(output);
          if (loop) {
            source.loop = true;
            source.loopStart = loop.from;
            source.loopEnd = loop.to;
            source.start(when, loop.from);
          } else if (offset) {
            source.start(when, offset);
          } else {
            source.start(when);
          }
          channel.started = true;
        });
      } catch (error) {
        stop();
        throw error;
      }
    },
    stop,
    /** @param {number} rate @param {number} when */
    setRate(rate, when) {
      for (const { source } of channels.values())
        source.playbackRate.setValueAtTime(rate, when);
    },
    /** @param {number} index @param {number} level */
    setLevel(index, level) {
      const channel = channels.get(index);
      if (!channel || channel.level === level) return;
      channel.level = level;
      channel.gain.gain.setTargetAtTime(level, context.currentTime, 0.02);
    },
  };
}
