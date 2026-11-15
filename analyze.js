// @ts-check
// Shared charting for browser imports and offline prep.py.
// Input: stems as { drums, bass, vocals, other } -> { left, right } Float32Array at 44.1 kHz.
// Output: the same song shape prep.py writes ({ duration, beats, downbeat, tracks: [{ name, notes: [[t, lane]] }] }).
import { fft } from "./vendor/demucs-web/fft.js";
import { beatIndex, median } from "./lib/beat-grid.js";

const SR = 22050,
  NFFT = 2048,
  HOP = 256,
  FPS = SR / HOP,
  NB = NFFT / 2 + 1;
// A centred 93 ms window makes onset-strength peaks lead the real attack; measured on synthetic stems (analyze.test.mjs).
const LEAD = 0.034,
  HALF_WINDOW = NFFT / 2 / SR; // seconds from a frame's centre to its edge
export const CHART_V = 6; // bump when charting changes: stored songs are re-charted from their saved stems
/** @type {[string,string,[number,number] | null][]} */
export const STEMS = [
  ["drums", "DRUMS", null],
  ["bass", "BASS", [35, 400]],
  ["vocals", "VOCALS", [80, 1000]],
  ["other", "HARMONY", [80, 2000]],
];

/** @param {{left:Float32Array,right:Float32Array}} channels */
const mono22 = ({ left, right }) => {
  // stereo 44.1k -> mono 22.05k (pair average is a good-enough anti-alias for analysis)
  const n = left.length >> 1,
    y = new Float32Array(n);
  for (let i = 0; i < n; i++)
    y[i] =
      (left[2 * i] + left[2 * i + 1] + right[2 * i] + right[2 * i + 1]) / 4;
  return y;
};
/** @param {ArrayLike<number>} arr @param {number} p */
const pct = (arr, p) => {
  const s = Float32Array.from(arr).sort(),
    x = ((s.length - 1) * p) / 100,
    i = Math.floor(x);
  return s.length
    ? s[i] + (s[Math.min(i + 1, s.length - 1)] - s[i]) * (x - i)
    : 0;
};
/** @param {number} f */
const mel = (f) => 2595 * Math.log10(1 + f / 700);

// One pass of centred STFT frames -> per-frame onset strength (log-mel flux), loudness and three drum bands.
/** @param {Float32Array} y */
export function features(y) {
  const frames = Math.floor(y.length / HOP) + 1,
    win = new Float32Array(NFFT),
    re = new Float32Array(NFFT),
    im = new Float32Array(NFFT),
    buf = new Float32Array(NFFT);
  for (let i = 0; i < NFFT; i++)
    win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / NFFT);
  const NM = 64,
    band = new Int16Array(NB),
    mmax = mel(SR / 2);
  for (let k = 0; k < NB; k++)
    band[k] = Math.min(NM - 1, Math.floor((mel((k * SR) / NFFT) / mmax) * NM));
  const env = new Float32Array(frames),
    rms = new Float32Array(frames),
    low = new Float32Array(frames),
    mid = new Float32Array(frames),
    high = new Float32Array(frames),
    lowFlux = new Float32Array(frames),
    mp = new Float32Array(NM),
    prev = new Float32Array(NM);
  let prevLow = 0;
  for (let f = 0; f < frames; f++) {
    const start = f * HOP - NFFT / 2; // centred frame, zero padded at the edges
    for (let i = 0; i < NFFT; i++) {
      const j = start + i;
      buf[i] = j >= 0 && j < y.length ? y[j] * win[i] : 0;
    }
    fft(re, im, buf, NFFT);
    mp.fill(0);
    let pw = 0,
      lo = 0,
      md = 0,
      hi = 0;
    for (let k = 0; k < NB; k++) {
      const p = re[k] * re[k] + im[k] * im[k],
        a = Math.sqrt(p),
        hz = (k * SR) / NFFT;
      mp[band[k]] += p;
      pw += p;
      if (hz < 150) lo += a;
      else if (hz < 2000) md += a;
      else if (hz >= 5000) hi += a;
    }
    let flux = 0;
    for (let b = 0; b < NM; b++) {
      const db = 10 * Math.log10(mp[b] + 1e-6);
      if (f) flux += Math.max(0, db - prev[b]);
      prev[b] = db;
    }
    env[f] = flux / NM;
    rms[f] = Math.sqrt(pw);
    low[f] = lo;
    mid[f] = md;
    high[f] = hi;
    lowFlux[f] = Math.max(0, lo - prevLow);
    prevLow = lo; // linear, so a loud kick outweighs noise that merely starts from silence
  }
  return { env, rms, low, mid, high, lowFlux, frames };
}

