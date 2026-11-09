// @ts-check
// Browser charting inspired by prep.py; same song format, different onset and audibility heuristics.
// Input: stems as { drums, bass, vocals, other } -> { left, right } Float32Array at 44.1 kHz.
// Output: the same song shape prep.py writes ({ duration, beats, downbeat, tracks: [{ name, notes: [[t, lane]] }] }).
import { fft } from "./vendor/demucs-web/fft.js";

const SR = 22050,
  NFFT = 2048,
  HOP = 256,
  FPS = SR / HOP,
  NB = NFFT / 2 + 1;
// A centred 93 ms window makes onset-strength peaks lead the real attack; measured on synthetic stems (analyze.test.mjs).
const LEAD = 0.034;
export const CHART_V = 2; // bump when charting changes: stored songs are re-charted from their saved stems
/** @type {[string,string,[number,number] | null][]} */
export const STEMS = [
  ["drums", "DRUMS", null],
  ["bass", "BASS", [35, 400]],
  ["vocals", "VOCALS", [80, 1000]],
  ["other", "HARMONY", [80, 2000]],
];

const mono22 = ({ left, right }) => {
  // stereo 44.1k -> mono 22.05k (pair average is a good-enough anti-alias for analysis)
  const n = left.length >> 1,
    y = new Float32Array(n);
  for (let i = 0; i < n; i++)
    y[i] =
      (left[2 * i] + left[2 * i + 1] + right[2 * i] + right[2 * i + 1]) / 4;
  return y;
};
const pct = (arr, p) => {
  const s = Float32Array.from(arr).sort(),
    x = ((s.length - 1) * p) / 100,
    i = Math.floor(x);
  return s.length
    ? s[i] + (s[Math.min(i + 1, s.length - 1)] - s[i]) * (x - i)
    : 0;
};
const mel = (f) => 2595 * Math.log10(1 + f / 700);

// One pass of centred STFT frames -> per-frame onset strength (log-mel flux), loudness and three drum bands.
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
const peakTime = (env, n) => {
  // parabolic interpolation around a peak frame, in seconds
  const a = env[n - 1] ?? env[n],
    b = env[n],
    c = env[n + 1] ?? env[n],
    d = a - 2 * b + c;
  return (n + (d ? (0.5 * (a - c)) / d : 0)) / FPS;
};
const at = (env, t) => {
  const x = t * FPS,
    i = Math.floor(x);
  return i < 0 || i + 1 >= env.length
    ? 0
    : env[i] + (env[i + 1] - env[i]) * (x - i);
};

// Steady-tempo grid: autocorrelation picks the tempo (log-normal prior around 120 BPM, like librosa),
// then a fine search over period and phase maximises onset strength on the beats.
// ponytail: assumes one steady tempo; songs that drift or change tempo need a dynamic-programming beat tracker.
export function grid(env, duration) {
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
  const bpm0 = (FPS * 60) / lag0;
  best = -Infinity;
  let period = 60 / bpm0,
    phase = 0;
  for (let bpm = bpm0 * 0.97; bpm <= bpm0 * 1.03; bpm += 0.01) {
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

// Shift the grid onto the drum stem's attacks: median offset of drum onsets from the nearest 16th.
function align(beats, drumEnv) {
  const p16 = (beats[1] - beats[0]) / 4,
    res = [];
  for (const n of peaks(drumEnv)) {
    const t = peakTime(drumEnv, n) + LEAD,
      r = ((((t - beats[0]) % p16) + p16 * 1.5) % p16) - p16 / 2;
    if (Math.abs(r) < p16 / 2) res.push(r);
  }
  const shift = res.length ? pct(res, 50) : 0;
  return beats.map((b) => b + shift).filter((b) => b >= 0);
}

// YIN f0 (Hz) of a 2048-sample window starting at sample i, or 0 if unvoiced/out of range.
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
/** @returns {import("./lib/song").Note[]} */
function chart(y, ft, mixRms, beats, bars, pitch, density) {
  const { env, rms } = ft,
    gate = 0.1 * pct(rms, 95),
    L = Math.round(LEAD * FPS);
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
  const g16 = [];
  for (let k = 0; k + 1 < beats.length; k++)
    for (let q = 0; q < 4; q++)
      g16.push(beats[k] + ((beats[k + 1] - beats[k]) * q) / 4);
  const best = new Map(),
    per = 4 / density;
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
    const p90 = ["low", "mid", "high"].map((k) => pct(ft[k], 90) + 1e-9);
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
  return ts.map((t, i) => [Math.round(t * 1e4) / 1e4, lanes[i]]);
}

/** @param {Record<string,{left:Float32Array,right:Float32Array}>} stems
 * @param {{density?:number,onProgress?:(progress:number)=>void}} [options]
 * @returns {import("./lib/song").SongChart} */
export function analyze(stems, { density = 2, onProgress = () => {} } = {}) {
  const ys = {},
    ft = {};
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
    beats = align(grid(mixFt.env, duration), ft.drums.env);
  onProgress(5 / 6);
  // downbeat = the bar phase (0-3) whose beats carry the most kick energy; flux peaks lead the beat like onsets do
  const lf = ft.drums.lowFlux,
    kick = (b) => {
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
    notes: chart(ys[s], ft[s], mixFt.rms, beats, bars, pitch, density),
  }));
  onProgress(1);
  return {
    v: CHART_V,
    duration: Math.round(duration * 1e3) / 1e3,
    beats: beats.map((b) => Math.round(b * 1e4) / 1e4),
    downbeat: down,
    tracks,
    bpm: Math.round(600 / (beats[1] - beats[0])) / 10,
  };
}
