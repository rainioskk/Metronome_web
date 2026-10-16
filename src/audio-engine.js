const LOOKAHEAD_MS = 25;
const SCHEDULE_AHEAD_SECONDS = 0.1;
const CLICK_ATTACK_SECONDS = 0.001;
const CLICK_DECAY_SECONDS = 0.028;
const ACCENT_FREQUENCY = 1200;
const NORMAL_FREQUENCY = 800;
const ACCENT_GAIN = 0.72;
const NORMAL_GAIN = 0.42;
const SILENCE_GAIN = 0.0001;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export class MetronomeAudio {
  constructor(onBeat = () => {}) {
    this.onBeat = onBeat;
    this.context = null;
    this.masterGain = null;
    this.config = null;
    this.isPlaying = false;
    this.generation = 0;
    this.beatIndex = 0;
    this.subIndex = 0;
    this.nextNoteTime = 0;
    this.schedulerTimer = null;
    this.visualTimers = new Set();
    this.scheduledVoices = new Set();
    this.beatHistory = [];
  }

  async ensureContext() {
    if (!this.context) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;

      if (!AudioContextClass) {
        throw new Error("AudioContext is unavailable");
      }

      this.context = new AudioContextClass();
      this.masterGain = this.context.createGain();
      this.masterGain.gain.value = this.getGain(this.config?.volume ?? 1);
      this.masterGain.connect(this.context.destination);
    }

    if (this.context.state !== "running") {
      await this.context.resume();
    }
  }

  getGain(volume) {
    return volume * volume;
  }

  async init() {
    await this.ensureContext();
  }

  async start(config) {
    this.stop();
    const generation = this.generation;
    this.config = { ...config };
    await this.init();
    if (generation !== this.generation) return false;

    this.isPlaying = true;
    this.beatIndex = 0;
    this.subIndex = 0;
    this.beatHistory = [];
    this.nextNoteTime = this.context.currentTime + 0.06;
    this.setVolume(this.config.volume, true);
    this.scheduler(generation);
    return true;
  }

  stop() {
    this.isPlaying = false;
    this.generation += 1;

    if (this.schedulerTimer) {
      window.clearTimeout(this.schedulerTimer);
      this.schedulerTimer = null;
    }

    this.clearVisualTimers();
    this.stopScheduledVoices();
  }

  update(config, { reschedule = true } = {}) {
    const previousConfig = this.config;
    this.config = { ...config };

    if (this.masterGain && this.context) {
      this.setVolume(config.volume);
    }

    if (this.isPlaying && (reschedule || previousConfig?.bpm !== config.bpm)) {
      this.resync(previousConfig);
    }
  }

  setVolume(volume, immediate = false) {
    const normalizedVolume = clamp(volume, 0, 1);
    if (this.config) this.config.volume = normalizedVolume;
    if (!this.masterGain || !this.context) return;

    const gain = this.getGain(normalizedVolume);
    if (immediate) {
      this.masterGain.gain.setValueAtTime(gain, this.context.currentTime);
    } else {
      this.masterGain.gain.setTargetAtTime(gain, this.context.currentTime, 0.012);
    }
  }

  async resume() {
    if (!this.context || this.context.state === "running") return;
    await this.context.resume();
    if (this.isPlaying) this.resync();
  }

  get contextState() {
    return this.context?.state ?? "closed";
  }

  playClick(isAccent, time) {
    const volume = this.config?.volume ?? 1;
    if (volume === 0 || !this.context || !this.masterGain) return;

    const startedAt = Number.isFinite(time) ? time : this.context.currentTime;
    const startTime = Math.max(startedAt, this.context.currentTime);
    const decayStartedAt = startTime + CLICK_ATTACK_SECONDS;
    const endTime = decayStartedAt + CLICK_DECAY_SECONDS;
    const oscillator = this.context.createOscillator();
    const envelope = this.context.createGain();

    oscillator.type = "triangle";
    oscillator.frequency.setValueAtTime(
      isAccent ? ACCENT_FREQUENCY : NORMAL_FREQUENCY,
      startTime
    );

    envelope.gain.setValueAtTime(0, startTime);
    envelope.gain.linearRampToValueAtTime(
      isAccent ? ACCENT_GAIN : NORMAL_GAIN,
      decayStartedAt
    );
    envelope.gain.exponentialRampToValueAtTime(SILENCE_GAIN, endTime);

    oscillator.connect(envelope);
    envelope.connect(this.masterGain);
    oscillator.start(startTime);
    oscillator.stop(endTime + 0.001);

    const voice = { oscillators: [oscillator], envelope, startTime, endTime };
    this.scheduledVoices.add(voice);
    oscillator.addEventListener("ended", () => {
      this.scheduledVoices.delete(voice);
      oscillator.disconnect();
      envelope.disconnect();
    }, { once: true });
  }

  scheduleVisualBeat(beatIndex, accent, time, generation) {
    const delay = Math.max(0, (time - this.context.currentTime) * 1000);
    const timer = window.setTimeout(() => {
      this.visualTimers.delete(timer);
      if (!this.isPlaying || generation !== this.generation) return;
      if (this.context.currentTime - time > SCHEDULE_AHEAD_SECONDS) return;
      this.onBeat(beatIndex, accent, time);
    }, delay);

    this.visualTimers.add(timer);
  }

  scheduler(generation) {
    if (!this.isPlaying || generation !== this.generation || !this.context || !this.config) return;

    const { bpm, beats, subdivisionOffsets, accentFirstBeat } = this.config;
    if (bpm < 1 || !subdivisionOffsets?.length) {
      this.stop();
      return;
    }

    const beatDuration = 60 / bpm;
    const now = this.context.currentTime;
    // Timers can be throttled in background tabs. Seek on the audio timeline
    // instead of playing every missed click at the current instant.
    if (this.nextNoteTime < now - 0.03) {
      const start = this.nextNoteTime - subdivisionOffsets[this.subIndex] * beatDuration;
      const skippedBeats = Math.floor((now - start) / beatDuration);
      const beatStart = start + skippedBeats * beatDuration;
      this.beatIndex = (this.beatIndex + skippedBeats) % beats;
      this.beatHistory = [{ time: beatStart, index: this.beatIndex, bpm }];
      this.subIndex = subdivisionOffsets.findIndex(offset => beatStart + offset * beatDuration >= now);
      if (this.subIndex === -1) {
        this.subIndex = 0;
        this.beatIndex = (this.beatIndex + 1) % beats;
        this.nextNoteTime = beatStart + beatDuration;
      } else {
        this.nextNoteTime = beatStart + subdivisionOffsets[this.subIndex] * beatDuration;
      }
    }

    while (this.nextNoteTime < this.context.currentTime + SCHEDULE_AHEAD_SECONDS) {
      const offset = subdivisionOffsets[this.subIndex] ?? 0;
      const isMainBeat = offset === 0;
      const accent = isMainBeat && accentFirstBeat && this.beatIndex === 0;

      this.playClick(accent, this.nextNoteTime);

      if (isMainBeat) {
        this.beatHistory.push({ time: this.nextNoteTime, index: this.beatIndex, bpm });
        // Retain the last elapsed beat plus any beats in the lookahead window.
        while (this.beatHistory.length > 1 && this.beatHistory[1].time <= now) {
          this.beatHistory.shift();
        }
        this.scheduleVisualBeat(this.beatIndex, accent, this.nextNoteTime, generation);
      }

      const nextSubIndex = this.subIndex + 1;

      if (nextSubIndex < subdivisionOffsets.length) {
        this.nextNoteTime += (subdivisionOffsets[nextSubIndex] - offset) * beatDuration;
        this.subIndex = nextSubIndex;
      } else {
        this.nextNoteTime += (1 - offset) * beatDuration;
        this.subIndex = 0;
        this.beatIndex = (this.beatIndex + 1) % beats;
      }
    }

    this.schedulerTimer = window.setTimeout(() => this.scheduler(generation), LOOKAHEAD_MS);
  }

  clearVisualTimers() {
    this.visualTimers.forEach((timer) => window.clearTimeout(timer));
    this.visualTimers.clear();
  }

  stopScheduledVoices({ futureOnly = false } = {}) {
    if (!this.context) return;

    const now = this.context.currentTime;

    this.scheduledVoices.forEach((voice) => {
      const { oscillators, envelope, startTime, endTime } = voice;
      if (endTime <= now || (futureOnly && startTime <= now)) return;
      if (startTime > now) {
        oscillators.forEach(oscillator => oscillator.stop(now));
        this.scheduledVoices.delete(voice);
        return;
      }

      if (envelope) {
        try {
          envelope.gain.cancelScheduledValues(now);
          envelope.gain.setValueAtTime(
            Math.max(envelope.gain.value, SILENCE_GAIN),
            now
          );
          envelope.gain.exponentialRampToValueAtTime(SILENCE_GAIN, now + 0.006);
        } catch {
          // The voice has already finished its original schedule.
        }
      }

      oscillators.forEach((oscillator) => {
        try {
          oscillator.stop(now + 0.007);
        } catch {
          // A voice can already be stopped by its original schedule.
        }
      });
    });
    if (!futureOnly) this.scheduledVoices.clear();
  }

  resync(previousConfig = this.config) {
    if (!this.isPlaying || !this.context) return;

    this.generation += 1;
    this.clearVisualTimers();
    window.clearTimeout(this.schedulerTimer);
    this.schedulerTimer = null;
    this.stopScheduledVoices({ futureOnly: true });

    const now = this.context.currentTime;
    const elapsedBeat = [...this.beatHistory].reverse().find(beat => beat.time <= now);
    const duration = 60 / this.config.bpm;
    if (elapsedBeat) {
      const elapsed = Math.max(0, (now - elapsedBeat.time) / (60 / elapsedBeat.bpm));
      const wholeBeats = Math.floor(elapsed);
      const progress = elapsed - wholeBeats;
      const index = previousConfig.beats === this.config.beats
        ? (elapsedBeat.index + wholeBeats) % this.config.beats : 0;
      const start = now - progress * duration;
      this.beatHistory = [{ time: start, index, bpm: this.config.bpm }];
      this.subIndex = this.config.subdivisionOffsets.findIndex(offset => offset > progress + 1e-8);
      this.beatIndex = index;
      if (this.subIndex === -1) {
        this.subIndex = 0;
        this.beatIndex = (index + 1) % this.config.beats;
        this.nextNoteTime = start + duration;
      } else {
        this.nextNoteTime = start + this.config.subdivisionOffsets[this.subIndex] * duration;
      }
    } else {
      // A change during startup must keep the first beat, rather than skip it.
      this.nextNoteTime = Math.max(now + 0.006, this.beatHistory[0]?.time ?? now + 0.06);
      this.beatIndex = 0;
      this.subIndex = 0;
      this.beatHistory = [];
    }
    this.scheduler(this.generation);
  }
}