// librosa.util.peak_pick with onset_detect's defaults, on a 0..1 normalised envelope.
/** @param {Float32Array} env */
export function peaks(env) {
  let mn = Infinity,
    mx = -Infinity;
  for (const v of env) {
    mn = Math.min(mn, v);
    mx = Math.max(mx, v);
  }
  const x = env.map((v) => (v - mn) / (mx - mn || 1)),
    out = [];
  const preMax = Math.floor(0.03 * FPS),
    postMax = 1,
    preAvg = Math.floor(0.1 * FPS),
    postAvg = Math.floor(0.1 * FPS) + 1,
    wait = Math.floor(0.03 * FPS);
  let last = -Infinity;
  for (let n = 0; n < x.length; n++) {
    let m = -Infinity,
      s = 0,
      c = 0;
    for (
      let i = Math.max(0, n - preMax);
      i < Math.min(x.length, n + postMax);
      i++
    )
      m = Math.max(m, x[i]);
    if (x[n] !== m) continue;
    for (
      let i = Math.max(0, n - preAvg);
      i < Math.min(x.length, n + postAvg);
      i++
    ) {
      s += x[i];
      c++;
    }
    if (x[n] >= s / c + 0.07 && n - last > wait) {
      out.push(n);
      last = n;
    }
  }
  return out;
}
/** @param {Float32Array} env @param {number} n */
const peakTime = (env, n) => {
  // parabolic interpolation around a peak frame, in seconds
  const a = env[n - 1] ?? env[n],
    b = env[n],
    c = env[n + 1] ?? env[n],
    d = a - 2 * b + c;
  return (n + (d ? (0.5 * (a - c)) / d : 0)) / FPS;
};
/** @param {Float32Array} env @param {number} t */
const at = (env, t) => {
  const x = t * FPS,
    i = Math.floor(x);
  return i < 0 || i + 1 >= env.length
    ? 0
    : env[i] + (env[i + 1] - env[i]) * (x - i);
};

// Steady-tempo grid: autocorrelation picks the tempo (log-normal prior around 120 BPM, like librosa),
// then a fine search over period and phase maximises onset strength on the beats.
// Fits one period and one phase to the whole song; trackBeats below handles songs that drift.
/** @param {Float32Array} env @param {number} duration */
export function grid(env, duration, forcedBpm = 0) {
  let mean = 0;
  for (const v of env) mean += v;
  mean /= env.length;
  let best = -Infinity,
    lag0 = 0;
  for (
    let L = Math.floor((FPS * 60) / 240);
    L <= Math.ceil((FPS * 60) / 50);
    L++
  ) {
    let s = 0;
    for (let n = 0; n + L < env.length; n++)
      s += (env[n] - mean) * (env[n + L] - mean);
    const w = Math.exp(-0.5 * Math.log2((FPS * 60) / L / 120) ** 2);
    if (s * w > best) {
      best = s * w;
      lag0 = L;
    }
  }
  const bpm0 = forcedBpm || (FPS * 60) / lag0;
  best = -Infinity;
  let period = 60 / bpm0,
    phase = 0;
  for (
    let bpm = forcedBpm || bpm0 * 0.97;
    bpm <= (forcedBpm || bpm0 * 1.03);
    bpm += 0.01
  ) {
    const p = 60 / bpm;
    for (let ph = 0; ph < p; ph += 0.002) {
      let s = 0;
      for (let t = ph; t < duration; t += p) s += at(env, t);
      if (s > best) {
        best = s;
        period = p;
        phase = ph;
      }
    }
  }
  const beats = [];
  for (let t = phase; t < duration; t += period) beats.push(t);
  return beats;
}

