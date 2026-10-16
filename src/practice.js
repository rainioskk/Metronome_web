import { ACCENT_INTERVALS, BPM_MIN, BPM_MAX, SUBDIVISIONS } from "./config.js";

export const DEFAULT_TRAINER = { enabled: false, everyBars: 4, step: 5, target: 160 };
export const MAX_PRESETS = 10;

const integer = (value, fallback, min, max) =>
  Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback;

export function normalizeTrainer(value = {}) {
  if (!value || typeof value !== "object") value = {};
  return {
    enabled: value.enabled === true,
    everyBars: integer(value.everyBars, 4, 1, 32),
    step: integer(value.step, 5, 1, 40),
    target: integer(value.target, 160, BPM_MIN, BPM_MAX),
  };
}

export class TapTempo {
  constructor() { this.taps = []; }

  tap(now) {
    const previous = this.taps.at(-1);
    if (previous !== undefined && now - previous < 100) return null;
    if (previous !== undefined && now - previous > 3000) this.taps = [];
    this.taps.push(now);
    this.taps = this.taps.slice(-6);
    if (this.taps.length < 2) return null;
    const duration = (now - this.taps[0]) / (this.taps.length - 1);
    return integer(60000 / duration, 120, BPM_MIN, BPM_MAX);
  }
}

// Count complete bars from audible main beats. Pausing, changing the bar length,
// or losing visual callbacks in the background starts a fresh training interval.
export class TempoTrainer {
  constructor() { this.reset(); }

  reset() {
    this.bars = 0;
    this.started = false;
    this.lastTime = null;
    this.lastBpm = null;
  }

  beat(index, bpm, time, settings) {
    if (!settings.enabled) { this.reset(); return bpm; }
    if (this.lastTime !== null && time - this.lastTime > 1.5 * 60 / this.lastBpm) this.reset();
    this.lastTime = time;
    this.lastBpm = bpm;
    if (index !== 0) return bpm;
    if (!this.started) { this.started = true; return bpm; }
    this.bars += 1;
    if (this.bars < settings.everyBars) return bpm;
    this.bars = 0;
    const next = bpm < settings.target ? Math.min(settings.target, bpm + settings.step) : bpm;
    this.lastBpm = next;
    return next;
  }
}

export function readPresets(raw) {
  try {
    const values = JSON.parse(raw);
    if (!Array.isArray(values)) return [];
    const seen = new Set();
    return values.filter(value => {
      if (!value || value.version !== 1 || typeof value.id !== "string" || seen.has(value.id)) return false;
      if (typeof value.name !== "string" || !value.name.trim()) return false;
      if (!Number.isInteger(value.bpm) || value.bpm < BPM_MIN || value.bpm > BPM_MAX) return false;
      if (!SUBDIVISIONS.some(item => item.id === value.subdivisionId) || !ACCENT_INTERVALS.includes(value.accentInterval)) return false;
      if (typeof value.accentFirstBeat !== "boolean" || !Number.isFinite(value.volume) || value.volume < 0 || value.volume > 1) return false;
      seen.add(value.id);
      return true;
    }).slice(0, MAX_PRESETS).map(value => ({
      version: 1, id: value.id, name: value.name.trim().slice(0, 40), bpm: value.bpm,
      subdivisionId: value.subdivisionId, accentInterval: value.accentInterval,
      accentFirstBeat: value.accentFirstBeat, volume: value.volume,
      trainer: normalizeTrainer(value.trainer),
    }));
  } catch { return []; }
}
