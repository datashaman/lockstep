/** Seconds on the song timeline and a lane index (left, middle, right). */
/** `length` (seconds on the song timeline) is present only on hold notes. */
export type Note = [time: number, lane: number, length?: number];
export interface ChartTrack {
  name: string;
  stem: string;
  notes: Note[];
  /** Loudness of the stem on each beat of `beats`, 0 (silent) to 15 (its loud end). */
  energy?: number[];
}
export interface SongChart {
  v?: number;
  duration: number;
  beats: number[];
  downbeat: number;
  bpm?: number;
  /** Whether beats are one steady tempo or follow a drifting one. */
  grid?: "steady" | "tracked";
  /** Ascending bar indices (always even, starting at 0) where a section of the song starts. */
  sections?: number[];
  tracks: ChartTrack[];
}
/** Stored in chart-track order; each pair contains left and right 44.1 kHz PCM. */
export type SongAudio = [Int16Array, Int16Array][];
export interface LibrarySong {
  id: string;
  title: string;
  url?: string;
  song: SongChart;
  added: number;
}
export interface TempoSegment {
  at: number;
  pos: number;
  rate: number;
}

export interface PlayableSong {
  bpm?: number;
  title: string;
  duration: number;
  beats: number[];
  downbeat: number;
  synth?: boolean;
  buffers?: AudioBuffer[];
  sections?: number[];
  tracks: {
    name: string;
    kind?: string;
    stem?: string;
    notes: Note[];
    energy?: number[];
  }[];
}
export interface SongEntry {
  title: string;
  lib?: string;
  slug?: string;
  url?: string;
  meta?: SongChart;
  song?: PlayableSong;
  add?: boolean;
  find?: boolean;
}
export interface AudiusTrack {
  id: string;
  title: string;
  user: { name: string };
  permalink: string;
  duration: number;
  is_streamable: boolean;
  access?: { stream?: boolean };
  preview_start_seconds?: number;
}