// Dynamic-programming beat tracker (Ellis 2007, the method behind librosa.beat.beat_track): a beat scores its onset
// strength plus the best earlier beat, less a penalty for straying from `period`, so the grid follows a drifting tempo.
// ponytail: one global period prior; an abrupt tempo change beyond about ±10% needs per-section period estimates.
const TIGHTNESS = 100;
/** @param {Float32Array} env @param {number} period seconds per beat, from the steady fit */
export function trackBeats(env, period) {
  const n = env.length,
    P = period * FPS;
  let sum = 0,
    sq = 0;
  for (const v of env) {
    sum += v;
    sq += v * v;
  }
  const sd = Math.sqrt(Math.max(0, sq / n - (sum / n) ** 2)) || 1,
    half = Math.ceil(P / 8),
    win = new Float32Array(2 * half + 1),
    local = new Float32Array(n);
  for (let k = -half; k <= half; k++)
    win[k + half] = Math.exp(-0.5 * ((k * 32) / P) ** 2);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let k = Math.max(-half, -i); k <= half && i + k < n; k++)
      s += env[i + k] * win[k + half];
    local[i] = s / sd;
  }
  const lo = Math.round(P / 2),
    hi = Math.round(2 * P),
    penalty = new Float32Array(hi + 1),
    cum = new Float32Array(n),
    back = new Int32Array(n).fill(-1);
  for (let d = lo; d <= hi; d++) penalty[d] = -TIGHTNESS * Math.log(d / P) ** 2;
  for (let i = 0; i < n; i++) {
    let top = -Infinity;
    for (let d = lo; d <= hi && d <= i; d++) {
      const score = cum[i - d] + penalty[d];
      if (score > top) {
        top = score;
        back[i] = i - d;
      }
    }
    cum[i] = local[i] + (back[i] >= 0 ? top : 0);
  }
  let last = n - 1;
  for (let i = Math.max(0, n - Math.round(P)); i < n; i++)
    if (cum[i] > cum[last]) last = i;
  /** @type {number[]} */
  const frames = [];
  for (let i = last; i >= 0; i = back[i]) frames.push(i);
  // sub-frame time of the nearest envelope peak, then a local least-squares line over ±4 beats smooths the jitter
  const raw = frames.reverse().map((f) => {
    let m = f;
    for (let i = Math.max(0, f - 2); i <= Math.min(n - 1, f + 2); i++)
      if (env[i] > env[m]) m = i;
    return peakTime(env, m);
  });
  return raw.map((_, k) => {
    const a = Math.max(0, k - 4),
      b = Math.min(raw.length - 1, k + 4),
      c = b - a + 1;
    let sx = 0,
      sy = 0,
      sxx = 0,
      sxy = 0;
    for (let j = a; j <= b; j++) {
      sx += j;
      sy += raw[j];
      sxx += j * j;
      sxy += j * raw[j];
    }
    const den = c * sxx - sx * sx;
    return den ? (sy + ((k * c - sx) * (c * sxy - sx * sy)) / den) / c : raw[k];
  });
}

/** Tracked beats are kept only when the song really drifts: 95% of them within 25 ms of a steady beat means steady.
 * @param {number[]} tracked @param {number[]} steady */
function drifts(tracked, steady) {
  const period = median(steady.slice(1).map((b, i) => b - steady[i]));
  const near = tracked.filter((b) => {
    const k = Math.round((b - steady[0]) / period),
      s = steady[Math.min(steady.length - 1, Math.max(0, k))];
    return Math.abs(b - s) <= 0.025;
  });
  return near.length / tracked.length < 0.95;
}

