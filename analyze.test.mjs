// node analyze.test.mjs — synthetic stems with a known grid; checks tempo, beat timing, downbeat, note timing and lanes.
import assert from 'node:assert/strict';
import { analyze } from './analyze.js';

const SR = 44100, BPM = 128, SPB = 60 / BPM, OFFSET = 0.25, BARS = 16, N = Math.ceil((OFFSET + BARS * 4 * SPB + 1) * SR);
const stem = () => new Float32Array(N);
const add = (y, t, f) => { const i0 = Math.round(t * SR); for (let i = 0; i < SR && i0 + i < N; i++) y[i0 + i] += f(i / SR); };
const hz = m => 440 * 2 ** ((m - 69) / 12);
let seed = 1; const noise = () => (seed = (seed * 16807) % 2147483647) / 1073741823.5 - 1;
const drums = stem(), bass = stem(), vocals = stem(), other = stem(), kicks = [];
for (let b = 0; b < BARS * 4; b++) {
  const t = OFFSET + b * SPB;
  if (b % 4 === 0) { kicks.push(t); add(drums, t, x => x < .25 ? Math.sin(2 * Math.PI * (50 * x + 3 * (1 - Math.exp(-x * 30)))) * Math.exp(-x * 12) : 0); } // kick on beat 1 only: unambiguous downbeat
  if (b % 4 === 2) add(drums, t, x => x < .15 ? noise() * .5 * Math.exp(-x * 25) : 0); // snare on 3
  for (const h of [0, .5]) add(drums, t + h * SPB, x => x < .04 ? noise() * .15 * Math.exp(-x * 90) : 0);
  const bm = [33, 40, 36, 43][b % 4]; // bass jumps around so lanes must vary
  add(bass, t, x => x < SPB * .9 ? ((x * hz(bm)) % 1 * 2 - 1) * .3 * Math.exp(-x * 3) : 0);
  const vm = [69, 72, 76, 74, 72, 67, 71, 64][b % 8];
  add(vocals, t, x => x < SPB * .9 ? Math.sin(2 * Math.PI * hz(vm) * x) * .25 * Math.min(1, x * 80) * Math.exp(-x * 2) : 0);
}
for (let i = 0; i < N; i++) other[i] = drums[i] * .015; // 'other' is only faint drum bleed (-36 dB): must get no notes
const st = y => ({ left: y, right: y });
const song = analyze({ drums: st(drums), bass: st(bass), vocals: st(vocals), other: st(other) });

const off = t => { const r = ((t - OFFSET) / SPB) % .25 * SPB; return Math.min(r, SPB / 4 - r); }; // distance to the true 16th grid
const bars = song.beats.filter((_, i) => i >= song.downbeat && (i - song.downbeat) % 4 === 0);
assert(Math.abs(song.bpm - BPM) < .3, `bpm ${song.bpm}`);
const beatErr = Math.max(...song.beats.map(b => Math.abs((b - OFFSET) / SPB - Math.round((b - OFFSET) / SPB)) * SPB));
assert(beatErr < .005, `beat error ${(beatErr * 1000).toFixed(1)} ms`);
assert(bars.filter(b => b < kicks.at(-1) + .01).every(b => kicks.some(k => Math.abs(k - b) < .005)), `downbeat ${song.downbeat}: bars ${bars.slice(0, 3).map(b => b.toFixed(3))} vs kicks ${kicks.slice(0, 3).map(b => b.toFixed(3))}`);
const [dr, bs, vo] = song.tracks;
assert(dr.notes.length >= BARS * 2 && /* kicks + snares; very quiet hats may fall under the loudness gate */ dr.notes.every(([t]) => off(t) < .005), `drum notes ${dr.notes.length}`);
const kickLanes = dr.notes.filter(([t]) => kicks.some(k => Math.abs(k - t) < .005)).map(n => n[1]);
assert(kickLanes.length >= kicks.length - 1 && kickLanes.filter(l => l === 0).length / kickLanes.length > .9, `kick lanes ${kickLanes}`);
assert(song.tracks[3].notes.length === 0, `bleed-only stem got ${song.tracks[3].notes.length} notes`);
assert(new Set(bs.notes.map(n => n[1])).size === 3 && new Set(vo.notes.map(n => n[1])).size === 3, 'pitched lanes should use all three');
console.log(`ok: ${song.bpm} BPM, beat error ${(beatErr * 1000).toFixed(1)} ms, notes ${song.tracks.map(t => `${t.name} ${t.notes.length}`).join(', ')}`);

for (const options of [{ bpm: 0 }, { bpm: Infinity }, { bpm: 401 }, { density: 3 }])
  assert.throws(() => analyze({}, options), /BPM|Density/);
const forced = analyze({ drums: st(drums), bass: st(bass), vocals: st(vocals), other: st(other) }, { bpm: 120, density: 1 });
assert.equal(forced.bpm, 120);
assert(forced.beats.slice(1).every((beat, i) => Math.abs(beat - forced.beats[i] - .5) < .00011));

