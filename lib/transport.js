/** @typedef {import('./song').TempoSegment} TempoSegment */

/**
 * Find the latest tempo change at or before a position on either timeline.
 * @param {TempoSegment[]} segments
 * @param {number} value
 * @param {'at' | 'pos'} axis
 */
function segmentAt(segments, value, axis) {
  let first = 0;
  let last = segments.length - 1;
  while (first < last) {
    const middle = (first + last + 1) >> 1;
    if (segments[middle][axis] <= value) first = middle;
    else last = middle - 1;
  }
  return segments[first];
}

/** @param {TempoSegment[]} segments @param {number} elapsed */
export function songPosition(segments, elapsed) {
  const segment = segmentAt(segments, elapsed, "at");
  return segment.pos + (elapsed - segment.at) * segment.rate;
}

/** @param {TempoSegment[]} segments @param {number} position */
export function audioElapsed(segments, position) {
  const segment = segmentAt(segments, position, "pos");
  return segment.at + (position - segment.pos) / segment.rate;
}
