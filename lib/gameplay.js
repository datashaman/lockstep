import { thinChart, fractionalBar } from "./beat-grid.js";
/** @typedef {import('./song').Note} Note */
/** `len` is 0 for taps. A hold is `holding` from its hit head until it ends; `broken` marks an early release.
 * @typedef {{t:number,lane:number,bar:number,hit:boolean,missed:boolean,len:number,holding:boolean,ended:boolean,broken:boolean}} GameNote */
/** `holds` are the notes currently held; `maxHold` is the longest hold on the track, for drawing.
 * @typedef {{name:string,kind?:string,color:string,capFrom:number,capTo:number,capAt:number,live:boolean,hits:number,misses:number,caps:number,timing:number,judged:number,notes:GameNote[],holds:GameNote[],maxHold:number}} GameTrack */

export function createRunState() {
  return {
    score: 0,
    multiplier: 1,
    hits: 0,
    misses: 0,
    strays: 0,
    captures: 0,
    groove: 100,
    missStreak: 0,
    currentTrack: 0,
  };
}
/** @typedef {ReturnType<typeof createRunState>} RunState */
/** @param {RunState} run @param {number} amount */
export function applyGroove(run, amount) {
  run.groove = Math.max(0, Math.min(100, run.groove + amount));
  return run.groove === 0
    ? 0
    : run.groove >= 40
      ? 1
      : 0.55 + (0.45 * run.groove) / 40;
}
/** @param {GameTrack} track @param {GameNote} note */
export const isAutomatic = (track, note) =>
  note.bar >= track.capFrom && note.bar < track.capTo;
/** @param {GameNote[]} notes @param {number} time */
export function noteIndex(notes, time) {
  let first = 0,
    last = notes.length;
  while (first < last) {
    const middle = (first + last) >> 1;
    if (notes[middle].t < time) first = middle + 1;
    else last = middle;
  }
  return first;
}
/** @param {GameTrack} track @param {number} lane @param {number} time @param {number} window @param {(time:number)=>number} audioTime */
export function findHittableNote(track, lane, time, window, audioTime) {
  return track.notes
    .slice(
      noteIndex(track.notes, time - window),
      noteIndex(track.notes, time + window),
    )
    .find(
      (note) =>
        note.lane === lane &&
        !note.hit &&
        !note.missed &&
        !isAutomatic(track, note) &&
        Math.abs(audioTime(time) - audioTime(note.t)) < window,
    );
}
/** @param {RunState} run @param {GameTrack} track @param {GameNote} note @param {number} delta @param {number} perfectWindow */
export function recordHit(run, track, note, delta, perfectWindow) {
  const perfect = Math.abs(delta) < perfectWindow;
  note.hit = true;
  run.hits++;
  track.hits++;
  track.timing += delta;
  run.score += (perfect ? 15 : 10) * run.multiplier;
  track.live = true;
  run.missStreak = 0;
  return { perfect, grooveGain: perfect ? 3 : 2 };
}
/** Points per sixteenth of a hold, times the multiplier. */
export const HOLD_SCORE = 2;
/** The head of a hold was hit: the key must stay down to the tail.
 * @param {GameTrack} track @param {GameNote} note */
export function startHold(track, note) {
  if (note.len > 0) {
    note.holding = true;
    track.holds.push(note);
  }
}
/** The hold ends: at the tail with the key down, or on release. Releasing within one hit window of the tail
 * counts as holding to the end; earlier scores only the sixteenths held and drops the stem to cue volume.
 * @param {RunState} run @param {GameTrack} track @param {GameNote} note @param {number} time
 * @param {number} window @param {(from:number,to:number)=>number} sixteenths sixteenths between two song times
 * @returns {{complete:boolean,grooveGain:number}} */
export function endHold(run, track, note, time, window, sixteenths) {
  const tail = note.t + note.len,
    complete = time >= tail - window,
    held = complete
      ? Math.round(sixteenths(note.t, tail))
      : Math.floor(sixteenths(note.t, time));
  note.holding = false;
  note.ended = true;
  note.broken = !complete;
  const at = track.holds.indexOf(note);
  if (at >= 0) track.holds.splice(at, 1);
  run.score += HOLD_SCORE * run.multiplier * Math.max(0, held);
  if (!complete) track.live = false;
  return { complete, grooveGain: complete ? 1 : 0 };
}
/** @param {RunState} run @param {GameTrack} track @param {number} phrase @param {number} time @param {number} captureBars */
export function recordCapture(run, track, phrase, time, captureBars) {
  track.capFrom = (phrase + 1) * 2;
  track.capTo = track.capFrom + captureBars;
  track.capAt = time;
  run.captures++;
  track.caps++;
  const bonus = 100 * run.multiplier;
  run.score += bonus;
  run.multiplier = Math.min(8, run.multiplier + 1);
  return bonus;
}
/** @param {RunState} run @param {GameTrack} track */
export function recordMiss(run, track) {
  run.multiplier = 1;
  run.misses++;
  track.misses++;
  track.live = false;
  return -(4 + Math.min(++run.missStreak, 4));
}
/** Groove lost to a press that hits nothing; tune by play. */
export const STRAY_GROOVE = -2;
/** A lane press that found no note on a playable track. It breaks the multiplier and drops
 * the stem to cue volume like a miss, but costs less groove and leaves the miss streak alone.
 * @param {RunState} run @param {GameTrack} track
 * @returns {number} the groove change */
export function recordStray(run, track) {
  run.multiplier = 1;
  run.strays++;
  track.live = false;
  return STRAY_GROOVE;
}
/** Share of judged presses that hit: strays count against it, so mashing loses.
 * @param {RunState} run */
export const accuracy = (run) =>
  run.hits / Math.max(1, run.hits + run.misses + run.strays);
/** @param {GameTrack[]} tracks @param {number} current @param {number} direction */
export function nextTrack(tracks, current, direction) {
  for (
    let index = current + direction;
    index >= 0 && index < tracks.length;
    index += direction
  )
    if (tracks[index].notes.length) return index;
  return -1;
}
/** @param {{name:string,kind?:string,notes:Note[]}[]} charts @param {string[]} colors @param {number} level @param {number[]} beats @param {number[]} bars @returns {GameTrack[]} */
export function createTracks(charts, colors, level, beats, bars) {
  return charts.map((chart, index) => ({
    name: chart.name,
    kind: chart.kind,
    color: colors[index],
    capFrom: -1,
    capTo: -1,
    capAt: -9,
    live: false,
    hits: 0,
    misses: 0,
    caps: 0,
    timing: 0,
    judged: 0,
    holds: [],
    maxHold: chart.notes.reduce(
      (most, note) => Math.max(most, note[2] || 0),
      0,
    ),
    notes: thinChart(chart.notes, level, beats).map(([t, lane, len = 0]) => ({
      t,
      lane,
      bar: Math.floor(fractionalBar(bars, t)),
      hit: false,
      missed: false,
      len,
      holding: false,
      ended: false,
      broken: false,
    })),
  }));
}
