export const BPM_MIN = 1;
export const BPM_MAX = 240;
export const DEFAULT_BPM = 120;
export const DEFAULT_VOLUME = 72;
export const DEFAULT_ACCENT_FIRST_BEAT = true;
export const DEFAULT_WAKE_LOCK = true;

export const METERS = [
  { id: "2/4", beats: 2 },
  { id: "3/4", beats: 3 },
  { id: "4/4", beats: 4 },
  { id: "6/8", beats: 6 },
];

export const SUBDIVISIONS = [1, 2, 4, 3];

export const TEMPO_MARKINGS = [
  { min: 1, max: 19, name: "Larghissimo" },
  { min: 20, max: 39, name: "Grave" },
  { min: 40, max: 49, name: "Largo" },
  { min: 50, max: 54, name: "Lento" },
  { min: 55, max: 65, name: "Adagio" },
  { min: 66, max: 75, name: "Andante" },
  { min: 76, max: 107, name: "Moderato" },
  { min: 108, max: 119, name: "Allegretto" },
  { min: 120, max: 167, name: "Allegro" },
  { min: 168, max: 199, name: "Presto" },
  { min: 200, max: BPM_MAX, name: "Prestissimo" },
];

export const STORAGE_KEYS = {
  bpm: "metronome-bpm",
  meter: "metronome-meter",
  subdivision: "metronome-subdivision",
  volume: "metronome-volume",
  theme: "metronome-theme",
  language: "metronome-language",
  accentFirstBeat: "metronome-accent-first-beat",
  wakeLock: "metronome-wake-lock",
};

export function getTempoMarking(bpm) {
  return (
    TEMPO_MARKINGS.find((marking) => bpm >= marking.min && bpm <= marking.max)?.name ??
    TEMPO_MARKINGS[0].name
  );
}
