// @ts-check
/** @typedef {import('./lib/song').SongEntry} SongEntry */
/** @typedef {import('./lib/song').SongChart} SongChart */
/** @typedef {import('./lib/song').PlayableSong} PlayableSong */
/** @typedef {import('./lib/song').Note} Note */
/** @typedef {import('./lib/gameplay.js').GameTrack} GameTrack */
/** @typedef {import('./lib/input-actions.js').InputAction} InputAction */
/** @typedef {{key:string,shiftKey?:boolean,ctrlKey?:boolean,metaKey?:boolean,repeat?:boolean,target?:EventTarget|null,preventDefault?:()=>void}} KeyInput */
/** @typedef {string|CanvasGradient|CanvasPattern} CanvasStyle */
import { createPauseSession } from "./lib/pause-session.js";
import { createSceneRenderer } from "./lib/scene-renderer.js";
import { createSongMenu, createTrackDialog } from "./lib/song-menu.js";
import {
  audiusURL,
  createAudiusClient,
  createTrackSearch,
} from "./lib/audius.js";
import {
  createRunState,
  applyGroove,
  isAutomatic,
  noteIndex,
  findHittableNote,
  recordHit,
  recordCapture,
  recordMiss,
  nextTrack,
  createTracks,
} from "./lib/gameplay.js";
const run = createRunState();
import { actionForKey } from "./lib/input-actions.js";
import { createStemPlayer } from "./lib/stem-player.js";
import { createAudioEngine } from "./lib/audio-engine.js";
import { songPosition, audioElapsed } from "./lib/transport.js";
import {
  extendBeatGrid,
  beatIndex,
  fractionalBar,
  beatSlot,
  thinChart,
} from "./lib/beat-grid.js";
import { createSongLibrary } from "./lib/song-library.js";
import {
  checkImportSize,
  checkImportDuration,
  importBytes,
  importDuration,
} from "./lib/audio-import.js";
// Lockstep: original phrase-capture rhythm game. J K L = lanes, A / D = switch track.
const BPM = 120,
  STEP = 60 / BPM / 4,
  BEAT = 4 * STEP,
  BARLEN = 16 * STEP,
  BARS = 32,
  CAPTURE_BARS = 8,
  PERFECT = 0.035,
  LEAD_IN = 3;
// Difficulty thins the stored chart at play time (no re-separation). win = hit window in seconds.
const LEVELS = [
  { name: "EASY", win: 0.12 },
  { name: "NORMAL", win: 0.1 },
  { name: "HARD", win: 0.09 },
];
const CHORDS = [
  [57, 60, 64],
  [53, 57, 60],
  [48, 52, 55],
  [55, 59, 62],
]; // Am F C G
const HUES = [275, 215, 185, 325]; // sky tint per chord
const COLORS = ["#ff4d6d", "#ffb703", "#3ddc97", "#4cc9f0"];
/** @type {Record<string,import("./lib/scene").Theme>} */
const THEMES = {
  neon: { name: "Neon", colors: COLORS, hues: HUES },
  liquid: {
    name: "Liquid Dream",
    colors: ["#ffb3c6", "#f7d794", "#8ce8cf", "#a7c7ff"],
    hues: [195, 205, 182, 215],
  },
  paper: {
    name: "Paper City",
    colors: ["#ef957d", "#e5ca78", "#95c6af", "#aebce0"],
    hues: [28, 36, 18, 42],
  },
  circuit: {
    name: "Circuit Cathedral",
    colors: ["#ff819b", "#f1d276", "#76edbd", "#89bfff"],
    hues: [225, 245, 215, 260],
  },
};
/** @type {{default:string,songs:Record<string,string>}} */
let themeSettings = { default: "neon", songs: {} };
let theme = THEMES.neon;
try {
  const saved = JSON.parse(globalThis.localStorage?.lockstepThemes || "{}");
  if (
    typeof saved?.default === "string" &&
    Object.hasOwn(THEMES, saved.default)
  )
    themeSettings.default = saved.default;
  if (saved?.songs && typeof saved.songs === "object")
    themeSettings.songs = Object.fromEntries(
      Object.entries(saved.songs).filter(
        ([, v]) => typeof v === "string" && Object.hasOwn(THEMES, v),
      ),
    );
} catch {}
const isLiquid = () => theme === THEMES.liquid;
const isPaper = () => theme === THEMES.paper;
const isCircuit = () => theme === THEMES.circuit;
/** @param {SongEntry} e */
function applyTheme(e) {
  const key = themeSettings.songs[songKey(e || DEMO)] || themeSettings.default;
  theme = Object.hasOwn(THEMES, key) ? THEMES[key] : THEMES.neon;
  tracks?.forEach((tr, i) => (tr.color = theme.colors[i]));
  materialTexture(); // warm on selection, before gameplay begins
  prepareThemeShader();
}
function chooseTheme(useAsDefault = false) {
  const e = menu.entries[menu.selected];
  if (!e || e.add || e.find) return;
  const keys = Object.keys(THEMES),
    current = keys.findIndex((key) => THEMES[key] === theme);
  if (useAsDefault) themeSettings.default = keys[current];
  else themeSettings.songs[songKey(e)] = keys[(current + 1) % keys.length];
  applyTheme(e);
  try {
    localStorage.lockstepThemes = JSON.stringify(themeSettings);
  } catch {}
}
const W = 800,
  H = 600,
  HZ = 190,
  HIT_Y = 500,
  F = 0.8,
  LOOK = 4,
  TW = 168,
  GAP = 26,
  LW = TW / 3;
const SANS = "system-ui, sans-serif",
  MONO = "ui-monospace, Menlo, monospace";