// Tempo-following grid: stems whose tempo drifts must chart on the music; steady stems keep the steady grid.
assert.equal(song.grid, 'steady', 'steady 128 BPM stems keep the steady grid');
const drift = (bpmAt, seconds) => {
  const beats = [], n = Math.ceil((seconds + 1) * SR), d = stem(), b = stem();
  let phase = 0, t = 0;
  for (; t < seconds; t += .001) {
    const before = phase; phase += bpmAt(t) / 60 * .001;
    if (Math.floor(phase * 2) > Math.floor(before * 2)) {
      const k = Math.floor(phase * 2), on = k % 2 === 0, at = t + .001 / 2;
      if (on) { beats.push(at); if (k / 2 % 4 === 0) add(d, at, x => x < .25 ? Math.sin(2 * Math.PI * (50 * x + 3 * (1 - Math.exp(-x * 30)))) * Math.exp(-x * 12) : 0); if (k / 2 % 4 === 2) add(d, at, x => x < .15 ? noise() * .5 * Math.exp(-x * 25) : 0); add(b, at, x => x < .3 ? ((x * hz([33, 40, 36, 43][k / 2 % 4])) % 1 * 2 - 1) * .3 * Math.exp(-x * 3) : 0); }
      else add(d, at, x => x < .04 ? noise() * .15 * Math.exp(-x * 90) : 0);
    }
  }
  return { beats, stems: { drums: st(d), bass: st(b), vocals: st(stem()), other: st(stem()) } };
};
const worst = (chartBeats, trueBeats, skip = 8) => {
  const errs = chartBeats.slice(skip).map(c => Math.min(...trueBeats.map(t => Math.abs(c - t))));
  return { share: errs.filter(e => e <= .015).length / errs.length, max: Math.max(...errs) };
};
for (const [name, bpmAt] of [['sinusoidal drift', t => 120 * (1 + .03 * Math.sin(2 * Math.PI * t / 40))], ['linear ramp', t => 100 + 10 * Math.min(t, 60) / 60]]) {
  const { beats: truth, stems } = drift(bpmAt, name === 'linear ramp' ? 60 : 90);
  const tracked = analyze(stems);
  assert.equal(tracked.grid, 'tracked', `${name} charts with the tracked grid`);
  const { share, max } = worst(tracked.beats, truth);
  assert(share >= .95, `${name}: ${(share * 100).toFixed(0)}% of beats within 15 ms (worst ${(max * 1000).toFixed(0)} ms)`);
  const steadyMax = worst(analyze(stems, { bpm: Math.round(tracked.bpm) }).beats, truth).max;
  assert(steadyMax > .06, `${name}: a steady grid strays only ${(steadyMax * 1000).toFixed(0)} ms, so this test would not bite`);
  console.log(`ok: ${name} tracked, ${(share * 100).toFixed(0)}% within 15 ms, worst ${(max * 1000).toFixed(0)} ms vs steady ${(steadyMax * 1000).toFixed(0)} ms`);
}

// Density 4 is the default: sixteenth-note hi-hats chart on the off-sixteenth slots too.
import { beatSlot } from './lib/beat-grid.js';
const hats = Float32Array.from(drums);
for (let s = 0; s < BARS * 16; s++) add(hats, OFFSET + s * SPB / 4, x => x < .03 ? noise() * .3 * Math.exp(-x * 100) : 0);
const sixteenths = analyze({ drums: st(hats), bass: st(bass), vocals: st(vocals), other: st(other) });
const offSlots = sixteenths.tracks[0].notes.filter(([t]) => beatSlot(sixteenths.beats, t)[1] % 2 === 1);
assert(offSlots.length >= BARS * 4, `only ${offSlots.length} drum notes on off-sixteenth slots`);
assert(offSlots.every(([t]) => off(t) < .005), 'off-sixteenth notes sit on the sixteenth grid');
console.log(`ok: density 4 charts ${offSlots.length} off-sixteenth drum notes`);