// Shift the grid onto the drum stem's attacks: median offset of drum onsets from the nearest 16th of their own beat.
/** @param {number[]} beats @param {Float32Array} drumEnv */
function align(beats, drumEnv) {
  const res = [];
  for (const n of peaks(drumEnv)) {
    const t = peakTime(drumEnv, n) + LEAD,
      k = Math.min(Math.max(beatIndex(beats, t), 0), beats.length - 2),
      p16 = (beats[k + 1] - beats[k]) / 4,
      r = ((((t - beats[k]) % p16) + p16 * 1.5) % p16) - p16 / 2;
    if (Math.abs(r) < p16 / 2) res.push(r);
  }
  const shift = res.length ? pct(res, 50) : 0;
  return beats.map((b) => b + shift).filter((b) => b >= 0);
}

// YIN f0 (Hz) of a 2048-sample window starting at sample i, or 0 if unvoiced/out of range.
/** @param {Float32Array} y @param {number} i @param {number} fmin @param {number} fmax */
function yin(y, i, fmin, fmax) {
  const W = 1024,
    tmax = Math.min(W, Math.floor(SR / fmin)),
    tmin = Math.max(2, Math.floor(SR / fmax)),
    d = new Float32Array(tmax + 1);
  if (i < 0 || i + W + tmax >= y.length) return 0;
  for (let tau = 1; tau <= tmax; tau++) {
    let s = 0;
    for (let j = 0; j < W; j++) {
      const v = y[i + j] - y[i + j + tau];
      s += v * v;
    }
    d[tau] = s;
  }
  let run = 0,
    bestTau = 0,
    bestV = Infinity;
  for (let tau = 1; tau <= tmax; tau++) {
    run += d[tau];
    const v = (d[tau] * tau) / (run || 1);
    if (tau >= tmin && v < bestV) {
      bestV = v;
      bestTau = tau;
    }
    if (tau >= tmin && v < 0.15) {
      bestTau = tau;
      break;
    }
  }
  return bestTau ? SR / bestTau : 0;
}

// A note counts only if its stem is audible at that moment: loud for this stem (vs its own peaks) AND within -20 dB
// of the whole mix. Demucs always returns all four stems, so an instrumental's "vocals" is faint bleed with real onsets.
const AUDIBLE = 0.1;
/** @returns {import("./lib/song").Note[]}
 * @param {Float32Array} y @param {ReturnType<typeof features>} ft @param {Float32Array} mixRms @param {number[]} beats @param {number[]} bars @param {[number,number] | null} pitch @param {number} density @param {boolean} repeatPhrases */