/** @param {string} id */
function requiredElement(id) {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing required element: ${id}`);
  return element;
}
/** @param {HTMLCanvasElement} canvas */
function context2D(canvas) {
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas 2D is unavailable.");
  return context;
}
const cv = /** @type {HTMLCanvasElement} */ (requiredElement("c")),
  g = context2D(cv),
  DPR = Math.min(2, globalThis.devicePixelRatio || 1);
cv.width = W * DPR;
cv.height = H * DPR;
const reducedMotion = globalThis.matchMedia?.(
  "(prefers-reduced-motion: reduce)",
);
/** @param {number} seed */
function rng(seed) {
  return () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
}
/** @type {Record<string,(step:number,random:()=>number)=>number>} */
const PICK = {
  drums: (s, r) => {
    const m = s % 16;
    return m % 8 === 0
      ? 0
      : m % 8 === 4
        ? 1
        : m % 4 === 2 && r() < 0.7
          ? 2
          : -1;
  },
  bass: (s, r) =>
    s % 16 === 0 ? 0 : s % 2 === 0 && r() < 0.4 ? Math.floor(r() * 3) : -1,
  arp: (s, r) => (s % 2 === 0 && r() < 0.75 ? [0, 1, 2, 1][(s / 2) % 4] : -1),
  lead: (s, r) => (s % 2 === 0 && r() < 0.35 ? Math.floor(r() * 3) : -1),
};
// One 2-bar phrase per 8-bar section, repeated 4x, so the player can learn it.
/** @returns {import('./lib/song').Note[]}
 * @param {string} kind @param {number} seed */
function chart(kind, seed) {
  const r = rng(seed);
  /** @type {import('./lib/song').Note[]} */
  const notes = [];
  for (let sec = 0; sec < BARS / 8; sec++) {
    const phrase = [];
    for (let s = 0; s < 32; s++) {
      const lane = PICK[kind](s, r);
      if (lane >= 0) phrase.push([s, lane]);
    }
    if (!phrase.length) phrase.push([0, 0]);
    for (let rep = 0; rep < 4; rep++)
      for (const [s, lane] of phrase) {
        notes.push([((sec * 8 + rep * 2) * 16 + s) * STEP, lane]);
      }
  }
  return notes;
}
// A song: { title, duration, beats: [s], downbeat: index of first bar's beat, tracks: [{ name, notes: [[t, lane]] }] }
// plus either synth: true (built-in demo, notes make sounds) or buffers: [AudioBuffer per track] (real stems).
/** @returns {import('./lib/song').PlayableSong} */
const demoSong = () => ({
  title: "Demo (synth)",
  synth: true,
  duration: BARS * BARLEN,
  downbeat: 0,
  beats: Array.from({ length: BARS * 4 + 1 }, (_, k) => k * BEAT),
  tracks: [
    ["DRUMS", "drums"],
    ["BASS", "bass"],
    ["ARP", "arp"],
    ["LEAD", "lead"],
  ].map(([name, kind], i) => ({ name, kind, notes: chart(kind, 7 + i * 101) })),
});
// ---------- state ----------
/** @type {AudioContext} */
let ac;
/** @type {ReturnType<typeof createAudioEngine>} */
let audio;
/** @type {ReturnType<typeof createStemPlayer>} */
let stemPlayer;
/** @type {ReturnType<typeof createStemPlayer>} */
let previewPlayer;
let t0 = 0,
  sched = 0,
  song = demoSong(),
  overAt = 0;
/** @type {import('./lib/gameplay.js').GameTrack[]} */
let tracks = [];
/** @type {import("./lib/input-actions.js").Screen} */
let mode = "title";
let loadErr = "";
let level = +(globalThis.localStorage?.lockstepLevel ?? 1);
/** @param {number} value */
function clampOffset(value) {
  return Number.isFinite(value) ? Math.max(-0.5, Math.min(0.5, value)) : 0;
}
let offset = clampOffset(+(globalThis.localStorage?.lockstepOffset || 0)),
  offsetAt = -9; // player's audio calibration, seconds
/** @type {number[]} */
let beats = [];
/** @type {number[]} */
let bars = [];
let gridDown = 0;
let shown = 0,
  rt = 0,
  last = performance.now() / 1000,
  phase = 0,
  pulse = 0;
let camX = 0,
  camTo = 0,
  bendX = 0,
  bendY = 0,
  bendAmp = 0.6,
  hue = HUES[0],
  shake = 0,
  missAt = -9;
/** @type {import("./lib/scene").SceneFrame["flash"]} */
let flash = null;
/** @type {import("./lib/scene").SceneFrame["dash"]} */
let dash = null;
/** @type {import("./lib/scene").SceneFrame["entrance"]} */
let entrance = null;
let inSync = false,
  syncAt = -9;
/** @typedef {ReturnType<typeof createPauseSession<HTMLCanvasElement>>} PauseState */
/** @type {PauseState | null} */
let pauseState = null;
let visualOffset = 0;
let failedAt = 0;
let tempo = [{ at: 0, pos: 0, rate: 1 }];
/** @type {import("./lib/scene").Particle[]} */
let parts = [];
/** @type {import("./lib/scene").Popup[]} */
let pops = [];
/** @type {{x:number,born:number,color:string}[]} */
let rings = [];
let press = [-9, -9, -9],
  laneHit = new Array(12).fill(-9);
const stars = Array.from({ length: 220 }, () => ({
  x: Math.random() * 2 - 1,
  y: Math.random() * 2 - 1,
  z: Math.random(),
}));
const LIVE = 1,
  CUE = 0.35,
  GHOST = 0.2; // stem volume: playing well / your track before a hit / other tracks (GHOST high enough to mask separation artifacts)
// One piecewise-linear transport drives stems, synth scheduling and judgement.
/** @param {number} elapsed */
const songTime = (elapsed) => songPosition(tempo, elapsed);
/** @param {number} position */
const audioTime = (position) => t0 + audioElapsed(tempo, position);
const now = () =>
  mode === "failed"
    ? failedAt
    : songTime(
        ac.currentTime -
          t0 -
          (ac.outputLatency || ac.baseLatency || 0) -
          offset,
      );
/** @param {number} rate */
function setTempo(rate) {
  if (tempo.at(-1)?.rate === rate) return;
  // Stay beyond the synth lookahead so already-scheduled notes never move.
  const at = ac.currentTime - t0 + 0.15,
    pos = songTime(at);
  tempo.push({ at, pos, rate });
  stemPlayer?.setRate(rate, t0 + at);
}
/** @param {number} amount */
function changeGroove(amount) {
  const rate = applyGroove(run, amount);
  if (!run.groove) {
    failedAt = now();
    mode = "failed";
    inSync = false;
    entrance = null;
    stopStems();
    audio?.stopSounds();
    audio?.mute();
    return;
  }
  setTempo(rate);
}
const auto = isAutomatic;
/** @param {GameTrack} tr @param {number} t */
const locked = (tr, t) => bar(t) < tr.capTo;
/** @param {GameTrack} tr @param {number} t */
const captureRemaining = (tr, t) =>
  Math.max(0, Math.min(1, (tr.capTo - barF(t)) / CAPTURE_BARS));
/** @param {number} i */
const trackX = (i) => (i - 1.5) * (TW + GAP);
// Beat grid: the song's beats, extended back through the count-in and forward past the end.
/** @param {PlayableSong} song */
function setGrid(song) {
  ({ beats, bars, downbeat: gridDown } = extendBeatGrid(song, LEAD_IN, LOOK));
}
const idx = beatIndex;
/** @param {number} time */
const barF = (time) => fractionalBar(bars, time);
/** @param {number} time */
const bar = (time) => Math.floor(barF(time));
/** @param {number} time */
const slot = (time) => beatSlot(beats, time);
/** @param {Note[]} notes @param {number} level */
const thin = (notes, level) => thinChart(notes, level, beats);
const buildTracks = () =>
  createTracks(song.tracks, theme.colors, level, beats, bars);
/** @param {GameTrack} tr @param {number} phrase */
function phraseNotes(tr, phrase) {
  return tr.notes.slice(
    noteIndex(tr.notes, phrase ? bars[phrase * 2] : -Infinity),
    noteIndex(tr.notes, bars[phrase * 2 + 2] ?? Infinity),
  );
}
const stopStems = () => stemPlayer?.stop();
/** @param {HTMLCanvasElement | null} [menuImage] */
function reset(menuImage = null) {
  Object.assign(run, createRunState());
  setGrid(song);
  tracks = buildTracks();
  run.currentTrack = Math.max(
    0,
    tracks.findIndex((tr) => tr.notes.length),
  );
  mode = "play";
  shown = 0;
  parts = [];
  pops = [];
  rings = [];
  flash = null;
  dash = null;
  laneHit.fill(-9);
  inSync = false;
  syncAt = -9;
  entrance = menuImage ? { image: menuImage, at: rt } : null;
  if (menuImage && reducedMotion?.matches)
    camX = camTo = trackX(run.currentTrack);
  tempo = [{ at: 0, pos: 0, rate: 1 }];
  audio?.stopSounds();
  audio?.restoreVolume();
  t0 = ac.currentTime + LEAD_IN;
  sched = -LEAD_IN;
  stopStems();
  if (song.buffers) stemPlayer.start(song.buffers, t0);
}
// ---------- song sources: built-in demo · your library (separated in this browser, kept in IndexedDB) · songs/ (prep.py) ----------
const DEMO = { title: "Demo (synth)" },
  ADD = { title: "Add a file", add: true },
  FIND = { title: "Find on Audius", find: true };
const songMenu = createSongMenu(DEMO, ADD, FIND);
const menu = songMenu.state;
/** @typedef {{title:string,phase:string,progress:number}} ImportStatus */
/** @typedef {{title:string,bytes:()=>Promise<ArrayBuffer>,url?:string,done?:(entry:import('./lib/song').SongEntry)=>void,failed?:(error:unknown)=>void}} ImportJob */
/** @type {ImportStatus | null} */
let job = null;
/** @type {ImportJob[]} */
let jobs = [];
/** @type {Worker | null} */
let worker = null;
let delArm = -9,
  CHART_V = 0;
/** @param {SongEntry} e */
const songKey = (e) => e.lib || e.slug || "demo";
// Best score per song and difficulty: a per-player convenience, so localStorage (losing it costs nothing but bragging rights).
/** @type {Record<string,{score:number,grade:string}>} */
let best = {};
let playKey = "demo",
  newBest = false;
try {
  best = JSON.parse(globalThis.localStorage?.lockstepBest || "{}");
} catch {}
/** @param {number} acc */
const grade = (acc) =>
  acc >= 0.95
    ? "S"
    : acc >= 0.85
      ? "A"
      : acc >= 0.7
        ? "B"
        : acc >= 0.5
          ? "C"
          : "D";
function saveBest() {
  const k = `${playKey}:${level}`,
    b = best[k];
  newBest = !b || run.score > b.score;
  if (newBest) {
    best[k] = {
      score: run.score,
      grade: grade(run.hits / Math.max(1, run.hits + run.misses)),
    };
    try {
      localStorage.lockstepBest = JSON.stringify(best);
    } catch {}
  }
}
// Refresh cached copies of the worker's modules first (an older server let browsers keep stale ones), then read the chart version.
Promise.all(
  [
    "analyze.js",
    "separator.js",
    "vendor/demucs-web/fft.js",
    "vendor/demucs-web/processor.js",
  ].map((f) => globalThis.fetch?.(f, { cache: "no-cache" }).catch(() => {})),
)
  .then(() => import("./analyze.js"))
  .then((m) => (CHART_V = m.CHART_V))
  .catch(() => {});
/** @type {Map<string,{ok:(result:import("./lib/worker").WorkerDone)=>void,no:(error:Error)=>void,onProgress?:(event:import("./lib/worker").WorkerProgress)=>void}>} */
const pending = new Map();
function releaseWorker() {
  if (worker && !pending.size && !job && !jobs.length) {
    worker.terminate();
    worker = null;
  }
}
/** @param {import("./lib/worker").WorkerRequest} msg @param {Transferable[]} [transfer] @param {(event:import("./lib/worker").WorkerProgress)=>void} [onProgress]
 * @returns {Promise<import("./lib/worker").WorkerDone>} */
function work(msg, transfer = [], onProgress) {
  // run a job on the separator worker; replies are routed by id
  if (!worker) {
    worker = new Worker("separator.js", { type: "module" });
    worker.onmessage = (
      /** @type {MessageEvent<import("./lib/worker").WorkerResponse>} */ {
        data: d,
      },
    ) => {
      const p = pending.get(d.id);
      if (!p) return;
      if (d.type === "progress") return p.onProgress?.(d);
      pending.delete(d.id);
      d.type === "done" ? p.ok(d) : p.no(new Error(d.message));
    };
    worker.onerror = (e) => {
      for (const p of pending.values())
        p.no(new Error(e.message || "separator failed to start"));
      pending.clear();
      worker?.terminate();
      worker = null;
    };
  }
  const activeWorker = worker;
  return new Promise(
    /** @param {(result:import("./lib/worker").WorkerDone)=>void} ok */ (
      ok,
      no,
    ) => {
      pending.set(msg.id, { ok, no, onProgress });
      activeWorker.postMessage(msg, transfer);
    },
  ).finally(releaseWorker);
}
let toast = { s: "", kind: "ok", at: -9 };
/** @param {string} s */
const say = (s, kind = "ok") => (toast = { s, kind, at: rt }); // kind: ok | info | err
const rebuild = () => songMenu.rebuild();
const songLibrary = createSongLibrary();
/** @param {Int16Array} a */
const i2f = (a, o = new Float32Array(a.length)) => {
  for (let i = 0; i < a.length; i++) o[i] = a[i] / 32767;
  return o;
};
/** @param {ArrayBuffer} b */
const hex = (b) =>
  [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
/** @type {WeakMap<SongEntry,Promise<PlayableSong>>} */
const songLoads = new WeakMap();
/** @param {SongEntry} e */
function loadSong(e) {
  if (e.song) return Promise.resolve(e.song);
  if (!songLoads.has(e))
    songLoads.set(
      e,
      decodeSong(e)
        .then((s) => {
          if (menu.entries[menu.selected] === e) {
            for (const other of menu.entries)
              if (other !== e) delete other.song;
            e.song = s;
          }
          return s;
        })
        .finally(() => songLoads.delete(e)),
    );
  return /** @type {Promise<PlayableSong>} */ (songLoads.get(e));
}
/** @param {SongEntry} e */
async function decodeSong(e) {
  if (e.lib) {
    if (!e.meta) throw new Error("Saved song is missing its chart.");
    const pcm = await songLibrary.loadAudio(e.lib);
    if (CHART_V && e.meta.v !== CHART_V) {
      // charted by an older analyze.js: re-chart from the saved stems (seconds, no re-separation)
      const stems = Object.fromEntries(
        e.meta.tracks.map((tr, i) => [
          tr.stem,
          { left: i2f(pcm[i][0]), right: i2f(pcm[i][1]) },
        ]),
      );
      e.meta = (
        await work(
          { id: "chart:" + e.lib, stems },
          Object.values(stems).flatMap((s) => [s.left.buffer, s.right.buffer]),
        )
      ).song;
      await songLibrary.updateChart(e.lib, e.meta);
    }
    return {
      ...e.meta,
      title: e.title,
      buffers: pcm.map(([l, r]) => {
        const b = ac.createBuffer(2, l.length, 44100);
        i2f(l, b.getChannelData(0));
        i2f(r, b.getChannelData(1));
        return b;
      }),
    };
  }
  if (!e.slug) return demoSong();
  const base = `songs/${e.slug}/`,
    res = await fetch(base + "song.json");
  if (!res.ok) throw new Error(`${base}song.json: ${res.status}`);
  /** @type {PlayableSong} */
  const s = await res.json();
  s.buffers = await Promise.all(
    s.tracks.map(async (tr) =>
      ac.decodeAudioData(await (await fetch(base + tr.stem)).arrayBuffer()),
    ),
  );
  return s;
}
async function start() {
  const e = menu.entries[menu.selected];
  if (!e || mode === "loading") return;
  if (e.add) return picker.click();
  clearTimeout(pvTimer);
  pvN++;
  stopPreview();
  if (e.find) {
    mode = "find";
    au.list.length ? preview() : auSearch();
    return;
  }
  if (!ac) initAudio();
  applyTheme(e);
  const menuImage = document.createElement("canvas");
  menuImage.width = cv.width;
  menuImage.height = cv.height;
  context2D(menuImage).drawImage(cv, 0, 0);
  mode = "loading";
  loadErr = "";
  playKey = songKey(e);
  try {
    song = await loadSong(e);
    reset(menuImage);
  } catch (err) {
    loadErr = `could not load: ${err instanceof Error ? err.message : String(err)}`;
    say(loadErr, "err");
    mode = "title";
    showSelected();
  }
}
function toTitle() {
  inSync = false;
  entrance = null;
  stopStems();
  audio?.stopSounds();
  audio?.restoreVolume();
  mode = "title";
  showSelected();
}
// The title screen's backdrop is the selected song: its chart scrolls behind the menu and its stems play quietly, looping from ~30 s in.
let pvT0 = 0,
  pvFrom = 0,
  pvN = 0;
/** @type {import("./lib/song").SongEntry | null} */
let pvFor = null;
/** @type {ReturnType<typeof setTimeout> | undefined} */
let pvTimer;
const stopPreview = () => previewPlayer?.stop();
function showSelected() {
  clearTimeout(pvTimer);
  const e = menu.entries[menu.selected],
    n = ++pvN;
  if (!e || e.add || e.find) return; // keep whatever is playing behind the add/find buttons
  applyTheme(e);
  pvTimer = setTimeout(async () => {
    try {
      const s = await loadSong(e);
      if (n !== pvN || mode !== "title") return;
      song = s;
      setGrid(song);
      tracks = buildTracks();
      pvFor = e;
      stopPreview();
      pvFrom = Math.min(30, song.duration * 0.3);
      if (!ac || !song.buffers) return;
      pvT0 = ac.currentTime + 0.05;
      previewPlayer.start(song.buffers, pvT0, {
        volume: 0.35,
        loop: { from: pvFrom, to: song.duration },
      });
    } catch (err) {
      if (n === pvN)
        say(
          `could not load ${e.title}: ${err instanceof Error ? err.message : String(err)}`,
          "err",
        );
    }
  }, 250);
}
const attract = () => {
  if (!previewPlayer?.playing) return rt % song.duration;
  const el = Math.max(
    0,
    ac.currentTime - pvT0 - (ac.outputLatency || ac.baseLatency || 0),
  );
  return pvFrom + (el % Math.max(1, song.duration - pvFrom));
};
/** @param {number} i */
const pick = (i) => {
  if (songMenu.select(i)) {
    delArm = -9;
    titleEntry = null;
    showSelected();
  }
};
/** @param {number} lv */
function setLevel(lv) {
  level = Math.max(0, Math.min(2, lv));
  if (globalThis.localStorage) localStorage.lockstepLevel = level;
  setGrid(song);
  tracks = buildTracks();
}
// Add songs: decode -> separate + chart in a worker (separator.js) -> store stems as 16-bit PCM in IndexedDB.
const AUDIO = /\.(mp3|wav|flac|m4a|aac|ogg|oga|opus|aiff?|webm)$/i;
/** @param {FileList | null | undefined} files */
function addFiles(files) {
  for (const f of files || [])
    if (f.type.startsWith("audio/") || AUDIO.test(f.name))
      jobs.push({
        title: f.name.replace(/\.[^.]+$/, ""),
        bytes: () => {
          checkImportSize(f.size);
          return f.arrayBuffer();
        },
      });
    else say(`${f.name} isn't an audio file`, "err");
  if (!job) nextJob();
}
async function nextJob() {
  const j = jobs.shift();
  if (!j) {
    job = null;
    releaseWorker();
    return;
  } // j: { title, bytes: () => Promise<ArrayBuffer>, url? (where it came from) }
  job = { title: j.title, phase: j.url ? "download" : "decode", progress: 0 };
  try {
    /** @type {ArrayBuffer | null} */
    let bytes = await j.bytes();
    checkImportSize(bytes.byteLength);
    job.phase = "decode";
    const id = hex(await crypto.subtle.digest("SHA-256", bytes)).slice(0, 16);
    const existing = menu.library.find((e) => e.lib === id);
    if (existing) {
      say(`${job.title} is already in your library`, "info");
      j.done?.(existing);
      return nextJob();
    }
    await importDuration(bytes);
    /** @type {AudioBuffer | null} */
    let ab = await new OfflineAudioContext(2, 1, 44100).decodeAudioData(bytes); // resamples to the model's 44.1 kHz
    checkImportDuration(ab.duration);
    const left = ab.getChannelData(0).slice(),
      right = ab.getChannelData(ab.numberOfChannels > 1 ? 1 : 0).slice();
    ab = null;
    bytes = null; // Release decoded/compressed input before waiting for separation.
    const { song: meta, pcm } = await work(
      { id, left, right },
      [left.buffer, right.buffer],
      (d) => {
        if (job) Object.assign(job, d);
      },
    );
    if (!pcm) throw new Error("Separator returned no audio.");
    job.phase = "save";
    await songLibrary.save(
      { id, title: job.title, url: j.url, song: meta, added: Date.now() },
      pcm,
    );
    navigator.storage?.persist?.(); // ask the browser not to evict the library under storage pressure
    const entry = { title: job.title, url: j.url, lib: id, meta };
    menu.library.push(entry);
    rebuild();
    say(`added ${job.title} · ${meta.bpm} BPM`);
    j.done?.(entry);
  } catch (err) {
    say(
      `${job.title}: ${err instanceof Error ? err.message : String(err)}`,
      "err",
    );
    j.failed?.(err);
  }
  nextJob();
}
/** @param {SongEntry} e */
async function removeSong(e) {
  if (!e.lib) return;
  try {
    await songLibrary.remove(e.lib);
  } catch (err) {
    say(
      `could not delete: ${err instanceof Error ? err.message : String(err)}`,
      "err",
    );
    return;
  }
  if (pvFor === e) {
    stopPreview();
    pvFor = null;
  }
  menu.library = menu.library.filter((x) => x !== e);
  rebuild();
  showSelected();
  say(`deleted ${e.title}`, "info");
}
const picker =
  typeof globalThis.document?.createElement === "function"
    ? Object.assign(document.createElement("input"), {
        type: "file",
        accept: "audio/*",
        multiple: true,
      })
    : { click() {}, onchange: null, files: null, value: "" };
