/** Seconds on the song timeline and a lane index (left, middle, right). */
export type Note = [time: number, lane: number];
export interface ChartTrack {
  name: string;
  stem: string;
  notes: Note[];
}
export interface SongChart {
  v?: number;
  duration: number;
  beats: number[];
  downbeat: number;
  bpm?: number;
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
  tracks: { name: string; kind?: string; stem?: string; notes: Note[] }[];
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
