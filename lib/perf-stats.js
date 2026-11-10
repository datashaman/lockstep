/** Frame timing for one run. Recording writes into fixed rings and allocates
 * nothing; the oldest frames are overwritten once `capacity` is reached.
 * Times are milliseconds. */
export function createFrameStats(capacity = 36000) {
  const script = new Float32Array(capacity);
  const delta = new Float32Array(capacity);
  let recorded = 0;
  return {
    /** @param {number} scriptMs time spent in this frame's callback
     * @param {number} deltaMs time since the previous frame started */
    record(scriptMs, deltaMs) {
      const index = recorded % capacity;
      script[index] = scriptMs;
      delta[index] = deltaMs;
      recorded++;
    },
    /** Percentiles are of script time. A frame is dropped when its delta exceeds
     * 1.5x the median delta, so 60 Hz and 120 Hz displays are judged alike. */
    summary() {
      const frames = Math.min(recorded, capacity);
      const scripts = script.slice(0, frames).sort();
      const deltas = delta.slice(0, frames).sort();
      /** Nearest-rank percentile of a sorted array.
       * @param {Float32Array} sorted @param {number} percent */
      const rank = (sorted, percent) =>
        frames
          ? sorted[Math.max(0, Math.ceil((percent / 100) * frames) - 1)]
          : 0;
      const slow = 1.5 * rank(deltas, 50);
      let dropped = 0;
      let longFrames = 0;
      for (let i = 0; i < frames; i++) {
        if (deltas[i] > slow) dropped++;
        if (scripts[i] > 50) longFrames++;
      }
      return {
        frames,
        p50: rank(scripts, 50),
        p95: rank(scripts, 95),
        p99: rank(scripts, 99),
        dropped: frames ? dropped / frames : 0,
        longFrames,
      };
    },
  };
}
/** @typedef {ReturnType<ReturnType<typeof createFrameStats>["summary"]>} FrameSummary */