picker.onchange = () => {
  addFiles(picker.files);
  picker.value = "";
};
addEventListener("dragover", (e) => e.preventDefault());
addEventListener("drop", (e) => {
  e.preventDefault();
  addFiles(e.dataTransfer?.files);
});
const libraryReady = songLibrary.available
  ? songLibrary
      .list()
      .then((rows) => {
        menu.library = rows
          .sort((a, b) => a.added - b.added)
          .map((r) => ({
            title: r.title,
            url: r.url,
            lib: r.id,
            meta: r.song,
          }));
        rebuild();
        if (menu.library.length && menu.entries[menu.selected] === DEMO)
          menu.selected = 0;
        showSelected();
      })
      .catch(() => {})
  : Promise.resolve();
fetch("songs/index.json")
  .then((r) => r.json())
  .then((list) => {
    menu.server = list;
    rebuild();
  })
  .catch(() => {}); // no songs/ yet, or file:// — fine
// Audius: search or browse trending, then queue a track like a dropped file. Tracks are used under the Audius
// Open Music License (OML), which licenses apps that play Audius audio; we credit the artist and link the track anyway.
const audius = createAudiusClient((url) => fetch(url));
const search = createTrackSearch(audius, () => preview());
const au = search.state;
/** @type {ReturnType<typeof setTimeout> | undefined} */
let auTimer;
const peek = globalThis.Audio ? new Audio() : null;
/** @type {ReturnType<typeof setTimeout> | undefined} */
let peekTimer;
function preview() {
  // stream the highlighted track from a little way in, once the selection settles; stops outside the finder
  clearTimeout(peekTimer);
  peek?.pause();
  const t = mode === "find" && au.list[au.sel];
  if (!t || !peek) return;
  peekTimer = setTimeout(() => {
    peek.src = audius.previewURL(t);
    peek.volume = 0.7;
    peek.play().catch(() => {});
  }, 400);
}
const auSearch = () => search.search();
/** @param {KeyInput} e */
function findKey(e) {
  const t = au.list[au.sel];
  if (e.key === "Escape") {
    mode = "title";
    showSelected();
  } else if (e.key === "ArrowUp" || e.key === "ArrowDown")
    au.sel = Math.max(
      0,
      Math.min(au.list.length - 1, au.sel + (e.key === "ArrowUp" ? -1 : 1)),
    );
  else if (e.key === "Enter" && t) {
    queueAudius(t);
    mode = "title";
    showSelected();
    say(`adding ${t.title}`, "info");
  } else if (e.key === "Backspace" || e.key.length === 1) {
    // typing: search after a short pause
    au.q =
      e.key === "Backspace" ? au.q.slice(0, -1) : (au.q + e.key).slice(0, 40);
    clearTimeout(auTimer);
    auTimer = setTimeout(auSearch, 300);
    clearTimeout(peekTimer);
    return peek?.pause(); // quiet while typing; the new results start their own preview
  } else return;
  e.preventDefault?.();
  preview();
}
// Share only Audius provenance; no audio or local filenames leave this device.
/** @param {SongEntry|undefined} e */
function shareLink(e) {
  const track = audiusURL(e?.url);
  if (!track) return null;
  const u = new URL(location.href);
  u.search = "";
  u.hash = "";
  u.searchParams.set("audius", track);
  return u.href;
}
/** @param {string} title @param {string} message */
const trackDialog = (title, message) =>
  createTrackDialog(document, title, message);
/** @param {SongEntry} e */
async function shareTrack(e) {
  const url = shareLink(e);
  if (!url) return;
  try {
    await navigator.clipboard.writeText(url);
    say("Track link copied");
  } catch {
    const { d } = trackDialog(
      "Share this track",
      "Copy this link and send it to a friend.",
    );
    const input = document.createElement("input");
    input.value = url;
    input.readOnly = true;
    input.setAttribute("aria-label", "Track link");
    d.append(input);
    input.focus();
    input.select();
  }
}
/** @param {import("./lib/song").AudiusTrack} t @param {ImportJob["done"]} [done] @param {ImportJob["failed"]} [failed] */
function queueAudius(t, done, failed) {
  jobs.push({
    title: `${t.title} — ${t.user.name}`,
    url: audiusURL(`https://audius.co${t.permalink}`) ?? undefined,
    done,
    failed,
    bytes: () => audius.download(t.id),
  });
  if (!job) nextJob();
}
/** @param {string} value */
const resolveSharedTrack = (value) => audius.resolve(value);
/** @param {string} value */
async function openSharedTrack(value) {
  const { d, status, close } = trackDialog(
    "Shared track",
    "Finding this track on Audius…",
  );
  try {
    const [t] = await Promise.all([resolveSharedTrack(value), libraryReady]);
    if (!d.open) return;
    status.textContent = `${t.title} — ${t.user.name}. Download and separate on this device, then play. First use also downloads the separation model.`;
    const play = document.createElement("button");
    play.textContent = "Download & play";
    d.insertBefore(play, close);
    play.focus();
    play.onclick = async () => {
      play.disabled = true;
      let timer;
      try {
        if (!ac) initAudio();
        await ac.resume();
        stopPreview();
        clearTimeout(pvTimer);
        pvN++;
        status.textContent = "Preparing track…";
        const url = audiusURL(`https://audius.co${t.permalink}`);
        let entry = menu.library.find((e) => audiusURL(e.url) === url);
        if (!entry) {
          timer = setInterval(() => {
            if (d.open)
              status.textContent = job
                ? `${job.title} · ${JOB_LABEL[job.phase] || job.phase} · ${Math.round((job.progress || 0) * 100)}%`
                : "Waiting to import…";
          }, 500);
          entry = await new Promise(
            /** @param {(entry:import("./lib/song").SongEntry)=>void} resolve */ (
              resolve,
              reject,
            ) => queueAudius(t, resolve, reject),
          );
        }
        if (!d.open) return; // Closing leaves the import running, but cancels automatic playback.
        menu.selected = menu.entries.indexOf(entry);
        d.close();
        if (!document.hidden) await start();
        else {
          showSelected();
          say("Shared track is ready — press Enter to play", "info");
        }
      } catch (err) {
        status.textContent = err instanceof Error ? err.message : String(err);
        play.disabled = false;
        play.textContent = "Try again";
      } finally {
        clearInterval(timer);
      }
    };
  } catch (err) {
    if (d.open)
      status.textContent = err instanceof Error ? err.message : String(err);
  }
}
if (globalThis.location) {
  const shared = new URL(location.href).searchParams.get("audius");
  if (shared) Promise.resolve().then(() => openSharedTrack(shared));
}
// The audio clock stays in the app; synthesis and graph ownership stay in the engine.
function initAudio() {
  ac = new AudioContext();
  audio = createAudioEngine(ac, {
    step: STEP,
    barLength: BARLEN,
    chords: CHORDS,
  });
  stemPlayer = createStemPlayer(ac, audio.output);
  previewPlayer = createStemPlayer(ac, audio.output);
}
// ---------- fx (x is in hit-plane world space: screen x = W/2 + x - camX) ----------
/** @param {number} x @param {number} y @param {string} color @param {number} n @param {number} power */
function burst(x, y, color, n, power, spread = 0) {
  for (let k = 0; k < n; k++) {
    const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.4,
      v = (120 + Math.random() * 260) * power;
    parts.push({
      x: x + (Math.random() - 0.5) * spread,
      y,
      vx: Math.cos(a) * v,
      vy: Math.sin(a) * v,
      born: rt,
      life: 0.4 + Math.random() * 0.5,
      color,
      size: 2 + Math.random() * 3,
    });
  }
  if (parts.length > 800) parts.splice(0, parts.length - 800);
}
/** @param {string} text @param {number} x @param {number} y @param {string} color @param {number} size */
const popup = (text, x, y, color, size, life = 0.7) =>
  pops.push({ text, x, y, color, size, life, born: rt });
