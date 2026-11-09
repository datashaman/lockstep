import type { GameTrack, GameNote, RunState } from "./gameplay.js";
import type { PlayableSong } from "./song";
export interface Theme {
  name: string;
  colors: string[];
  hues: number[];
}
export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  born: number;
  life: number;
  color: string;
  size: number;
}
export interface Popup {
  text: string;
  x: number;
  y: number;
  color: string;
  size: number;
  life: number;
  born: number;
}
export interface SceneFrame {
  DPR: number;
  F: number;
  H: number;
  HIT_Y: number;
  HZ: number;
  LOOK: number;
  LW: number;
  TW: number;
  W: number;
  MONO: string;
  SANS: string;
  LEVELS: readonly { name: string; win: number }[];
  THEMES: Record<string, Theme>;
  theme: Theme;
  auto: (track: GameTrack, note: GameNote) => boolean;
  bar: (time: number) => number;
  barF: (time: number) => number;
  bars: number[];
  beats: number[];
  bendX: number;
  bendY: number;
  camTo: number;
  camX: number;
  captureRemaining: (track: GameTrack, time: number) => number;
  dash: { from: number; to: number; at: number } | null;
  drawFailure: () => void;
  drawResults: () => void;
  drawTitle: () => void;
  entrance: { image: CanvasImageSource; at: number } | null;
  flash: { color: string; born: number } | null;
  gridDown: number;
  hue: number;
  idx: (beats: number[], time: number) => number;
  inSync: boolean;
  isCircuit: () => boolean;
  isLiquid: () => boolean;
  isPaper: () => boolean;
  laneHit: number[];
  level: number;
  locked: (track: GameTrack, time: number) => boolean;
  missAt: number;
  mode: string;
  next: (direction: number) => number;
  noteIndex: (notes: GameNote[], time: number) => number;
  offset: number;
  offsetAt: number;
  parts: readonly Particle[];
  phase: number;
  phraseNotes: (track: GameTrack, phrase: number) => GameNote[];
  playable: (track: GameTrack, time: number) => number | boolean;
  pops: readonly Popup[];
  press: number[];
  pulse: number;
  reducedMotion: { matches: boolean } | undefined;
  rings: readonly { x: number; born: number; color: string }[];
  rt: number;
  run: Readonly<RunState>;
  shake: number;
  shown: number;
  song: PlayableSong;
  stars: readonly { x: number; y: number; z: number }[];
  syncAt: number;
  themeShader: ReturnType<
    typeof import("../theme-shaders.js").createThemeShader
  >;
  touchEnabled: boolean;
  trackX: (index: number) => number;
  tracks: readonly GameTrack[];
}
