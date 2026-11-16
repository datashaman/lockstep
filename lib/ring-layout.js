// @ts-check
/** Track-space rotation, sampled from the pause-aware visual clock.
 * @param {number} from @param {number} to @param {number} started
 * @param {number} now @param {boolean} [reduced] */
export function ringPosition(from, to, started, now, reduced = false) {
  const progress = reduced
    ? 1
    : Math.max(0, Math.min(1, (now - started) / 0.15));
  return from + (to - from) * (1 - (1 - progress) ** 3);
}
