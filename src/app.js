import {
  BPM_MAX,
  BPM_MIN,
  DEFAULT_ACCENT_FIRST_BEAT,
  DEFAULT_BPM,
  DEFAULT_VOLUME,
  DEFAULT_WAKE_LOCK,
  METERS,
  STORAGE_KEYS,
  SUBDIVISIONS,
  getTempoMarking,
} from "./config.js";
import { MetronomeAudio } from "./audio-engine.js";
import { createI18n } from "./i18n.js";
import { ScreenWakeLock } from "./screen-wake-lock.js";
import {
  readBoolean,
  readNumber,
  readStorage,
  writeStorage,
} from "./storage.js";

const PRESETS = [60, 80, 100, 120, 160];

const elements = {
  languageSelect: document.querySelector("#languageSelect"),
  themeToggle: document.querySelector("#themeToggle"),
  wakeLockToggle: document.querySelector("#wakeLockToggle"),
  wakeStateLabel: document.querySelector("#wakeStateLabel"),
  bpmInput: document.querySelector("#bpmInput"),
  tempoRange: document.querySelector("#tempoRange"),
  tempoMark: document.querySelector("#tempoMark"),
  decreaseTempo: document.querySelector("#decreaseTempo"),
  increaseTempo: document.querySelector("#increaseTempo"),
  presetRow: document.querySelector("#presetRow"),
  meterOptions: document.querySelector("#meterOptions"),
  subdivisionOptions: document.querySelector("#subdivisionOptions"),
  accentToggle: document.querySelector("#accentToggle"),
  beatDisplay: document.querySelector("#beatDisplay"),
  audioState: document.querySelector("#audioState"),
  beatNumber: document.querySelector("#beatNumber"),
  beatTotal: document.querySelector("#beatTotal"),
  beatDots: document.querySelector("#beatDots"),
  tapTempo: document.querySelector("#tapTempo"),
  playButton: document.querySelector("#playButton"),
  playText: document.querySelector("#playText"),
  volumeRange: document.querySelector("#volumeRange"),
  volumeOutput: document.querySelector("#volumeOutput"),
};

const i18n = createI18n(readStorage(STORAGE_KEYS.language));
let wakeRuntimeState = "idle";

