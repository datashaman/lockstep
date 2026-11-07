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
