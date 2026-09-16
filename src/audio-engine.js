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
  }

  async ensureContext() {
    if (!this.context) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;

      if (!AudioContextClass) {
        throw new Error("AudioContext is unavailable");
      }

      this.context = new AudioContextClass();
      this.masterGain = this.context.createGain();
      this.masterGain.gain.value = this.getGain(this.config?.volume ?? 0.72);
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
    await this.init();

    this.config = { ...config };
    this.isPlaying = true;
    this.generation += 1;
    this.beatIndex = 0;
    this.subIndex = 0;
    this.nextNoteTime = this.context.currentTime + 0.06;
    this.setVolume(config.volume, true);
    this.scheduler(this.generation);
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
    this.config = { ...config };

    if (this.masterGain && this.context) {
      this.setVolume(config.volume);
    }

    if (this.isPlaying && reschedule) {
      this.resync();
    }
  }

  setVolume(volume, immediate = false) {
    if (!this.masterGain || !this.context) return;

    const gain = this.getGain(clamp(volume, 0, 1));
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

    const voice = { oscillators: [oscillator], endTime };
    this.scheduledVoices.add(voice);
    oscillator.addEventListener("ended", () => this.scheduledVoices.delete(voice), {
      once: true,
    });
  }

  scheduleVisualBeat(beatIndex, accent, time, generation) {
    const delay = Math.max(0, (time - this.context.currentTime) * 1000);
    const timer = window.setTimeout(() => {
      this.visualTimers.delete(timer);
      if (!this.isPlaying || generation !== this.generation) return;
      this.onBeat(beatIndex, accent);
    }, delay);

    this.visualTimers.add(timer);
  }

  scheduler(generation) {
    if (!this.isPlaying || generation !== this.generation || !this.context || !this.config) return;

    const { bpm, beats, subdivision, accentFirstBeat } = this.config;
    if (bpm < 1) {
      this.stop();
      return;
    }

    while (this.nextNoteTime < this.context.currentTime + SCHEDULE_AHEAD_SECONDS) {
      const isMainBeat = this.subIndex === 0;
      const accent = isMainBeat && accentFirstBeat && this.beatIndex === 0;

      this.playClick(accent, this.nextNoteTime);

      if (isMainBeat) {
        this.scheduleVisualBeat(this.beatIndex, accent, this.nextNoteTime, generation);
      }

      this.nextNoteTime += 60 / bpm / subdivision;
      this.subIndex += 1;

      if (this.subIndex >= subdivision) {
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

  stopScheduledVoices() {
    if (!this.context) return;

    this.scheduledVoices.forEach(({ oscillators, endTime }) => {
      if (endTime <= this.context.currentTime) return;

      oscillators.forEach((oscillator) => {
        try {
          oscillator.stop(this.context.currentTime);
        } catch {
          // A voice can already be stopped by its original schedule.
        }
      });
    });
    this.scheduledVoices.clear();
  }

  resync() {
    if (!this.isPlaying || !this.context) return;

    this.generation += 1;
    this.clearVisualTimers();

    if (this.schedulerTimer) {
      window.clearTimeout(this.schedulerTimer);
      this.schedulerTimer = null;
    }

    this.stopScheduledVoices();
    this.beatIndex = 0;
    this.subIndex = 0;
    this.nextNoteTime = this.context.currentTime + 0.06;
    this.scheduler(this.generation);
  }
}