// Holds: a 2-beat sustained vocal followed by staccato notes. Only the sustain becomes a hold.
const sung = stem();
for (let bar = 0; bar < BARS; bar++) {
  const t = OFFSET + bar * 4 * SPB;
  add(sung, t, x => x < 2 * SPB ? Math.sin(2 * Math.PI * hz(69) * x) * .25 * Math.min(1, x * 80) * (x < 2 * SPB - .15 ? 1 : .5 * (1 + Math.cos(Math.PI * (x - 2 * SPB + .15) / .15))) : 0); // a natural 150 ms release, so the stop itself is not an onset
  for (const [beat, m] of [[2.5, 72], [3.5, 76]])
    add(sung, t + beat * SPB, x => x < .08 ? Math.sin(2 * Math.PI * hz(m) * x) * .25 * Math.min(1, x * 400) * Math.min(1, (.08 - x) * 50) : 0);
}
const held = analyze({ drums: st(drums), bass: st(bass), vocals: st(sung), other: st(other) });
const sustained = held.tracks[2].notes.filter(n => n[2]), shortNotes = held.tracks[2].notes.filter(n => !n[2]);
assert(sustained.length >= BARS - 2, `only ${sustained.length} of ${BARS} sustained notes became holds`);
assert(sustained.every(n => Math.abs(n[2] - 2 * SPB) <= SPB / 4 + 1e-3), `hold lengths ${sustained.slice(0, 4).map(n => n[2])} vs ${2 * SPB}`);
assert(shortNotes.length >= BARS, 'staccato notes stay taps');
assert(shortNotes.every(([t]) => !sustained.some(([s, , len]) => t > s && t < s + len)), 'no tap inside a hold');
for (const chart of [song, forced, sixteenths, held]) {
  assert(chart.tracks[0].notes.every(n => n.length === 2), 'drum tracks contain no holds');
  for (const track of chart.tracks)
    track.notes.forEach(([t, , len], i, all) => { if (len) assert(t + len < all[i + 1]?.[0] ?? Infinity, `${track.name}: hold at ${t} overlaps the next note`); });
}
console.log(`ok: ${sustained.length} sustained vocal notes became holds of ${(sustained[0][2] / SPB).toFixed(2)} beats; staccato notes and drums stay taps`);

// Learnable phrases. First the step itself: eight 2-bar repeats of one riff whose independently assigned lanes
// differ by up to two notes (what detuned pitches do) all come out with the first repeat's lanes.
import { repeatLanes } from './analyze.js';
{
  const base = [0, 0, 1, 1, 1, 2, 2, 2], offsets = [0, 4, 8, 12, 16, 20, 24, 28];
  const phrase = [], offset = [], lanes = [];
  for (let p = 0; p < 8; p++) base.forEach((lane, k) => {
    phrase.push(p); offset.push(offsets[k]);
    lanes.push((p === 2 && k === 3) || (p === 4 && (k === 0 || k === 6)) || (p === 7 && k === 5) ? (lane + 1) % 3 : lane);
  });
  const patterns = out => Array.from({ length: 8 }, (_, p) => out.slice(p * 8, p * 8 + 8).join(''));
  assert(new Set(patterns(lanes)).size > 1, 'the input repeats differ, so the test bites');
  assert(patterns(repeatLanes(phrase, offset, lanes)).every(p => p === base.join('')), 'every repeat gets the first one\'s lanes');
  // The same rhythm with the reversed melodic contour keeps its own lanes, and later clean repeats still match the riff.
  const reversed = lanes.slice(); reversed.splice(40, 8, ...[...base].reverse());
  const out = patterns(repeatLanes(phrase, offset, reversed));
  assert.equal(out[5], [...base].reverse().join(''), 'reversed contour keeps its own lanes');
  assert([0, 1, 2, 3, 4, 6, 7].every(p => out[p] === base.join('')));
  // A different rhythm is never merged, however alike the lanes.
  const shifted = offset.map((o, i) => (i >= 56 ? o + 2 : o));
  assert.equal(patterns(repeatLanes(phrase, shifted, lanes))[7], patterns(lanes)[7], 'different rhythm keeps its lanes');
  // Single pass in time order: the input is not mutated.
  const before = lanes.join(''); repeatLanes(phrase, offset, lanes); assert.equal(lanes.join(''), before);
}
// End to end on a detuned bass riff (one note per beat, every pitch jittered by a seeded ±40 cents).
let detune = 7; const cents = () => ((detune = (detune * 16807) % 2147483647) / 2147483647 * 2 - 1) * 40;
const riffSong = options => {
  detune = 7; // the same detune each time, so only the repeat step differs
  const y = stem();
  for (let b = 0; b < BARS * 4; b++) {
    const m = [35, 42, 49, 38][b % 4] + cents() / 100;
    add(y, OFFSET + b * SPB, x => x < SPB * .9 ? ((x * hz(m)) % 1 * 2 - 1) * .3 * Math.exp(-x * 3) : 0);
  }
  const chart = analyze({ drums: st(drums), bass: st(y), vocals: st(stem()), other: st(stem()) }, options), out = Array.from({ length: BARS / 2 }, () => []);
  for (const [t, lane] of chart.tracks[1].notes) out[Math.min(out.length - 1, Math.floor((t - OFFSET + .05) / (8 * SPB)))].push(lane);
  return out.map(p => p.join(''));
};
const withoutStep = riffSong({ repeatPhrases: false }), withStep = riffSong({});
const distinct = p => new Set(p).size;
assert(distinct(withoutStep) > 1, 'detuning makes repeats differ without the step');
assert(distinct(withStep) < distinct(withoutStep), `repeats converge: ${withoutStep.join(' ')} -> ${withStep.join(' ')}`);
console.log(`ok: repeats share lanes, a reversed contour and a different rhythm keep their own; detuned riff ${distinct(withoutStep)} -> ${distinct(withStep)} distinct patterns`);