// ---------- gameplay ----------
// Switching is always the player's call: A/D goes to the nearest non-silent track that way, including auto tracks (no wrap-around), or nowhere.
/** @param {GameTrack} tr @param {number} t */
const playable = (tr, t) => tr.notes.length && !locked(tr, t);
/** @param {number} dir */
const next = (dir) => nextTrack(tracks, run.currentTrack, dir);
/** @param {number} dir */
function move(dir) {
  const j = next(dir);
  if (j < 0) return;
  dash = { from: craftX(), to: trackX(j), at: rt };
  audio.playSwitch(ac.currentTime);
  tracks[run.currentTrack].live = false;
  run.currentTrack = j;
}
/** @param {number} delta */
const timingLabel = (delta) =>
  Math.abs(delta) < 0.0005
    ? "ON TIME"
    : `${Math.round(Math.abs(delta) * 1000)} ms ${delta < 0 ? "EARLY" : "LATE"}`;
/** @param {number} lane */
function tryHit(lane) {
  press[lane] = rt;
  const tr = tracks[run.currentTrack],
    t = now();
  const window = LEVELS[level].win;
  const n = findHittableNote(tr, lane, t, window, audioTime);
  if (!n) return; // shortcut: no penalty for stray presses
  const delta = audioTime(t) - audioTime(n.t);
  const { perfect, grooveGain } = recordHit(run, tr, n, delta, PERFECT);
  const x = trackX(run.currentTrack) + (lane - 1) * LW;
  changeGroove(grooveGain);
  if (song.synth && tr.kind)
    audio.playNote(tr.kind, lane, n.bar, ac.currentTime);
  burst(x, HIT_Y, tr.color, perfect ? 18 : 9, 1);
  laneHit[run.currentTrack * 3 + lane] = rt;
  popup(
    perfect ? "PERFECT" : timingLabel(delta),
    x,
    HIT_Y - 46,
    perfect ? "#fff" : tr.color,
    perfect ? 17 : 14,
    0.45,
  );
  const p = Math.floor(n.bar / 2);
  if (phraseNotes(tr, p).every((m) => m.hit)) {
    const cx = trackX(run.currentTrack);
    const bonus = recordCapture(run, tr, p, rt, CAPTURE_BARS);
    changeGroove(15);
    popup("CAPTURED", cx, HIT_Y - 130, tr.color, 38, 1.1);
    popup(`+${bonus}`, cx, HIT_Y - 90, "#fff", 20, 1.1);
    burst(cx, HIT_Y, tr.color, 70, 1.8, TW);
    rings.push({ x: cx, born: rt, color: tr.color });
    shake = 12;
    flash = { color: tr.color, born: rt };
    audio.playCapture(n.bar); // stay put: the arrows show where you can go next
  }
}
/** @param {import('./lib/input-actions').InputAction} action */
/** @param {InputAction} action */
function dispatchAction(action) {
  switch (action.type) {
    case "calibrate":
      offset = clampOffset(
        Math.round((offset + action.delta * 0.01) * 100) / 100,
      );
      offsetAt = rt;
      if (globalThis.localStorage) localStorage.lockstepOffset = offset;
      break;
    case "resume":
      if (pauseState?.deadline) pauseState.deadline = 0;
      else resumeCountdown();
      break;
    case "restart":
      mode === "pause" ? resumeGame("restart") : reset();
      break;
    case "title":
      mode === "pause" ? resumeGame("menu") : toTitle();
      break;
    case "difficulty":
      setLevel(level + action.delta);
      break;
    case "select":
      pick(
        (menu.selected + action.delta + menu.entries.length) %
          menu.entries.length,
      );
      break;
    case "start":
      start();
      break;
    case "theme":
      chooseTheme(action.useAsDefault);
      break;
    case "share":
      shareTrack(menu.entries[menu.selected]);
      break;
    case "files":
      picker.click();
      break;
    case "find":
      pick(menu.entries.indexOf(FIND));
      start();
      break;
    case "help":
      help = true;
      break;
    case "delete":
      if (!menu.entries[menu.selected].lib) break;
      if (rt - delArm < 2) {
        delArm = -9;
        removeSong(menu.entries[menu.selected]);
      } else {
        delArm = rt;
        const key = action.key === "x" ? "X" : action.key;
        say(
          touchEnabled
            ? `tap Delete song again to delete ${menu.entries[menu.selected].title}`
            : `press ${key} again to delete ${menu.entries[menu.selected].title}`,
          "info",
        );
      }
      break;
    case "hit":
      tryHit(action.lane);
      break;
    case "move":
      move(action.delta);
      break;
    case "pause":
      pauseGame();
      break;
  }
}
/** @param {KeyInput} e */
function handleKey(e) {
  const target = /** @type {Element | null | undefined} */ (e.target);
  if (target?.closest?.("input, select, textarea")) return;
  if ((e.key === " " || e.key === "Enter") && target?.closest?.("button"))
    return;
  if (e.metaKey || e.ctrlKey || document.querySelector?.("dialog[open]"))
    return;
  if (mode === "find") return findKey(e);
  if (e.repeat) return;
  const action = actionForKey(mode, e.key, e.shiftKey);
  if (action?.type === "calibrate") return dispatchAction(action);
  if (mode === "pause" || action?.type === "pause") e.preventDefault?.();
  if (mode === "title") {
    if (!ac) {
      initAudio();
      showSelected();
    }
    if (help) {
      help = false;
      return;
    }
  }
  if (action) dispatchAction(action);
}
addEventListener("keydown", handleKey);
// Native controls stay outside the canvas, so fingers never cover the timing line.
const touchDock = document.getElementById("touch-controls");
/** @type {Map<number,HTMLElement>} */
const touchPointers = new Map();
let touchEnabled = false,
  touchState = "";