const state = {
  bpm: DEFAULT_BPM,
  meterId: "4/4",
  subdivision: 1,
  accentFirstBeat: DEFAULT_ACCENT_FIRST_BEAT,
  wakeLockEnabled: DEFAULT_WAKE_LOCK,
  volume: DEFAULT_VOLUME / 100,
  isPlaying: false,
  taps: [],
  lastTapAt: 0,
  theme: "light",
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function currentMeter() {
  return METERS.find((meter) => meter.id === state.meterId) ?? METERS[2];
}

function audioSnapshot() {
  return {
    bpm: state.bpm,
    beats: currentMeter().beats,
    subdivision: state.subdivision,
    accentFirstBeat: state.accentFirstBeat,
    volume: state.volume,
  };
}

const audio = new MetronomeAudio(triggerVisualBeat);
const wakeLock = new ScreenWakeLock((nextState) => {
  wakeRuntimeState = nextState;
  updateWakeLockUI();
});

function getInitialTheme() {
  const savedTheme = readStorage(STORAGE_KEYS.theme);
  if (savedTheme === "light" || savedTheme === "dark") return savedTheme;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function updateDocumentTitle() {
  if (!state.isPlaying) {
    document.title = i18n.t("meta.title");
    return;
  }

  document.title = i18n.t("audio.documentTitle", {
    bpm: state.bpm,
    mark: getTempoMarking(state.bpm),
  });
}

function updateThemeUI() {
  elements.themeToggle.setAttribute(
    "aria-label",
    state.theme === "dark" ? i18n.t("theme.toLight") : i18n.t("theme.toDark")
  );
}

function applyTheme(theme, persist = true) {
  state.theme = theme;
  document.documentElement.dataset.theme = theme;
  updateThemeUI();
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", theme === "dark" ? "#101513" : "#f1f4f2");

  if (persist) writeStorage(STORAGE_KEYS.theme, theme);
}

function updateWakeLockUI() {
  const runtime = state.wakeLockEnabled ? wakeRuntimeState : "idle";
  const stateKey = !state.wakeLockEnabled
    ? "off"
    : runtime === "idle"
      ? "ready"
      : runtime;
  const labelKey = !state.wakeLockEnabled
    ? "wake.aria.off"
    : runtime === "active"
      ? "wake.aria.active"
      : runtime === "unsupported"
        ? "wake.aria.unsupported"
        : runtime === "error"
          ? "wake.aria.error"
          : "wake.aria.ready";

  elements.wakeLockToggle.dataset.runtime = runtime;
  elements.wakeLockToggle.dataset.enabled = String(state.wakeLockEnabled);
  elements.wakeLockToggle.setAttribute("aria-checked", String(state.wakeLockEnabled));
  elements.wakeLockToggle.setAttribute("aria-label", i18n.t(labelKey));
  elements.wakeLockToggle.setAttribute("title", i18n.t(labelKey));
  elements.wakeStateLabel.textContent = i18n.t(`wake.state.${stateKey}`);
}

function updateTempoUI() {
  const marking = getTempoMarking(state.bpm);
  elements.bpmInput.value = String(state.bpm);
  elements.tempoRange.value = String(state.bpm);
  elements.tempoRange.setAttribute("aria-valuetext", `${state.bpm} BPM · ${marking}`);
  elements.tempoMark.textContent = marking;
  elements.tempoMark.setAttribute("aria-label", i18n.t("tempo.markAria", { mark: marking }));

  elements.presetRow.querySelectorAll("[data-bpm]").forEach((button) => {
    const active = Number(button.dataset.bpm) === state.bpm;
    button.setAttribute("aria-pressed", String(active));
    button.setAttribute(
      "aria-label",
      i18n.t("tempo.presetAria", { bpm: button.dataset.bpm })
    );
  });

  if (state.isPlaying) {
    elements.audioState.textContent = i18n.t("audio.playing", { bpm: state.bpm });
  }

  updateDocumentTitle();
}

function setBpm(rawValue, options = {}) {
  const numericValue = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(numericValue)) return;

  state.bpm = clamp(numericValue, BPM_MIN, BPM_MAX);
  updateTempoUI();

  if (options.persist !== false) {
    writeStorage(STORAGE_KEYS.bpm, state.bpm);
  }

  if (state.isPlaying) {
    audio.update(audioSnapshot(), { reschedule: false });
  }
}

function adjustBpm(delta) {
  setBpm(state.bpm + delta);
}

function updatePlaybackUI() {
  elements.playButton.classList.toggle("is-playing", state.isPlaying);
  elements.playButton.setAttribute(
    "aria-label",
    state.isPlaying ? i18n.t("playback.pauseAria") : i18n.t("playback.startAria")
  );
  elements.playText.textContent = state.isPlaying
    ? i18n.t("playback.pause")
    : i18n.t("playback.start");
  elements.beatDisplay.classList.toggle("is-playing", state.isPlaying);

  if (state.isPlaying) {
    elements.audioState.textContent = i18n.t("audio.playing", { bpm: state.bpm });
  } else {
    elements.audioState.textContent = i18n.t("audio.ready");
    clearCurrentBeat();
  }

  updateDocumentTitle();
}

function renderPresets() {
  elements.presetRow.replaceChildren();

  PRESETS.forEach((bpm) => {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.bpm = String(bpm);
    button.textContent = String(bpm);
    button.setAttribute("aria-label", i18n.t("tempo.presetAria", { bpm }));
    button.addEventListener("click", () => setBpm(bpm));
    elements.presetRow.append(button);
  });
}

function renderMeters() {
  elements.meterOptions.replaceChildren();

  METERS.forEach((meter) => {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.meterId = meter.id;
    button.textContent = meter.id;
    button.setAttribute("role", "radio");
    button.setAttribute("aria-checked", String(meter.id === state.meterId));
    button.setAttribute("aria-label", i18n.t("meter.aria", { meter: meter.id }));
    button.addEventListener("click", () => selectMeter(meter.id));
    elements.meterOptions.append(button);
  });
}

function renderSubdivisions() {
  elements.subdivisionOptions.replaceChildren();

  SUBDIVISIONS.forEach((subdivision) => {
    const button = document.createElement("button");
    const count = document.createElement("strong");
    const label = document.createElement("small");

    button.type = "button";
    button.dataset.subdivision = String(subdivision);
    button.setAttribute("role", "radio");
    button.setAttribute("aria-checked", String(subdivision === state.subdivision));
    button.setAttribute("aria-label", i18n.t(`subdivision.${subdivision}`));

    count.textContent = String(subdivision);
    label.textContent = i18n.t(`subdivision.${subdivision}`);
    button.append(count, label);
    elements.subdivisionOptions.append(button);
  });
}

function renderBeatIndicators() {
  elements.beatDots.replaceChildren();

  for (let index = 0; index < currentMeter().beats; index += 1) {
    const dot = document.createElement("span");
    dot.dataset.beat = String(index);
    dot.className = "beat-dot";
    if (index === 0 && state.accentFirstBeat) dot.classList.add("is-accent");
    elements.beatDots.append(dot);
  }

  elements.beatTotal.textContent = String(currentMeter().beats);
}

function selectMeter(meterId) {
  if (!METERS.some((meter) => meter.id === meterId) || meterId === state.meterId) return;

  state.meterId = meterId;
  renderMeters();
  renderBeatIndicators();
  writeStorage(STORAGE_KEYS.meter, meterId);

  if (state.isPlaying) {
    audio.update(audioSnapshot());
    elements.beatNumber.textContent = "1";
  }
}

function selectSubdivision(value) {
  const subdivision = Number.parseInt(value, 10);
  if (!SUBDIVISIONS.includes(subdivision) || subdivision === state.subdivision) return;

  state.subdivision = subdivision;
  renderSubdivisions();
  writeStorage(STORAGE_KEYS.subdivision, subdivision);

  if (state.isPlaying) {
    audio.update(audioSnapshot());
    elements.beatNumber.textContent = "1";
  }
}

function updateAccentUI() {
  elements.accentToggle.setAttribute("aria-checked", String(state.accentFirstBeat));
  elements.accentToggle.dataset.enabled = String(state.accentFirstBeat);
}

function setAccentFirstBeat(enabled) {
  state.accentFirstBeat = Boolean(enabled);
  updateAccentUI();
  renderBeatIndicators();
  writeStorage(STORAGE_KEYS.accentFirstBeat, state.accentFirstBeat);

  if (state.isPlaying) {
    audio.update(audioSnapshot(), { reschedule: false });
  }
}

function setVolume(value, persist = true) {
  const percentage = clamp(Math.round(Number(value)), 0, 100);
  state.volume = percentage / 100;
  elements.volumeRange.value = String(percentage);
  elements.volumeOutput.value = `${percentage}%`;
  elements.volumeOutput.textContent = `${percentage}%`;
  audio.setVolume(state.volume);

  if (persist) {
    writeStorage(STORAGE_KEYS.volume, percentage);
  }
}

function setLanguage(locale) {
  i18n.setLocale(locale);
  writeStorage(STORAGE_KEYS.language, i18n.locale);
  elements.languageSelect.value = i18n.locale;
  applyTranslations();
}

function applyStaticTranslations() {
  document.querySelectorAll("[data-i18n]").forEach((element) => {
    element.textContent = i18n.t(element.dataset.i18n);
  });

  document.querySelectorAll("[data-i18n-aria-label]").forEach((element) => {
    element.setAttribute("aria-label", i18n.t(element.dataset.i18nAriaLabel));
  });
}

function applyTranslations() {
  document.documentElement.lang = i18n.locale;
  document
    .querySelector('meta[name="description"]')
    ?.setAttribute("content", i18n.t("meta.description"));
  elements.languageSelect.setAttribute("aria-label", i18n.t("language.label"));

  applyStaticTranslations();
  renderPresets();
  renderMeters();
  renderSubdivisions();
  renderBeatIndicators();
  updateTempoUI();
  updateThemeUI();
  updateWakeLockUI();
  updatePlaybackUI();
}

async function startMetronome() {
  if (state.isPlaying) return;

  state.isPlaying = true;
  updatePlaybackUI();

  if (state.wakeLockEnabled) {
    wakeLock.acquire().catch(() => {});
  }

  try {
    await audio.start(audioSnapshot());
  } catch {
    state.isPlaying = false;
    updatePlaybackUI();
    elements.audioState.textContent = i18n.t("audio.unavailable");
    wakeLock.release().catch(() => {});
  }
}

function stopMetronome() {
  state.isPlaying = false;
  audio.stop();
  updatePlaybackUI();
  wakeLock.release().catch(() => {});
}

function toggleMetronome() {
  if (state.isPlaying) {
    stopMetronome();
  } else {
    startMetronome();
  }
}

function toggleWakeLock() {
  state.wakeLockEnabled = !state.wakeLockEnabled;
  writeStorage(STORAGE_KEYS.wakeLock, state.wakeLockEnabled);
  updateWakeLockUI();

  if (!state.wakeLockEnabled) {
    wakeLock.release().catch(() => {});
  } else if (state.isPlaying) {
    wakeLock.acquire().catch(() => {});
  }
}

function clearCurrentBeat() {
  document.querySelectorAll(".is-current").forEach((element) => {
    element.classList.remove("is-current");
  });
  elements.beatDisplay.classList.remove("is-beating", "is-accent");
  elements.beatNumber.textContent = "1";
}

function triggerVisualBeat(beatIndex, accent) {
  document.querySelectorAll(".is-current").forEach((element) => {
    element.classList.remove("is-current");
  });

  document.querySelector(`.beat-dot[data-beat="${beatIndex}"]`)?.classList.add("is-current");
  elements.beatNumber.textContent = String(beatIndex + 1);
  elements.beatDisplay.classList.toggle("is-accent", accent);
  elements.beatDisplay.classList.remove("is-beating");
  void elements.beatDisplay.offsetWidth;
  elements.beatDisplay.classList.add("is-beating");
  window.setTimeout(() => elements.beatDisplay.classList.remove("is-beating"), 110);
}

function registerTap() {
  const now = performance.now();

  if (state.lastTapAt && now - state.lastTapAt > 3000) {
    state.taps = [];
  }

  state.lastTapAt = now;
  state.taps.push(now);
  state.taps = state.taps.slice(-6);
  elements.tapTempo.classList.add("is-tapped");
  window.setTimeout(() => elements.tapTempo.classList.remove("is-tapped"), 110);

  if (state.taps.length < 2) return;

  const intervals = state.taps
    .slice(1)
    .map((tap, index) => tap - state.taps[index])
    .filter((interval) => interval >= 250 && interval <= 60000);

  if (!intervals.length) {
    state.taps = [now];
    return;
  }

  const average = intervals.reduce((sum, interval) => sum + interval, 0) / intervals.length;
  setBpm(Math.round(60000 / average));
}

function restoreSettings() {
  state.bpm = clamp(readNumber(STORAGE_KEYS.bpm, DEFAULT_BPM), BPM_MIN, BPM_MAX);

  const savedMeter = readStorage(STORAGE_KEYS.meter);
  state.meterId = METERS.some((meter) => meter.id === savedMeter) ? savedMeter : "4/4";

  const savedSubdivision = readNumber(STORAGE_KEYS.subdivision, 1);
  state.subdivision = SUBDIVISIONS.includes(savedSubdivision) ? savedSubdivision : 1;
  state.accentFirstBeat = readBoolean(
    STORAGE_KEYS.accentFirstBeat,
    DEFAULT_ACCENT_FIRST_BEAT
  );
  state.wakeLockEnabled = readBoolean(STORAGE_KEYS.wakeLock, DEFAULT_WAKE_LOCK);
  state.volume = clamp(readNumber(STORAGE_KEYS.volume, DEFAULT_VOLUME), 0, 100) / 100;

  const savedLanguage = readStorage(STORAGE_KEYS.language);
  if (savedLanguage) i18n.setLocale(savedLanguage);
}

function bindEvents() {
  elements.languageSelect.addEventListener("change", (event) => {
    setLanguage(event.target.value);
  });

  elements.themeToggle.addEventListener("click", () => {
    applyTheme(state.theme === "dark" ? "light" : "dark");
  });

  elements.wakeLockToggle.addEventListener("click", toggleWakeLock);
  elements.accentToggle.addEventListener("click", () => {
    setAccentFirstBeat(!state.accentFirstBeat);
  });

  elements.tempoRange.addEventListener("input", (event) => setBpm(event.target.value));
  elements.bpmInput.addEventListener("change", (event) => setBpm(event.target.value));
  elements.bpmInput.addEventListener("blur", () => {
    elements.bpmInput.value = String(state.bpm);
  });
  elements.bpmInput.addEventListener("focus", (event) => event.target.select());

  elements.decreaseTempo.addEventListener("click", () => adjustBpm(-1));
  elements.increaseTempo.addEventListener("click", () => adjustBpm(1));

  elements.meterOptions.addEventListener("click", (event) => {
    const button = event.target.closest("[data-meter-id]");
    if (button) selectMeter(button.dataset.meterId);
  });

  elements.subdivisionOptions.addEventListener("click", (event) => {
    const button = event.target.closest("[data-subdivision]");
    if (button) selectSubdivision(button.dataset.subdivision);
  });

  elements.volumeRange.addEventListener("input", (event) => setVolume(event.target.value));
  elements.tapTempo.addEventListener("click", registerTap);
  elements.playButton.addEventListener("click", toggleMetronome);

  document.addEventListener("keydown", (event) => {
    const isEditing =
      event.target instanceof HTMLInputElement ||
      event.target instanceof HTMLSelectElement ||
      event.target.isContentEditable;

    if (event.code === "Space" && !isEditing) {
      event.preventDefault();
      toggleMetronome();
      return;
    }

    if (!isEditing && event.key === "ArrowUp") {
      event.preventDefault();
      adjustBpm(event.shiftKey ? 10 : 1);
      return;
    }

    if (!isEditing && event.key === "ArrowDown") {
      event.preventDefault();
      adjustBpm(event.shiftKey ? -10 : -1);
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;

    wakeLock.syncVisibility(state.isPlaying && state.wakeLockEnabled).catch(() => {});

    if (state.isPlaying && audio.contextState === "suspended") {
      audio.resume().catch(() => {});
    }
  });

  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (event) => {
    if (!readStorage(STORAGE_KEYS.theme)) {
      applyTheme(event.matches ? "dark" : "light", false);
    }
  });
}

export function createMetronomeApp() {
  restoreSettings();
  applyTheme(getInitialTheme(), false);
  elements.languageSelect.value = i18n.locale;
  wakeRuntimeState = wakeLock.supported ? "idle" : "unsupported";
  applyTranslations();
  setVolume(state.volume * 100, false);
  updateAccentUI();
  bindEvents();
}
