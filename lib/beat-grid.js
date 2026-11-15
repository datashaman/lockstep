/** @typedef {import('./song').Note} Note */
/** @typedef {Pick<import('./song').SongChart, 'beats' | 'downbeat' | 'duration'>} GridSource */

/** @param {number[]} values */
export function median(values) {
  const sorted = values.slice().sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** Extend the grid through the count-in and beyond the visible highway.
 * @param {GridSource} song
 * @param {number} leadIn
 * @param {number} lookAhead
 */
export function extendBeatGrid(song, leadIn, lookAhead) {
  const beats = song.beats.slice();
  let downbeat = song.downbeat;
  // lead-in beats follow the opening tempo and the tail follows the closing one
  const intervals = beats.slice(1).map((beat, index) => beat - beats[index]);
  const before = median(intervals.slice(0, 8));
  const after = median(intervals.slice(-8));
  while (beats[0] > -leadIn - 1) {
    beats.unshift(beats[0] - before);
    downbeat++;
  }
  while (beats[beats.length - 1] < song.duration + lookAhead + 2) {
    beats.push(beats[beats.length - 1] + after);
  }
  const bars = beats.filter(
    (_, index) => index >= downbeat && (index - downbeat) % 4 === 0,
  );
  return { beats, bars, downbeat };
}

/** Last marker at or before time; -1 before the first marker.
 * @param {number[]} markers @param {number} time
 */
export function beatIndex(markers, time) {
  if (time < markers[0]) return -1;
  let first = 0;
  let last = markers.length - 1;
  while (first < last) {
    const middle = (first + last + 1) >> 1;
    if (markers[middle] <= time) first = middle;
    else last = middle - 1;
  }
  return first;
}

/** Position in beats (fractional), -1 before the first beat.
 * @param {number[]} beats @param {number} time */
export function fractionalBeat(beats, time) {
  const index = beatIndex(beats, time);
  if (index < 0) return -1;
  if (index >= beats.length - 1) return index;
  return index + (time - beats[index]) / (beats[index + 1] - beats[index]);
}

/** @param {number[]} bars @param {number} time */
export function fractionalBar(bars, time) {
  const index = beatIndex(bars, time);
  if (index < 0) return 0;
  if (index >= bars.length - 1) return index;
  return index + (time - bars[index]) / (bars[index + 1] - bars[index]);
}

/** Beat index and nearest sixteenth slot, rolling slot four into the next beat.
 * @param {number[]} beats @param {number} time @returns {[number, number]}
 */
export function beatSlot(beats, time) {
  let beat = beatIndex(beats, time);
  if (beat < 0 || beat >= beats.length - 1) return [beat, 0];
  let slot = Math.round(
    ((time - beats[beat]) / (beats[beat + 1] - beats[beat])) * 4,
  );
  if (slot === 4) {
    beat++;
    slot = 0;
  }
  return [beat, slot];
}

/** EXPERT keeps every note; HARD keeps one per eighth-note window (the on-eighth
 * note when there is one, else the off-sixteenth); NORMAL keeps on-eighth notes
 * only; EASY keeps at most one note per beat, preferring on-beat notes and
 * spacing them a beat apart.
 * @param {Note[]} notes @param {number} level @param {number[]} beats
 */
export function thinChart(notes, level, beats) {
  if (level >= 3) return notes;
  if (level === 2) {
    /** @type {Map<number, { note: Note, onEighth: boolean }>} */
    const windows = new Map();
    /** @type {Note[]} */
    const outside = [];
    for (const note of notes) {
      const [beat, slot] = beatSlot(beats, note[0]);
      if (beat < 0 || beat >= beats.length - 1) {
        outside.push(note); // off the grid: nothing to compare with
        continue;
      }
      const key = beat * 2 + (slot >> 1);
      const onEighth = slot % 2 === 0;
      const held = windows.get(key);
      if (!held || (onEighth && !held.onEighth))
        windows.set(key, { note, onEighth });
    }
    return [...windows.values(), ...outside.map((note) => ({ note }))]
      .map(({ note }) => note)
      .sort((a, b) => a[0] - b[0]);
  }
  const eighthNotes = notes.filter(
    ([time]) => beatSlot(beats, time)[1] % 2 === 0,
  );
  if (level === 1) return eighthNotes;
  /** @type {Map<number, { note: Note, slot: number }>} */
  const bestPerBeat = new Map();
  for (const note of eighthNotes) {
    const [beat, slot] = beatSlot(beats, note[0]);
    const previous = bestPerBeat.get(beat);
    if (!previous || slot < previous.slot)
      bestPerBeat.set(beat, { note, slot });
  }
  /** @type {Note[]} */
  const result = [];
  const candidates = [...bestPerBeat.values()].sort(
    (a, b) => a.note[0] - b.note[0],
  );
  for (const { note } of candidates) {
    const previous = result.at(-1);
    const [beat] = beatSlot(beats, note[0]);
    const secondsPerBeat =
      beats[Math.min(beat + 1, beats.length - 1)] - beats[Math.max(0, beat)];
    if (!previous || note[0] - previous[0] >= secondsPerBeat * 0.9)
      result.push(note);
  }
  return result;
}