/** @type {import("./lib/song").SongEntry[] | null} */
let touchCatalog = null;
function clearTouchPointers() {
  for (const button of touchPointers.values())
    button.classList.remove("pressed");
  touchPointers.clear();
}
/** @param {HTMLElement} button */
function bindTouchPad(button) {
  button.addEventListener("pointerdown", (e) => {
    if (mode !== "play" || e.button > 0 || touchPointers.has(e.pointerId))
      return;
    e.preventDefault();
    button.setPointerCapture(e.pointerId);
    touchPointers.set(e.pointerId, button);
    button.classList.add("pressed");
    handleKey({ key: button.dataset.pad || "" });
  });
  const release = (/** @type {PointerEvent} */ e) => {
    touchPointers.delete(e.pointerId);
    if (![...touchPointers.values()].includes(button))
      button.classList.remove("pressed");
  };
  for (const event of /** @type {const} */ ([
    "pointerup",
    "pointercancel",
    "lostpointercapture",
  ]))
    button.addEventListener(event, release);
  button.addEventListener("click", (e) => {
    if (e.detail === 0 && mode === "play")
      handleKey({ key: button.dataset.pad || "" });
  });
}
function updateTouchControls() {
  if (!touchEnabled || !touchDock) return;
  const songSelect = /** @type {HTMLSelectElement} */ (
    document.getElementById("touch-song")
  );
  if (touchCatalog !== menu.entries) {
    touchCatalog = menu.entries;
    songSelect.replaceChildren(
      ...menu.entries.map((e, i) => {
        const option = document.createElement("option");
        option.value = String(i);
        option.textContent = e.title;
        return option;
      }),
    );
  }
  const state = [
    mode,
    menu.selected,
    level,
    theme.name,
    offset,
    run.currentTrack,
    pauseState?.deadline,
    pauseState?.busy,
    help,
  ].join("|");
  if (state === touchState) return;
  const previousMode = touchState.split("|")[0];
  touchState = state;
  if (mode !== previousMode) {
    clearTouchPointers();
    requiredElement("touch-settings").hidden = true;
  }
  for (const group of /** @type {NodeListOf<HTMLElement>} */ (
    touchDock.querySelectorAll("[data-screen]")
  ))
    group.hidden = !(group.dataset.screen || "").split(" ").includes(mode);
  songSelect.value = String(menu.selected);
  /** @type {HTMLSelectElement} */ (
    document.getElementById("touch-level")
  ).value = String(level);
  requiredElement("touch-theme").textContent = `Theme: ${theme.name}`;
  /** @type {HTMLButtonElement} */ (
    document.getElementById("touch-share")
  ).disabled = !audiusURL(menu.entries[menu.selected]?.url);
  /** @type {HTMLButtonElement} */ (
    document.getElementById("touch-delete")
  ).disabled = mode !== "title" || !menu.entries[menu.selected]?.lib;
  /** @type {HTMLButtonElement} */ (
    document.getElementById("touch-default")
  ).disabled = mode !== "title";
  requiredElement("touch-offset").textContent =
    `Audio offset: ${Math.round(offset * 1000)} ms`;
  /** @type {HTMLButtonElement} */ (
    document.getElementById("touch-resume")
  ).textContent = pauseState?.deadline ? "Cancel countdown" : "Resume";
  /** @type {HTMLButtonElement} */ (
    document.getElementById("touch-resume")
  ).disabled = !!pauseState?.busy;
  touchDock.style.setProperty(
    "--track-color",
    tracks[run.currentTrack]?.color || "#4cc9f0",
  );
}
if (touchDock?.querySelectorAll) {
  const coarse = matchMedia("(any-pointer: coarse)");
  const enable = () => {
    touchEnabled = coarse.matches;
    document.documentElement.classList.toggle("touch", touchEnabled);
    touchState = "";
    updateTouchControls();
  };
  coarse.addEventListener?.("change", enable);
  Promise.resolve().then(enable);
  for (const button of /** @type {NodeListOf<HTMLElement>} */ (
    touchDock.querySelectorAll("[data-pad]")
  ))
    bindTouchPad(button);
  for (const button of /** @type {NodeListOf<HTMLElement>} */ (
    touchDock.querySelectorAll("[data-key]")
  ))
    button.addEventListener("click", () => {
      handleKey({ key: button.dataset.key || "" });
      updateTouchControls();
    });
  for (const button of /** @type {NodeListOf<HTMLElement>} */ (
    touchDock.querySelectorAll("[data-settings]")
  ))
    button.addEventListener("click", () => {
      const panel = requiredElement("touch-settings");
      panel.hidden = !panel.hidden;
    });
  /** @type {HTMLButtonElement} */ (
    document.getElementById("touch-default")
  ).addEventListener("click", () => {
    if (mode === "title") {
      chooseTheme(true);
      updateTouchControls();
    }
  });
  /** @type {HTMLSelectElement} */ (
    document.getElementById("touch-song")
  ).addEventListener("change", (e) => {
    if (!ac) initAudio();
    pick(
      Number(
        /** @type {HTMLInputElement | HTMLSelectElement} */ (e.target).value,
      ),
    );
  });
  requiredElement("touch-level").addEventListener("change", (e) =>
    setLevel(
      Number(
        /** @type {HTMLInputElement | HTMLSelectElement} */ (e.target).value,
      ),
    ),
  );
  /** @type {HTMLInputElement} */ (
    document.getElementById("touch-search")
  ).addEventListener("input", (e) => {
    au.q = /** @type {HTMLInputElement | HTMLSelectElement} */ (
      e.target
    ).value.slice(0, 40);
    clearTimeout(auTimer);
    clearTimeout(peekTimer);
    peek?.pause();
    auTimer = setTimeout(auSearch, 300);
  });
  requiredElement("touch-find").addEventListener("submit", (e) => {
    e.preventDefault();
    /** @type {HTMLInputElement} */ (
      document.getElementById("touch-search")
    ).blur();
    handleKey({ key: "Enter" });
  });
  addEventListener("blur", clearTouchPointers);
  addEventListener("resize", () => {
    clearTouchPointers();
    if (
      touchEnabled &&
      mode === "play" &&
      matchMedia("(orientation: portrait)").matches
    )
      pauseGame();
  });
}
function pauseGame() {
  if (mode === "pause") {
    if (pauseState) pauseState.deadline = 0;
    return;
  }
  if (mode !== "play") return;
  const image = document.createElement("canvas");
  image.width = cv.width;
  image.height = cv.height;
  context2D(image).drawImage(cv, 0, 0);
  /** @type {PauseState} */
  const state = createPauseSession(ac, image, {
    now: () => performance.now() / 1000,
    hidden: () => document.hidden,
    current: () => pauseState === state,
  });
  pauseState = state;
  mode = "pause";
  state.ready = state.ready.catch((err) => {
    if (pauseState === state) {
      mode = "play";
      pauseState = null;
      say(
        `could not pause: ${err instanceof Error ? err.message : String(err)}`,
        "err",
      );
    }
  });
}
/** @param {"restart" | "menu" | null} [action] */
async function resumeGame(action = null) {
  const state = pauseState;
  if (!state || state.busy) return;
  try {
    const pausedFor = await state.resume();
    if (pausedFor === null) return;
    visualOffset += pausedFor;
    pauseState = null;
    mode = "play";
    if (action === "restart") reset();
    else if (action === "menu") toTitle();
  } catch (err) {
    say(
      `could not resume: ${err instanceof Error ? err.message : String(err)}`,
      "err",
    );
  }
}
function resumeCountdown() {
  pauseState?.countdown();
}
document.addEventListener?.("visibilitychange", () => {
  if (document.hidden) pauseGame();
});
function drawPause() {
  const state = pauseState;
  if (!state) return;
  g.setTransform(DPR, 0, 0, DPR, 0, 0);
  g.globalAlpha = 1;
  g.drawImage(state.image, 0, 0, W, H);
  g.fillStyle = "rgba(3,2,6,.82)";
  g.fillRect(0, 0, W, H);
  const remaining = state.deadline
    ? Math.max(0, state.deadline - performance.now() / 1000)
    : 0;
  text(
    state.deadline ? String(Math.ceil(remaining)) : "PAUSED",
    W / 2,
    245,
    `italic 900 64px ${SANS}`,
    "#fff",
  );
  text(
    fit(song.title, 640, `600 18px ${SANS}`),
    W / 2,
    290,
    `600 18px ${SANS}`,
    "#a6b6c8",
  );
  zones = [];
  if (!state.deadline && !state.busy) {
    /** @type {[string,string,()=>void][]} */ ([
      ["SPACE / ENTER", "Resume", resumeCountdown],
      ["R", "Restart", () => resumeGame("restart")],
      ["ESC", "Song selection", () => resumeGame("menu")],
    ]).forEach(([key, label, fn], i) => {
      const y = 325 + i * 54;
      box(220, y, 360, 44, 8, "rgba(255,255,255,.08)", "rgba(255,255,255,.2)");
      shortcut(key, label, W / 2, y + 28);
      zone(220, y, 360, 44, fn);
    });
  } else if (state.busy)
    text("Resuming audio…", W / 2, 370, `600 14px ${MONO}`, "#a6b6c8");
  else shortcut("SPACE", "cancel countdown", W / 2, 370);
  if (state.deadline && remaining <= 0 && !state.busy) resumeGame();
  drawToast();
}
/** @param {number} t */
function updateSync(t) {
  const active = tracks.filter((tr) => tr.notes.length);
  const complete = active.length > 0 && active.every((tr) => locked(tr, t));
  if (complete && !inSync) syncAt = rt;
  inSync = complete;
}
/** @param {number} t */
function logic(t) {
  const end = song.duration,
    upto = songTime(ac.currentTime - t0 + 0.1);
  for (const bt of beats) {
    if (bt >= 0) break;
    if (bt >= sched && bt < upto && bt >= -LEAD_IN)
      audio.playCountIn(audioTime(bt));
  } // count-in
  if (song.synth) {
    for (
      let s = Math.ceil(sched / (2 * STEP)) * 2 * STEP;
      s < upto && s < end;
      s += 2 * STEP
    )
      if (s >= 0) audio.playHiHat(audioTime(s));
    for (let b = Math.ceil(sched / BARLEN); b * BARLEN < upto && b < BARS; b++)
      if (b >= 0) audio.playPad(b, audioTime(b * BARLEN));
  }
  for (const [trackIndex, tr] of tracks.entries()) {
    if (song.synth)
      for (
        let k = noteIndex(tr.notes, sched);
        k < tr.notes.length && tr.notes[k].t < upto;
        k++
      ) {
        const n = tr.notes[k];
        if (auto(tr, n) && tr.kind)
          audio.playNote(tr.kind, n.lane, n.bar, audioTime(n.t));
      }
    const judgedAt = audioTime(t);
    while (tr.judged < tr.notes.length) {
      const n = tr.notes[tr.judged];
      if (!n.hit && !n.missed && judgedAt - audioTime(n.t) <= LEVELS[level].win)
        break;
      tr.judged++;
      if (n.hit || n.missed) continue;
      n.missed = true;
      if (tr === tracks[run.currentTrack] && !auto(tr, n)) {
        const penalty = recordMiss(run, tr);
        missAt = rt;
        shake = Math.max(shake, 3);
        popup(
          "MISS",
          trackX(run.currentTrack) + (n.lane - 1) * LW,
          HIT_Y - 40,
          "#ff3355",
          14,
          0.5,
        );
        changeGroove(penalty);
        if (mode === "failed") return;
      }
    }
    const volume = locked(tr, t)
      ? LIVE
      : tr === tracks[run.currentTrack]
        ? tr.live
          ? LIVE
          : CUE
        : GHOST;
    stemPlayer?.setLevel(trackIndex, volume);
  }
  updateSync(t);
  sched = upto;
  if (t > end + 1) {
    mode = "over";
    overAt = rt;
    saveBest();
  }
}
function frame() {
  updateTouchControls();
  const wall = performance.now() / 1000,
    fdt = Math.min(0.05, wall - last);
  last = wall;
  if (mode === "pause") {
    drawPause();
    requestAnimationFrame(frame);
    return;
  }
  rt = wall - visualOffset;
  const playing = mode === "play" || mode === "over" || mode === "failed",
    t = playing ? now() : attract(); // attract mode on title
  if (mode === "play") logic(t);
  const bi = idx(beats, t);
  phase =
    bi < 0 || bi >= beats.length - 1
      ? 0
      : (t - beats[bi]) / (beats[bi + 1] - beats[bi]);
  pulse = Math.exp(-phase * 5);
  camTo = playing
    ? trackX(run.currentTrack)
    : reducedMotion?.matches
      ? 0
      : Math.sin(rt * 0.4) * 200;
  camX = reducedMotion?.matches
    ? camTo
    : camX + (camTo - camX) * Math.min(1, fdt * 9);
  shake = Math.max(0, shake - fdt * 40);
  const energy = playing ? 0.3 + (run.groove / 100) * 0.7 : 1;
  const warp =
    (0.25 + pulse * 0.5 + (playing ? run.multiplier * 0.12 : 0)) * energy;
  for (const s of stars) {
    if (reducedMotion?.matches) break;
    s.z -= fdt * warp;
    if (s.z < 0.03) {
      s.x = Math.random() * 2 - 1;
      s.y = Math.random() * 2 - 1;
      s.z = 1;
    }
  }
  for (const p of parts) {
    p.x += p.vx * fdt;
    p.y += p.vy * fdt;
    p.vy += 700 * fdt;
    p.vx *= 0.98;
  }
  parts = parts.filter((p) => rt - p.born < p.life);
  pops = pops.filter((p) => rt - p.born < p.life);
  rings = rings.filter((r) => rt - r.born < 0.7);
  shown += (run.score - shown) * Math.min(1, fdt * 12);
  draw(t, playing);
  requestAnimationFrame(frame);
}
/** @type {ReturnType<typeof import("./theme-shaders.js").createThemeShader>} */
let themeShader = null;
let themeShaderRequested = false;
function prepareThemeShader() {
  if (themeShader)
    themeShader.select(
      Object.keys(THEMES).find((k) => THEMES[k] === theme) ?? "neon",
    );
  if (themeShaderRequested || !globalThis.WebGLRenderingContext) return;
  themeShaderRequested = true;
  import("./theme-shaders.js")
    .then((m) => {
      themeShader = m.createThemeShader();
      themeShader?.select(
        Object.keys(THEMES).find((k) => THEMES[k] === theme) ?? "neon",
      );
    })
    .catch(() => {});
}
// ---------- title screen: grouped song list (left), the selected song (right), toast, keys for this screen ----------
/** @type {{x:number,y:number,w:number,h:number,fn:()=>void}[]} */
let zones = [];
let help = false,
  listScroll = 0; // zones: clickable boxes from the last title frame