function chart(y, ft, mixRms, beats, bars, pitch, density, repeatPhrases) {
  const { env, rms } = ft,
    gate = 0.1 * pct(rms, 95),
    L = Math.round(LEAD * FPS);
  /** @param {Float32Array} r @param {number} n */
  const loud = (r, n) => {
    let m = 0;
    for (let i = n; i <= Math.min(n + L + 4, r.length - 1); i++)
      m = Math.max(m, r[i]);
    return m;
  };
  const on = peaks(env).filter((n) => {
    const v = loud(rms, n);
    return v > gate && v > AUDIBLE * loud(mixRms, n);
  }); // the note that just started, not the gap before it
  if (!on.length) return [];
  /** @type {number[]} */
  const g16 = [];
  for (let k = 0; k + 1 < beats.length; k++)
    for (let q = 0; q < 4; q++)
      g16.push(beats[k] + ((beats[k + 1] - beats[k]) * q) / 4);
  /** @type {Map<number,[number,number]>} */
  const best = new Map();
  const per = 4 / density;
  for (const n of on) {
    const t = n / FPS + LEAD;
    let lo = 0,
      hi = g16.length - 1;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (g16[m] < t) lo = m + 1;
      else hi = m;
    }
    const s = lo > 0 && t - g16[lo - 1] < g16[lo] - t ? lo - 1 : lo,
      w = Math.floor(s / per),
      cur = best.get(w);
    if (!cur || env[n] > env[cur[1]]) best.set(w, [s, n]);
  }
  const picks = [...best.values()].sort((a, b) => a[0] - b[0]),
    ts = picks.map(([s]) => g16[s]);
  const fr = picks.map(([, n]) => Math.min(n + L + 4, ft.frames - 1)); // read features ~46 ms after the attack (as prep.py)
  let lanes;
  if (!pitch) {
    const p90 = /** @type {const} */ (["low", "mid", "high"]).map(
      (k) => pct(ft[k], 90) + 1e-9,
    );
    lanes = fr.map((f) => {
      const v = [ft.low[f] / p90[0], ft.mid[f] / p90[1], ft.high[f] / p90[2]];
      return v.indexOf(Math.max(...v));
    });
  } else {
    const m = fr.map((f) => {
      const hz = yin(y, f * HOP - 512, pitch[0], pitch[1]);
      return hz ? 69 + 12 * Math.log2(hz / 440) : 0;
    });
    const phrase = ts.map((t) => {
      let i = 0;
      while (i < bars.length && bars[i] <= t) i++;
      return Math.floor(i / 2);
    });
    lanes = ts.map(() => 1);
    for (const p of new Set(phrase)) {
      const idx = phrase.flatMap((q, i) => (q === p ? [i] : [])),
        lo = pct(
          idx.map((i) => m[i]),
          33,
        ),
        hi = pct(
          idx.map((i) => m[i]),
          67,
        );
      if (hi - lo >= 1)
        for (const i of idx) lanes[i] = Number(m[i] > lo) + Number(m[i] > hi); // < 1 semitone of movement: all middle lane
    }
  }
  if (repeatPhrases) {
    // the game's phrase: bars 2p and 2p + 1 (notes before the first bar belong to phrase 0)
    const phrase = ts.map((t) => Math.max(0, beatIndex(bars, t)) >> 1);
    lanes = repeatLanes(
      phrase,
      picks.map(
        ([slot], i) => slot - beatIndex(beats, bars[2 * phrase[i]]) * 4,
      ),
      lanes,
    );
  }
  const lengths = pitch ? holdLengths(rms, picks, g16, L) : [];
  return ts.map((t, i) => {
    const note = /** @type {import("./lib/song").Note} */ ([
      Math.round(t * 1e4) / 1e4,
      lanes[i],
    ]);
    if (lengths[i]) note.push(Math.round(lengths[i] * 1e4) / 1e4);
    return note;
  });
}

// Learnable phrases: when a riff repeats (same rhythm, mostly the same lanes), every repeat plays the first one's lanes,
// so small pitch-detection differences do not change what the player learned. A phrase is the game's 2-bar unit.
// ponytail: lanes only. A repeat with one extra or one missing onset stays different; repairing rhythm from repeats is the upgrade.
/** @param {number[]} phrase phrase index per note @param {number[]} offset sixteenth slots from the phrase start per note
 * @param {number[]} lanes independently assigned lanes per note, in time order
 * @returns {number[]} lanes with repeats of a phrase copied from its first occurrence */
export function repeatLanes(phrase, offset, lanes) {
  const out = lanes.slice(),
    /** @type {{ rhythm: string, lanes: number[] }[]} */
    canonical = [],
    /** @type {Map<number, number[]>} */
    groups = new Map();
  phrase.forEach((p, i) => groups.set(p, [...(groups.get(p) || []), i]));
  for (const idx of groups.values()) {
    const rhythm = idx.map((i) => offset[i]).join(","),
      mine = idx.map((i) => lanes[i]),
      same = canonical.find(
        (c) =>
          c.rhythm === rhythm &&
          c.lanes.filter((lane, k) => lane === mine[k]).length >=
            0.75 * mine.length,
      );
    if (same) idx.forEach((i, k) => (out[i] = same.lanes[k]));
    else canonical.push({ rhythm, lanes: mine });
  }
  return out;
}

// Sustained pitched notes become holds: follow the stem's loudness from each attack while it stays at or above half
// its peak (dips of up to 3 frames allowed), end at most one sixteenth before the next note, snap down to the
// sixteenth grid, and keep only holds of at least one beat. Shorter sustains stay taps.
/** @param {Float32Array} rms @param {[number,number][]} picks @param {number[]} g16 @param {number} L
 * @returns {number[]} hold length in seconds per pick, 0 for taps */
