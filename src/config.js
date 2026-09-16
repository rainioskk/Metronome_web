export const BPM_MIN = 1;
export const BPM_MAX = 240;
export const DEFAULT_BPM = 120;
export const DEFAULT_VOLUME = 72;
export const DEFAULT_ACCENT_FIRST_BEAT = true;
export const DEFAULT_ACCENT_INTERVAL = 4;
export const DEFAULT_WAKE_LOCK = true;
export const DEFAULT_SUBDIVISION = "quarter";

// The selected interval drives both the accent cycle and the beat lamp.
export const ACCENT_INTERVALS = [2, 3, 4, 5, 6, 7, 8];

// Each entry lists the click offsets inside a single beat, measured in beats.
// A 0.75 offset produces the long-short pair of a dotted-eighth shuffle.
export const SUBDIVISIONS = [
  { id: "quarter", icon: "quarter", offsets: [0] },
  { id: "eighth", icon: "eighth", offsets: [0, 0.5] },
  { id: "dottedEighth", icon: "dottedEighth", offsets: [0, 0.75] },
  { id: "triplet", icon: "triplet", offsets: [0, 1 / 3, 2 / 3] },
  { id: "sixteenth", icon: "sixteenth", offsets: [0, 0.25, 0.5, 0.75] },
];

// Intervals are normalized to be contiguous so the active marking is deterministic
// across the full slider range. Recommended BPMs are the center of each interval.
export const TEMPO_MARKINGS = [
  { id: "larghissimo", name: "Larghissimo", min: 1, max: 19, recommendedBpm: 10 },
  { id: "grave", name: "Grave", min: 20, max: 39, recommendedBpm: 30 },
  { id: "largo", name: "Largo", min: 40, max: 59, recommendedBpm: 50 },
  { id: "larghetto", name: "Larghetto", min: 60, max: 65, recommendedBpm: 63 },
  { id: "adagio", name: "Adagio", min: 66, max: 75, recommendedBpm: 71 },
  { id: "andante", name: "Andante", min: 76, max: 95, recommendedBpm: 86 },
  { id: "andantino", name: "Andantino", min: 96, max: 107, recommendedBpm: 102 },
  { id: "moderato", name: "Moderato", min: 108, max: 119, recommendedBpm: 114 },
  { id: "allegretto", name: "Allegretto", min: 120, max: 135, recommendedBpm: 128 },
  { id: "allegro", name: "Allegro", min: 136, max: 159, recommendedBpm: 148 },
  { id: "vivace", name: "Vivace", min: 160, max: 175, recommendedBpm: 168 },
  { id: "presto", name: "Presto", min: 176, max: 199, recommendedBpm: 188 },
  { id: "prestissimo", name: "Prestissimo", min: 200, max: BPM_MAX, recommendedBpm: 220 },
];

export const STORAGE_KEYS = {
  bpm: "metronome-bpm",
  subdivision: "metronome-subdivision",
  volume: "metronome-volume",
  theme: "metronome-theme",
  language: "metronome-language",
  accentFirstBeat: "metronome-accent-first-beat",
  accentInterval: "metronome-accent-interval",
  wakeLock: "metronome-wake-lock",
};

export function getTempoMarking(bpm) {
  return (
    TEMPO_MARKINGS.find((marking) => bpm >= marking.min && bpm <= marking.max) ??
    TEMPO_MARKINGS[0]
  );
}

export function getTempoMarkingById(id) {
  return TEMPO_MARKINGS.find((marking) => marking.id === id);
}