/** @param {number} x @param {number} y @param {number} w @param {number} h @param {()=>void} fn */
const zone = (x, y, w, h, fn) => zones.push({ x, y, w, h, fn });
/** @param {number} x @param {number} y @param {number} w @param {number} h @param {number} r @param {CanvasStyle|null} fill @param {CanvasStyle} [stroke] */
function box(x, y, w, h, r, fill, stroke) {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
  if (fill) {
    g.fillStyle = fill;
    g.fill();
  }
  if (stroke) {
    g.strokeStyle = stroke;
    g.lineWidth = 1;
    g.stroke();
  }
}
/** @param {string} s @param {string} font */
const tw = (s, font) => {
  g.font = font;
  return g.measureText(s).width || 0;
};
/** @param {string} s @param {number} w @param {string} font */
function fit(s, w, font) {
  if (tw(s, font) <= w) return s;
  while (s.length > 1 && tw(s + "…", font) > w) s = s.slice(0, -1);
  return s + "…";
}
/** @type {import("./lib/song").SongEntry | null} */
let titleEntry = null;
let titleStarted = 0;
/** @param {number} width @param {number} viewport @param {number} elapsed */
function titleOffset(width, viewport, elapsed, still = false) {
  const overflow = Math.max(0, width - viewport);
  if (!overflow) return 0;
  const age = Math.max(0, elapsed);
  // Reduced motion uses overlapping static pages instead of a moving marquee.
  if (still)
    return Math.min(
      overflow,
      (Math.floor(age / 3) % (Math.ceil(overflow / (viewport * 0.8)) + 1)) *
        viewport *
        0.8,
    );
  const hold = 1.25,
    travel = overflow / 28,
    phase = age % (2 * (hold + travel));
  if (phase < hold) return 0;
  if (phase < hold + travel) return (phase - hold) * 28;
  if (phase < 2 * hold + travel) return overflow;
  return overflow - (phase - 2 * hold - travel) * 28;
}
/** @param {string} s @param {number} x @param {number} y @param {number} w @param {string} font @param {string} color @param {SongEntry} entry */
function selectedTitle(s, x, y, w, font, color, entry) {
  if (titleEntry !== entry) {
    titleEntry = entry;
    titleStarted = rt;
  }
  const shift = titleOffset(
    tw(s, font),
    w,
    rt - titleStarted,
    reducedMotion?.matches,
  );
  g.save();
  g.beginPath();
  g.rect(x, y - 34, w, 42);
  g.clip();
  text(s, x - shift, y, font, color, "left");
  g.restore();
}
/** @param {string} s @param {number} x @param {number} y @param {number} w @param {number} lh @param {string} font @param {string} color */
function wrap(s, x, y, w, lh, font, color) {
  let line = "";
  for (const word of s.split(" ")) {
    if (line && tw(line + " " + word, font) > w) {
      text(line, x, y, font, color, "left");
      y += lh;
      line = word;
    } else line = line ? line + " " + word : word;
  }
  text(line, x, y, font, color, "left");
}
/** @param {string} k @param {number} x @param {number} y */
function keycap(k, x, y) {
  const f = `800 10px ${MONO}`,
    w = Math.max(18, tw(k, f) + 10);
  box(x, y - 12, w, 17, 4, "rgba(255,255,255,.08)", "rgba(255,255,255,.35)");
  text(k, x + w / 2, y, f, "#fff");
  return x + w + 6;
}
/** @param {string} k @param {string} label @param {number} x @param {number} y */
function shortcut(k, label, x, y, font = `700 14px ${MONO}`, color = "#fff") {
  const width =
    Math.max(18, tw(k, `800 10px ${MONO}`) + 10) + 6 + tw(label, font);
  text(label, keycap(k, x - width / 2, y), y, font, color, "left");
}
/** @param {number} s */
const mmss = (s) =>
  `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
/** @param {SongEntry} e */
function about(e) {
  // what the list and card can show without loading the song
  const [name, artist = ""] = e.title.split(" — ");
  return {
    name,
    artist,
    dur: e.lib
      ? e.meta?.duration
      : e === DEMO
        ? BARS * BARLEN
        : e.song?.duration,
    src: e.url
      ? e.url.replace("https://", "via ")
      : e.lib
        ? "your file · separated on this device"
        : e.slug
          ? `songs/${e.slug}`
          : "built in · synthesised live",
  };
}
/** @type {Record<string,string>} */
const JOB_LABEL = {
  queued: "queued",
  download: "downloading",
  decode: "reading",
  model: "getting model",
  separate: "separating",
  chart: "charting",
  save: "saving",
};
function drawTitle() {
  zones = [];
  if (mode === "find") return drawFind();
  const shade = g.createLinearGradient(0, 0, W, 0);
  shade.addColorStop(0, "rgba(3,2,6,.88)");
  shade.addColorStop(0.55, "rgba(3,2,6,.62)");
  shade.addColorStop(1, "rgba(3,2,6,.8)");
  g.fillStyle = shade;
  g.fillRect(0, 0, W, H);
  if (help) return drawHelp();
  text(
    "LOCKSTEP",
    32,
    78,
    `italic 900 ${54 + pulse * 3}px ${SANS}`,
    "#fff",
    "left",
    30,
  );
  text(
    "capture the groove, one track at a time",
    35,
    102,
    `500 14px ${SANS}`,
    `hsl(${hue},90%,78%)`,
    "left",
  );
  drawList();
  drawCard();
  drawToast();
  g.fillStyle = "rgba(0,0,0,.55)";
  g.fillRect(0, H - 34, W, 34);
  const e = menu.entries[menu.selected],
    y = H - 13;
  let x = 34;
  const hint = (/** @type {string} */ k, /** @type {string} */ s) => {
    x = keycap(k, x, y);
    text(s, x, y, `600 11px ${MONO}`, "rgba(255,255,255,.6)", "left");
    x += tw(s, `600 11px ${MONO}`) + 18;
  };
  hint("↑↓", "song");
  if (!e?.add && !e?.find) hint("←→", "difficulty");
  hint("ENTER", e?.add ? "pick files" : e?.find ? "search" : "play");
  if (e?.lib) hint("X", "delete");
  hint("?", "all controls");
  text(
    `offset ${Math.round(offset * 1000)} ms`,
    keycap("[ ]", W - 168, y),
    y,
    `600 11px ${MONO}`,
    "rgba(255,255,255,.45)",
    "left",
  );
}
const LIST = { x: 32, y: 128, w: 372, h: 350 };
function drawList() {
  /** @type {{hdr?:string,e?:import("./lib/song").SongEntry,j?:{title:string,phase:string,progress?:number},note?:string}[]} */
  const rows = [
    { hdr: "YOUR LIBRARY" },
    ...menu.library.map((e) => ({ e })),
    ...(job ? [{ j: job }] : []),
    ...jobs.map((q) => ({ j: { title: q.title, phase: "queued" } })),
  ];
  if (!menu.library.length && !job)
    rows.push({ note: "empty for now: add a file or find one on Audius" });
  rows.push(
    { hdr: "BUILT IN" },
    { e: DEMO },
    ...menu.server.map((e) => ({ e })),
  );
  let total = 0;
  const laidOut = rows.map((r) => {
    const y = total,
      h = r.hdr ? 28 : r.j ? 40 : 32;
    total += h;
    return { ...r, y, h };
  });
  const at = laidOut.find((r) => r.e === menu.entries[menu.selected]);
  if (at)
    listScroll +=
      (Math.max(0, Math.min(total - LIST.h, at.y + at.h / 2 - LIST.h / 2)) -
        listScroll) *
      0.3;
  g.save();
  g.beginPath();
  g.rect(LIST.x - 4, LIST.y, LIST.w + 8, LIST.h);
  g.clip();
  for (const r of laidOut) {
    const y = LIST.y + r.y - listScroll,
      L = LIST.x,
      R = LIST.x + LIST.w;
    if (y + r.h < LIST.y || y > LIST.y + LIST.h) continue;
    if (r.hdr)
      text(
        r.hdr,
        L,
        y + 20,
        `800 10px ${MONO}`,
        "rgba(255,255,255,.4)",
        "left",
      );
    else if (r.note)
      text(
        r.note,
        L + 14,
        y + 21,
        `500 13px ${SANS}`,
        "rgba(255,255,255,.35)",
        "left",
      );
    else if (r.j) {
      // a song still being separated: its own row, with progress
      const p = r.j.progress || 0,
        label =
          JOB_LABEL[r.j.phase] +
          (r.j.phase === "separate" || r.j.phase === "model"
            ? ` ${Math.round(p * 100)}%`
            : "");
      text(
        fit(r.j.title, 230, `500 14px ${SANS}`),
        L + 14,
        y + 19,
        `500 14px ${SANS}`,
        "rgba(255,255,255,.55)",
        "left",
      );
      text(
        label,
        R - 10,
        y + 19,
        `500 11px ${MONO}`,
        "rgba(255,255,255,.45)",
        "right",
      );
      box(L + 14, y + 28, R - L - 24, 3, 1.5, "rgba(255,255,255,.12)");
      if (r.j.phase !== "queued")
        box(L + 14, y + 28, (R - L - 24) * p, 3, 1.5, `hsl(${hue},90%,72%)`);
    } else if (r.e) {
      const e = r.e,
        on = e === menu.entries[menu.selected],
        a = about(e),
        f = `${on ? 800 : 500} 15px ${SANS}`,
        mf = `500 11px ${MONO}`;
      if (on) {
        box(L, y + 2, R - L, r.h - 4, 7, "rgba(255,255,255,.1)");
        g.fillStyle = `hsl(${hue},90%,75%)`;
        g.fillRect(L, y + 7, 3, r.h - 14);
      }
      const nm = fit(a.name, 250, f),
        ax = L + 14 + tw(nm, f) + 8;
      if (on) selectedTitle(a.name, L + 14, y + 21, 250, f, "#fff", e);
      else text(nm, L + 14, y + 21, f, "rgba(255,255,255,.62)", "left");
      if (a.artist && R - 54 - ax > 30)
        text(
          fit(a.artist, R - 54 - ax, mf),
          ax,
          y + 21,
          mf,
          "rgba(255,255,255,.4)",
          "left",
        );
      if (a.dur)
        text(mmss(a.dur), R - 10, y + 21, mf, "rgba(255,255,255,.4)", "right");
      const i = menu.entries.indexOf(e);
      zone(
        L,
        Math.max(LIST.y, y),
        R - L,
        Math.min(y + r.h, LIST.y + LIST.h) - Math.max(LIST.y, y),
        () => (on ? start() : pick(i)),
      );
    }
  }
  g.restore();
  /** @type {[import("./lib/song").SongEntry,string,string][]} */ ([
    [ADD, "O", "Add a file"],
    [FIND, "F", "Find on Audius"],
  ]).forEach(([e, k, s], n) => {
    const w = (LIST.w - 10) / 2,
      x = LIST.x + n * (w + 10),
      y = LIST.y + LIST.h + 14,
      on = menu.entries[menu.selected] === e;
    box(
      x,
      y,
      w,
      36,
      8,
      on ? "rgba(255,255,255,.14)" : "rgba(255,255,255,.03)",
      on ? `hsl(${hue},90%,75%)` : "rgba(255,255,255,.22)",
    );
    text(
      s,
      keycap(k, x + 12, y + 23),
      y + 23,
      `${on ? 800 : 600} 14px ${SANS}`,
      on ? "#fff" : "rgba(255,255,255,.8)",
      "left",
    );
    zone(x, y, w, 36, () => {
      pick(menu.entries.indexOf(e));
      start();
    });
  });
}
// Artwork uses the full chart, so changing difficulty never changes a song's sleeve.
/** @type {WeakMap<SongChart|PlayableSong,number[][]>} */
const sleeveCache = new WeakMap();
const demoSleeve = demoSong();
/** @param {SongChart|PlayableSong|null|undefined} source */
function sleeveBands(source) {
  if (!source) return [];
  if (!sleeveCache.has(source))
    sleeveCache.set(
      source,
      source.tracks.map((tr) => {
        const bins = new Array(48).fill(0);
        for (const [t, lane] of tr.notes) {
          const i = Math.max(
            0,
            Math.min(47, Math.floor((t / Math.max(1, source.duration)) * 48)),
          );
          bins[i] += 1 + lane * 0.25;
        }
        const peak = Math.max(1, ...bins);
        return bins.map((n) => n / peak);
      }),
    );
  return sleeveCache.get(source) || [];
}
/** @param {SongChart|PlayableSong|null|undefined} source @param {number} x @param {number} y @param {number} w @param {number} h @param {boolean} active */
function drawSleeve(source, x, y, w, h, active) {
  const bands = sleeveBands(source),
    beat = active && !reducedMotion?.matches ? pulse : 0;
  g.save();
  g.beginPath();
  g.rect(x, y, w, h);
  g.clip();
  g.fillStyle = isPaper()
    ? "#d9ccb0"
    : isCircuit()
      ? "#111329"
      : isLiquid()
        ? "#05232d"
        : "#090f19";
  g.fillRect(x, y, w, h);
  const cx = x + w * 0.64,
    cy = y + h * 0.51;
  g.strokeStyle = "#243345";
  g.lineWidth = 1;
  for (let k = 0; k < (isLiquid() || isPaper() || isCircuit() ? 0 : 7); k++) {
    g.beginPath();
    g.moveTo(x, y + k * 26);
    g.lineTo(x + w, y + k * 26 - 65);
    g.stroke();
  }
  bands.forEach((bins, i) => {
    g.strokeStyle = theme.colors[i];
    g.lineWidth = 2.5;
    if (isPaper() || isCircuit()) {
      g.globalAlpha = 1;
      bins.forEach((value, k) => {
        const px = x + w * 0.39 + (k / bins.length) * w * 0.57,
          base = y + 32 + i * 24;
        g.fillStyle = theme.colors[i];
        g.strokeStyle = isPaper() ? "#39404a" : theme.colors[i];
        g.lineWidth = 1;
        if (isPaper()) {
          const h = 3 + value * 20;
          g.beginPath();
          g.moveTo(px, base);
          g.lineTo(px, base - h);
          g.lineTo(px + 3, base - h - 2);
          g.lineTo(px + 6, base - h);
          g.lineTo(px + 6, base);
          g.closePath();
          g.fill();
          g.stroke();
        } else {
          const h = 3 + value * 16;
          g.beginPath();
          g.moveTo(px, base);
          g.lineTo(px, base - h);
          g.lineTo(px + 3, base - h);
          g.stroke();
        }
      });
    } else if (isLiquid()) {
      g.globalAlpha = 0.8;
      g.beginPath();
      bins.forEach((value, k) => {
        const px = x + w * 0.38 + (k / (bins.length - 1)) * w * 0.58;
        const py =
          y + 28 + i * 24 + Math.sin(k * 0.2 + i) * 8 - value * (14 + beat * 2);
        if (!k) g.moveTo(px, py);
        else g.lineTo(px, py);
      });
      g.stroke();
    } else
      bins.forEach((value, k) => {
        const angle = (k / bins.length) * Math.PI * 2 - Math.PI / 2,
          r = 19 + i * 12;
        const outer = r + 2 + value * (9 + beat * 2);
        g.globalAlpha = 0.15 + value * 0.7;
        g.beginPath();
        g.moveTo(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r);
        g.lineTo(cx + Math.cos(angle) * outer, cy + Math.sin(angle) * outer);
        g.stroke();
      });
    g.globalAlpha = 1;
    text(
      source?.tracks[i].name + (bins.some((n) => n > 0) ? "" : " · SILENT"),
      x + 12,
      y + 22 + i * 17,
      `700 9px ${MONO}`,
      isPaper() ? "#28303a" : theme.colors[i],
      "left",
    );
  });
  g.globalAlpha = 1;
  g.fillStyle = "#e5faff";
  g.beginPath();
  g.arc(cx, cy, 3 + beat, 0, Math.PI * 2);
  g.fill();
  text(
    source ? "FOUR TRACKS / ONE GROOVE" : "LOADING THE GROOVE",
    x + 12,
    y + h - 10,
    `600 8px ${MONO}`,
    isPaper() ? "#39404a" : "#8e9bab",
    "left",
  );
  g.restore();
}
const CARD = { x: 428, y: 128, w: 340, h: 400 };
function drawCard() {
  const { x, y, w, h } = CARD,
    e = menu.entries[menu.selected],
    L = x + 22,
    R = x + w - 22;
  box(x, y, w, h, 14, "rgba(20,12,34,.8)", "rgba(255,255,255,.12)");
  if (!e) return;
  const cta = (/** @type {string} */ label, /** @type {()=>void} */ fn) => {
    const by = y + h - 66,
      gr = g.createLinearGradient(L, 0, R, 0);
    gr.addColorStop(0, "#ff4d6d");
    gr.addColorStop(1, `hsl(${hue},90%,72%)`);
    g.shadowColor = `hsl(${hue},90%,70%)`;
    g.shadowBlur = 16 + pulse * 12;
    box(L, by, R - L, 44, 10, gr);
    g.shadowBlur = 0;
    if (mode === "loading")
      text(label, (L + R) / 2, by + 29, `italic 900 19px ${SANS}`, "#fff");
    else
      shortcut("ENTER", label, (L + R) / 2, by + 29, `italic 900 19px ${SANS}`);
    zone(L, by, R - L, 44, fn);
  };
  if (e.add || e.find) {
    text(e.title, L, y + 46, `900 26px ${SANS}`, "#fff", "left");
    wrap(
      e.add
        ? "Drop audio files anywhere on this page, or press Enter to pick some. Each song is split into drums, bass, vocals and harmony right here on your device, then charted. Nothing is uploaded."
        : "Browse trending tracks or search Audius for free music from independent artists. Previews play as you browse, and Enter adds a track to your library.",
      L,
      y + 84,
      R - L,
      22,
      `500 14px ${SANS}`,
      "rgba(255,255,255,.72)",
    );
    text(
      e.add
        ? "MP3 · WAV · FLAC · M4A · OGG and more"
        : "Audius Open Music License · artists credited",
      L,
      y + 262,
      `600 10px ${MONO}`,
      "rgba(255,255,255,.4)",
      "left",
    );
    return cta(e.add ? "PICK FILES" : "SEARCH", start);
  }
  const a = about(e),
    ready = pvFor === e && mode !== "loading";
  const source =
    e === DEMO ? demoSleeve : e.song || e.meta || (ready ? song : null);
  drawSleeve(source, L, y + 14, R - L, 140, ready && ac?.state === "running");
  selectedTitle(a.name, L, y + 190, R - L, `900 30px ${SANS}`, "#fff", e);
  text(
    fit(a.artist || "FOUR-TRACK SESSION", R - L, `600 12px ${SANS}`),
    L,
    y + 211,
    `600 12px ${SANS}`,
    "#a6b6c8",
    "left",
  );
  const bpm = source?.bpm || (e === DEMO ? BPM : null),
    duration = a.dur || source?.duration;
  const count = ready ? tracks.reduce((n, tr) => n + tr.notes.length, 0) : null;
  text(
    `${bpm ? Math.round(bpm) : "—"} BPM   /   ${duration ? mmss(duration) : "—"}   /   ${count ?? "—"} NOTES`,
    L,
    y + 236,
    `600 10px ${MONO}`,
    "#a6b6c8",
    "left",
  );
  // Keep controls outside the signature artwork, using the same keycaps as the menu footer.
  const toolbarY = y - 38;
  box(L, toolbarY, 212, 28, 8, "rgba(3,12,20,.85)", "#627f8f");
  const themeX = keycap("T", L + 8, toolbarY + 18);
  text(
    fit(`Theme: ${theme.name}`, L + 204 - themeX, `700 10px ${SANS}`),
    themeX,
    toolbarY + 18,
    `700 10px ${SANS}`,
    "#fff",
    "left",
  );
  zone(L, toolbarY, 212, 28, () => chooseTheme());
  if (audiusURL(e.url)) {
    box(R - 76, toolbarY, 76, 28, 8, "rgba(3,12,20,.85)", "#627f8f");
    text(
      "Share",
      keycap("C", R - 68, toolbarY + 18),
      toolbarY + 18,
      `700 10px ${SANS}`,
      "#fff",
      "left",
    );
    zone(R - 76, toolbarY, 76, 28, () => shareTrack(e));
  }
  const defaultY = y + h + 6,
    defaultX = keycap("SHIFT T", L, defaultY + 14);
  text(
    fit(
      `Set default · ${THEMES[themeSettings.default].name}`,
      R - defaultX,
      `600 10px ${MONO}`,
    ),
    defaultX,
    defaultY + 14,
    `600 10px ${MONO}`,
    "#a6b6c8",
    "left",
  );
  zone(L, defaultY, R - L, 22, () => chooseTheme(true));
  const dy = y + 252,
    sw = (R - L) / 3;
  box(L, dy, R - L, 30, 8, null, "rgba(255,255,255,.22)");
  LEVELS.forEach((lv, i) => {
    const on = i === level;
    if (on) box(L + i * sw + 2, dy + 2, sw - 4, 26, 6, "#fff");
    text(
      lv.name,
      L + i * sw + sw / 2,
      dy + 20,
      `800 11px ${MONO}`,
      on ? "#12081f" : "rgba(255,255,255,.5)",
    );
    zone(L + i * sw, dy, sw, 30, () => setLevel(i));
  });
  const b = best[`${songKey(e)}:${level}`];
  text(
    `BEST · ${LEVELS[level].name}`,
    L,
    dy + 60,
    `600 11px ${MONO}`,
    "rgba(255,255,255,.5)",
    "left",
  );
  text(
    b ? `${b.grade} · ${b.score.toLocaleString()}` : "not played yet",
    R,
    dy + 60,
    `700 12px ${MONO}`,
    b ? "#fff" : "rgba(255,255,255,.4)",
    "right",
  );
  text(
    fit(a.src, R - L, `500 9px ${MONO}`),
    L,
    y + 326,
    `500 9px ${MONO}`,
    "#8e9bab",
    "left",
  );
  cta(mode === "loading" ? "LOADING…" : "PLAY", start);
}
function drawToast() {
  const age = rt - toast.at;
  if (age > 4) return;
  const c = { ok: "61,220,151", info: "201,168,255", err: "255,68,102" }[
      toast.kind
    ],
    f = `700 13px ${SANS}`,
    s = fit(toast.s, 380, f),
    w = tw(s, f) + 28,
    x = W - 32 - w,
    y = 44;
  g.globalAlpha = Math.min(1, age * 8, (4 - age) * 2);
  box(x, y, w, 32, 8, `rgba(${c},.16)`, `rgba(${c},.6)`);
  text(s, x + 14, y + 21, f, "#fff", "left");
  g.globalAlpha = 1;
}
function drawHelp() {
  g.fillStyle = "rgba(3,2,6,.7)";
  g.fillRect(0, 0, W, H);
  text("CONTROLS", W / 2, 84, `italic 900 34px ${SANS}`, "#fff", "center", 20);
  [
    ["MENU"],
    ["↑ ↓", "choose a song"],
    ["← →", "difficulty"],
    ["ENTER", "play  (or click the song twice)"],
    ["O", "add audio files, or drop them anywhere"],
    ["F", "find a song on Audius"],
    ["X  X", "delete a song from your library"],
    ["[  ]", "audio offset: raise if notes feel early, lower if late"],
    ["T / SHIFT T", "change theme / set current theme as default"],
    ["C", "copy an Audius track link"],
    ["PLAYING"],
    ["J  K  L", "hit the left, middle and right lane"],
    ["A  D", "switch track, including AUTO (or ← →)"],
    ["SPACE / ESC", "pause · resume, restart or return to menu"],
    ["SPACE", "play again, on the results screen"],
  ].forEach(([k, s], i) => {
    const y = 118 + i * 25 + (i > 7 ? 10 : 0);
    if (!s) text(k, 150, y, `800 10px ${MONO}`, `hsl(${hue},90%,78%)`, "left");
    else {
      keycap(k, 290 - Math.max(18, tw(k, `800 10px ${MONO}`) + 10), y);
      text(s, 312, y, `500 14px ${SANS}`, "rgba(255,255,255,.75)", "left");
    }
  });
  text(
    "press any key to close",
    W / 2,
    540,
    `700 13px ${SANS}`,
    "rgba(255,255,255,.5)",
  );
  zones = [{ x: 0, y: 0, w: W, h: H, fn: () => (help = false) }];
}
// Mouse: click a song to select it, again to play; the buttons, difficulty switch and PLAY all click too.
/** @param {MouseEvent} e @returns {[number,number]} */
const at = (e) => {
  const r = cv.getBoundingClientRect();
  return [
    ((e.clientX - r.left) * W) / r.width,
    ((e.clientY - r.top) * H) / r.height,
  ];
};
/** @param {number} x @param {number} y */
const zoneAt = (x, y) =>
  mode === "title" || mode === "pause" || mode === "failed"
    ? zones.findLast(
        (z) => x >= z.x && x < z.x + z.w && y >= z.y && y < z.y + z.h,
      )
    : null;
cv.addEventListener?.("click", (e) => {
  if (mode !== "title" && mode !== "pause" && mode !== "failed") return;
  if (!ac) {
    initAudio();
    showSelected();
  }
  zoneAt(...at(e))?.fn();
});
cv.addEventListener?.(
  "mousemove",
  (e) => (cv.style.cursor = zoneAt(...at(e)) ? "pointer" : "default"),
);
function drawFind() {
  g.fillStyle = "rgba(3,2,6,.72)";
  g.fillRect(0, 0, W, H);
  text(
    "FIND ON AUDIUS",
    W / 2,
    100,
    `italic 900 44px ${SANS}`,
    "#fff",
    "center",
    24,
  );
  text(
    `${au.q}${Math.floor(rt * 2) % 2 ? "▍" : " "}`,
    W / 2,
    150,
    `700 22px ${MONO}`,
    `hsl(${hue},90%,78%)`,
  );
  text(
    au.busy
      ? "searching…"
      : au.err
        ? au.err
        : !au.list.length
          ? "nothing playable found (tracks up to 10 min)"
          : au.q.trim()
            ? "type to search"
            : "trending now · type to search",
    W / 2,
    178,
    `600 12px ${MONO}`,
    au.err ? "#ff4466" : "rgba(255,255,255,.5)",
  );
  const top = Math.max(0, Math.min(au.sel - 4, au.list.length - 9)),
    clip = (/** @type {string} */ t, /** @type {number} */ n) =>
      t.length > n ? t.slice(0, n - 1) + "…" : t;
  au.list.slice(top, top + 9).forEach((t, k) => {
    const on = top + k === au.sel,
      y = 220 + k * 30;
    text(
      `${on ? (peek && !peek.paused ? "♪  " : "▶  ") : ""}${clip(t.title, 38)}`,
      110,
      y,
      `${on ? 800 : 500} ${on ? 18 : 15}px ${SANS}`,
      on ? "#fff" : "rgba(255,255,255,.55)",
      "left",
      on ? 12 : 0,
    );
    text(
      `${clip(t.user.name, 22)}  ${Math.floor(t.duration / 60)}:${String(t.duration % 60).padStart(2, "0")}`,
      690,
      y,
      `500 13px ${MONO}`,
      on ? `hsl(${hue},90%,80%)` : "rgba(255,255,255,.4)",
      "right",
    );
  });
  shortcut("↑ ↓", "choose / preview", 200, 520);
  shortcut("ENTER", "add to library", 450, 520);
  shortcut("ESC", "back", 650, 520);
  text(
    "Music streamed from audius.co by its artists, under the Audius Open Music License",
    W / 2,
    560,
    `500 11px ${MONO}`,
    "rgba(255,255,255,.45)",
  );
}
function drawFailure() {
  g.globalAlpha = 1;
  g.fillStyle = "rgba(3,2,6,.9)";
  g.fillRect(0, 0, W, H);
  text("GROOVE LOST", W / 2, 215, `italic 900 54px ${SANS}`, "#ff4d6d");
  text(
    fit(song.title, 660, `700 22px ${SANS}`),
    W / 2,
    265,
    `700 22px ${SANS}`,
    "#fff",
  );
  text(
    `${Math.min(100, Math.floor((failedAt / song.duration) * 100))}% COMPLETE · ${run.score.toLocaleString()} POINTS`,
    W / 2,
    310,
    `600 15px ${MONO}`,
    "#a6b6c8",
  );
  text(
    "Hits restore groove. Captures give you a bigger recovery.",
    W / 2,
    355,
    `500 15px ${SANS}`,
    "#a6b6c8",
  );
  zones = [];
  /** @type {[string,string,()=>void][]} */ ([
    ["SPACE / ENTER", "Retry", reset],
    ["ESC", "Song selection", toTitle],
  ]).forEach(([key, label, action], i) => {
    const y = 395 + i * 54;
    box(220, y, 360, 44, 8, "rgba(255,255,255,.08)", "rgba(255,255,255,.2)");
    shortcut(key, label, W / 2, y + 28);
    zone(220, y, 360, 44, () => action());
  });
}
function drawResults() {
  const acc = run.hits / Math.max(1, run.hits + run.misses),
    gr = grade(acc),
    record = best[`${playKey}:${level}`];
  const [title, artist = ""] = song.title.split(" — ");
  g.globalAlpha = 1;
  g.fillStyle = "rgba(3,2,6,.94)";
  g.fillRect(0, 0, W, H);
  text(
    `SESSION COMPLETE / ${LEVELS[level].name}`,
    48,
    50,
    `700 11px ${MONO}`,
    "#a6b6c8",
    "left",
  );
  text(
    fit(title, 704, `900 32px ${SANS}`),
    48,
    91,
    `900 32px ${SANS}`,
    "#fff",
    "left",
  );
  if (artist)
    text(
      fit(artist, 704, `600 14px ${SANS}`),
      48,
      115,
      `600 14px ${SANS}`,
      "#a6b6c8",
      "left",
    );
  drawSleeve(song, 48, 136, 310, 190, false);
  text(
    gr,
    450,
    265,
    `italic 900 124px ${SANS}`,
    `hsl(${hue},95%,75%)`,
    "center",
    18,
  );
  text("SCORE", 752, 165, `700 10px ${MONO}`, "#a6b6c8", "right");
  text(
    run.score.toLocaleString(),
    752,
    207,
    `700 34px ${MONO}`,
    "#fff",
    "right",
  );
  text(
    `${(acc * 100).toFixed(1)}% ACCURACY`,
    752,
    241,
    `600 12px ${MONO}`,
    "#a6b6c8",
    "right",
  );
  text(
    `${run.captures} CAPTURES`,
    752,
    264,
    `600 12px ${MONO}`,
    "#a6b6c8",
    "right",
  );
  const totalTiming = tracks.reduce((sum, tr) => sum + tr.timing, 0);
  text(
    run.hits ? `AVG ${timingLabel(totalTiming / run.hits)}` : "AVG TIMING —",
    752,
    286,
    `600 11px ${MONO}`,
    "#a6b6c8",
    "right",
  );
  text(
    newBest
      ? "NEW PERSONAL BEST"
      : `BEST  ${record ? record.score.toLocaleString() : "—"}`,
    752,
    308,
    `800 13px ${MONO}`,
    newBest ? "#3ddc97" : "#a6b6c8",
    "right",
  );
  text("INSTRUMENT", 64, 365, `700 10px ${MONO}`, "#a6b6c8", "left");
  text("HITS / MISSES", 380, 365, `700 10px ${MONO}`, "#a6b6c8", "right");
  text("ACCURACY", 500, 365, `700 10px ${MONO}`, "#a6b6c8", "right");
  text("AVG TIMING", 640, 365, `700 10px ${MONO}`, "#a6b6c8", "right");
  text("CAPTURES", 736, 365, `700 10px ${MONO}`, "#a6b6c8", "right");
  tracks.forEach((tr, i) => {
    const y = 393 + i * 29,
      attempts = tr.hits + tr.misses;
    if (i % 2 === 0) {
      g.fillStyle = "rgba(255,255,255,.035)";
      g.fillRect(48, y - 19, 704, 28);
    }
    text(tr.name, 64, y, `800 12px ${SANS}`, tr.color, "left");
    text(
      `${tr.hits} / ${tr.misses}`,
      380,
      y,
      `600 12px ${MONO}`,
      "#fff",
      "right",
    );
    text(
      attempts
        ? `${((tr.hits / attempts) * 100).toFixed(1)}%`
        : tr.notes.length
          ? "UNPLAYED"
          : "SILENT",
      500,
      y,
      `600 11px ${MONO}`,
      "#a6b6c8",
      "right",
    );
    text(
      tr.hits ? timingLabel(tr.timing / tr.hits) : "—",
      640,
      y,
      `600 10px ${MONO}`,
      "#a6b6c8",
      "right",
    );
    text(String(tr.caps), 736, y, `600 12px ${MONO}`, "#fff", "right");
  });
  text(
    "Manual hits and misses only · AUTO notes excluded",
    48,
    512,
    `500 10px ${MONO}`,
    "#a6b6c8",
    "left",
  );
  shortcut("SPACE", "play again", 260, 558);
  shortcut("ESC", "song selection", 540, 558);
}

const scene = createSceneRenderer(
  g,
  () => ({
    DPR,
    F,
    H,
    HIT_Y,
    HZ,
    LEVELS,
    LOOK,
    LW,
    MONO,
    SANS,
    THEMES,
    TW,
    W,
    auto,
    bar,
    barF,
    bars,
    beats,
    bendX,
    bendY,
    camTo,
    camX,
    captureRemaining,
    dash,
    drawFailure,
    drawResults,
    drawTitle,
    entrance,
    flash,
    gridDown,
    hue,
    idx,
    inSync,
    isCircuit,
    isLiquid,
    isPaper,
    laneHit,
    level,
    locked,
    missAt,
    mode,
    next,
    noteIndex,
    offset,
    offsetAt,
    parts,
    phase,
    phraseNotes,
    playable,
    pops,
    press,
    pulse,
    reducedMotion,
    rings,
    rt,
    run,
    shake,
    shown,
    song,
    stars,
    syncAt,
    theme,
    themeShader,
    touchEnabled,
    trackX,
    tracks,
  }),
  document,
);
const {
  P,
  text,
  craftX,
  materialTexture,
  drawMaterial,
  drawCaptureMaterial,
  captureLight,
  drawLiquidWorld,
  drawBuiltWorld,
  drawWorld,
  drawCraft,
} = scene;
/** @param {number} t @param {boolean} playing */
function draw(t, playing) {
  const b = bar(t),
    dh = ((((theme.hues[b % 4] - hue) % 360) + 540) % 360) - 180;
  hue += dh * 0.04;
  // slow sways locked to the bar grid (one long left-right swing per 16 bars), swooping harder as the multiplier climbs
  const u = barF(t);
  bendAmp += ((playing ? 0.45 + run.multiplier * 0.07 : 0.6) - bendAmp) * 0.02;
  bendX =
    (reducedMotion?.matches ? 0 : 190) *
    bendAmp *
    Math.sin((u * Math.PI) / 8) *
    Math.cos((u * Math.PI) / 22);
  bendY =
    (reducedMotion?.matches ? 0 : 80) *
    bendAmp *
    Math.sin((u * Math.PI) / 12 + 1);

  scene.renderScene(t, playing);
  if (playing && entrance && (rt - entrance.at >= 0.75 || t >= 0))
    entrance = null;
}
setGrid(song);
tracks = buildTracks();
rebuild();
applyTheme(menu.entries[menu.selected]);
requestAnimationFrame(frame);
// Self-check: every phrase of every demo chart has notes, no step is doubled, and the grid maps times to bars.
["drums", "bass", "arp", "lead"].forEach((k, i) => {
  const ns = chart(k, 7 + i * 101);
  for (let p = 0; p < BARS / 2; p++)
    console.assert(
      ns.some(([t]) => Math.floor(t / BARLEN / 2) === p),
      k,
      "phrase empty",
      p,
    );
  console.assert(
    new Set(ns.map((n) => n[0])).size === ns.length,
    k,
    "duplicate step",
  );
});
console.assert(
  bar(0) === 0 &&
    bar(BARLEN * 5 + 0.01) === 5 &&
    bar(-1) === 0 &&
    Math.abs(barF(BARLEN * 2.5) - 2.5) < 1e-9,
  "grid",
);
{
  // difficulty: easy <= 1 note per beat and >= ~a beat apart; normal has no 16ths and leaves the 8th-note demo charts untouched
  /** @type {Note[]} */
  const n16 = [
    [0, 0],
    [STEP, 1],
    [2 * STEP, 2],
    [3 * STEP, 0],
    [BEAT, 1],
    [BEAT + 2 * STEP, 2],
    [2 * BEAT + 2 * STEP, 0],
    [3 * BEAT, 1],
  ];
  const e = thin(n16, 0),
    nm = thin(n16, 1);
  console.assert(
    nm.length === 6 && nm.every(([t]) => slot(t)[1] % 2 === 0),
    "normal thinning",
    nm,
  );
  console.assert(
    e.length === 3 &&
      e.every((n, i) => !i || n[0] - e[i - 1][0] >= BEAT * 0.9) &&
      e[0][0] === 0 &&
      e[1][0] === BEAT,
    "easy thinning",
    e,
  );
  for (const tr of demoSong().tracks)
    console.assert(
      thin(tr.notes, 1).length === tr.notes.length,
      "normal keeps the demo",
      tr.name,
    );
}