function holdLengths(rms, picks, g16, L) {
  return picks.map(([slot, n], i) => {
    const start = Math.min(n + L + 4, rms.length - 1);
    let peak = 0;
    for (let f = n; f <= start; f++) peak = Math.max(peak, rms[f]);
    let end = start,
      dips = 0;
    for (let f = start + 1; f < rms.length && dips <= 3; f++)
      if (rms[f] >= peak / 2) {
        end = f;
        dips = 0;
      } else dips++;
    let last = slot; // last sixteenth slot at or before the end of the sound
    while (last + 1 < g16.length && g16[last + 1] <= end / FPS + HALF_WINDOW)
      last++; // the last frame at half peak is centred about half a window before the sound ends
    if (i + 1 < picks.length) last = Math.min(last, picks[i + 1][0] - 1);
    return last - slot >= 4 ? g16[last] - g16[slot] : 0;
  });
}

/** @param {Record<string,{left:Float32Array,right:Float32Array}>} stems
 * @param {{density?:number,bpm?:number,onProgress?:(progress:number)=>void,repeatPhrases?:boolean}} [options]
 * @returns {import("./lib/song").SongChart} */
export function analyze(
  stems,
  { density = 4, bpm, onProgress = () => {}, repeatPhrases = true } = {},
) {
  if (![1, 2, 4].includes(density))
    throw new Error("Density must be 1, 2 or 4.");
  if (bpm !== undefined && (!Number.isFinite(bpm) || bpm < 20 || bpm > 400))
    throw new Error("BPM must be between 20 and 400.");
  /** @type {Record<string,Float32Array>} */
  const ys = {};
  /** @type {Record<string,ReturnType<typeof features>>} */
  const ft = {};
  STEMS.forEach(([s], i) => {
    ys[s] = mono22(stems[s]);
    ft[s] = features(ys[s]);
    onProgress((i + 1) / 6);
  });
  const duration = stems.drums.left.length / 44100,
    mix = new Float32Array(ys.drums.length);
  for (const [s] of STEMS)
    for (let i = 0; i < mix.length; i++) mix[i] += ys[s][i];
  const mixFt = features(mix),
    steady = grid(mixFt.env, duration, bpm);
  let found = steady,
    kind = /** @type {"steady" | "tracked"} */ ("steady");
  if (!bpm && steady.length > 8) {
    const tracked = trackBeats(
      mixFt.env,
      median(steady.slice(1).map((b, i) => b - steady[i])),
    );
    if (tracked.length > 8 && drifts(tracked, steady)) {
      found = tracked;
      kind = "tracked";
    }
  }
  const beats = align(found, ft.drums.env);
  onProgress(5 / 6);
  // downbeat = the bar phase (0-3) whose beats carry the most kick energy; flux peaks lead the beat like onsets do
  const lf = ft.drums.lowFlux,
    kick = (/** @type {number} */ b) => {
      const c = Math.round((b - LEAD) * FPS);
      let m = 0;
      for (let i = Math.max(0, c - 2); i <= Math.min(lf.length - 1, c + 2); i++)
        m = Math.max(m, lf[i]);
      return m;
    };
  let down = 0,
    best = -1;
  for (let p = 0; p < 4; p++) {
    let s = 0;
    for (let k = p; k < beats.length; k += 4) s += kick(beats[k]);
    if (s > best) {
      best = s;
      down = p;
    }
  }
  const bars = beats.filter((_, i) => i >= down && (i - down) % 4 === 0);
  const tracks = STEMS.map(([s, name, pitch]) => ({
    name,
    stem: s,
    notes: chart(
      ys[s],
      ft[s],
      mixFt.rms,
      beats,
      bars,
      pitch,
      density,
      repeatPhrases,
    ),
  }));
  onProgress(1);
  return {
    v: CHART_V,
    duration: Math.round(duration * 1e3) / 1e3,
    beats: beats.map((b) => Math.round(b * 1e4) / 1e4),
    downbeat: down,
    tracks,
    bpm:
      Math.round(600 / median(beats.slice(1).map((b, i) => b - beats[i]))) / 10,
    grid: kind,
  };
}
