import {
  ACCENT_INTERVALS,
  BPM_MAX,
  BPM_MIN,
  DEFAULT_ACCENT_FIRST_BEAT,
  DEFAULT_ACCENT_INTERVAL,
  DEFAULT_BPM,
  DEFAULT_SUBDIVISION,
  DEFAULT_VOLUME,
  DEFAULT_WAKE_LOCK,
  STORAGE_KEYS,
  SUBDIVISIONS,
  TEMPO_MARKINGS,
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

// Older releases stored the subdivision as a numeric clicks-per-beat value.
const LEGACY_SUBDIVISIONS = {
  1: "quarter",
  2: "eighth",
  3: "triplet",
  4: "sixteenth",
};

function noteMarkup(x, top = 6.2) {
  return [
    `<ellipse cx="${x}" cy="17.2" rx="2.25" ry="1.75" transform="rotate(-18 ${x} 17.2)" fill="currentColor" stroke="none"></ellipse>`,
    `<path d="M${x + 1.8} 16.5V${top}" stroke="currentColor" stroke-width="1.35" stroke-linecap="round"></path>`,
  ].join("");
}

function beamMarkup(x1, x2, y, width = 1.45) {
  return `<path d="M${x1 + 1.8} ${y}H${x2 + 1.8}" stroke="currentColor" stroke-width="${width}" stroke-linecap="round"></path>`;
}

const SUBDIVISION_ICON_MARKUP = {
  quarter: noteMarkup(12),
  eighth: [
    noteMarkup(7, 5.6),
    noteMarkup(18, 5.6),
    beamMarkup(7, 18, 5.6),
  ].join(""),
  dottedEighth: [
    noteMarkup(4, 5.6),
    noteMarkup(18, 5.6),
    beamMarkup(4, 18, 5.6),
    '<circle cx="12.5" cy="16.9" r="1.15" fill="currentColor" stroke="none"></circle>',
  ].join(""),
  triplet: [
    noteMarkup(3.5, 7.4),
    noteMarkup(12, 7.4),
    noteMarkup(20.5, 7.4),
    beamMarkup(3.5, 20.5, 7.4, 1.25),
    '<text x="12" y="4.8" text-anchor="middle" font-size="5.8" font-weight="800" fill="currentColor" stroke="none">3</text>',
  ].join(""),
  sixteenth: [
    noteMarkup(3, 5.2),
    noteMarkup(9, 5.2),
    noteMarkup(15, 5.2),
    noteMarkup(21, 5.2),
    beamMarkup(3, 21, 5.2, 1.35),
    beamMarkup(3, 21, 8.2, 1.35),
  ].join(""),
};

function subdivisionIconMarkup(subdivision) {
  const markup =
    SUBDIVISION_ICON_MARKUP[subdivision.icon] ??
    SUBDIVISION_ICON_MARKUP.quarter;

  return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${markup}</svg>`;
}

const elements = {
  languageSelect: document.querySelector("#languageSelect"),
  themeToggle: document.querySelector("#themeToggle"),
  wakeLockToggle: document.querySelector("#wakeLockToggle"),
  wakeStateLabel: document.querySelector("#wakeStateLabel"),
  bpmInput: document.querySelector("#bpmInput"),
  tempoRange: document.querySelector("#tempoRange"),
  tempoMark: document.querySelector("#tempoMark"),
  tempoMarkMeaning: document.querySelector("#tempoMarkMeaning"),
  tempoMarkingOptions: document.querySelector("#tempoMarkingOptions"),
  decreaseTempo: document.querySelector("#decreaseTempo"),
  increaseTempo: document.querySelector("#increaseTempo"),
  subdivisionOptions: document.querySelector("#subdivisionOptions"),
  accentToggle: document.querySelector("#accentToggle"),
  accentIntervalValue: document.querySelector("#accentIntervalValue"),
  decreaseAccentInterval: document.querySelector("#decreaseAccentInterval"),
  increaseAccentInterval: document.querySelector("#increaseAccentInterval"),
  audioState: document.querySelector("#audioState"),
  beatLamp: document.querySelector("#beatLamp"),
  playButton: document.querySelector("#playButton"),
  playText: document.querySelector("#playText"),
  volumeRange: document.querySelector("#volumeRange"),
  volumeOutput: document.querySelector("#volumeOutput"),
};

const i18n = createI18n(readStorage(STORAGE_KEYS.language));
let wakeRuntimeState = "idle";
let activeTempoMarkingId = null;
let beatFlashTimer = 0;

const state = {
  bpm: DEFAULT_BPM,
  subdivisionId: DEFAULT_SUBDIVISION,
  accentFirstBeat: DEFAULT_ACCENT_FIRST_BEAT,
  accentInterval: DEFAULT_ACCENT_INTERVAL,
  wakeLockEnabled: DEFAULT_WAKE_LOCK,
  volume: DEFAULT_VOLUME / 100,
  isPlaying: false,
  theme: "light",
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function currentSubdivision() {
  return (
    SUBDIVISIONS.find((subdivision) => subdivision.id === state.subdivisionId) ??
    SUBDIVISIONS[0]
  );
}

function audioSnapshot() {
  return {
    bpm: state.bpm,
    beats: state.accentInterval,
    subdivisionOffsets: currentSubdivision().offsets,
    accentFirstBeat: state.accentFirstBeat,
    volume: state.volume,
  };
}

function tempoMarkingName(marking) {
  return i18n.t(`tempo.markings.${marking.id}.name`);
}

function tempoMarkingMeaning(marking) {
  return i18n.t(`tempo.markings.${marking.id}.meaning`);
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
    mark: tempoMarkingName(getTempoMarking(state.bpm)),
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
  const markingName = tempoMarkingName(marking);
  const markingMeaning = tempoMarkingMeaning(marking);

  elements.bpmInput.value = String(state.bpm);
  elements.tempoRange.value = String(state.bpm);
  elements.tempoRange.setAttribute(
    "aria-valuetext",
    `${state.bpm} BPM · ${markingName}`
  );
  elements.tempoMark.textContent = markingName;
  elements.tempoMark.setAttribute(
    "aria-label",
    i18n.t("tempo.markAria", {
      name: markingName,
      min: marking.min,
      max: marking.max,
    })
  );
  elements.tempoMarkMeaning.textContent = markingMeaning;
  elements.tempoMarkMeaning.setAttribute(
    "title",
    i18n.t("tempo.markingMeaningAria", {
      name: markingName,
      meaning: markingMeaning,
    })
  );

  updateTempoMarkingSelection(marking);
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
  elements.beatLamp.dataset.state = state.isPlaying ? "playing" : "idle";

  if (state.isPlaying) {
    elements.audioState.textContent = i18n.t("audio.playing", { bpm: state.bpm });
  } else {
    elements.audioState.textContent = i18n.t("audio.ready");
    clearCurrentBeat();
  }

  updateDocumentTitle();
}

function renderTempoMarkings() {
  elements.tempoMarkingOptions.replaceChildren();

  TEMPO_MARKINGS.forEach((marking) => {
    const button = document.createElement("button");
    const name = document.createElement("span");
    const range = document.createElement("small");
    const markingName = tempoMarkingName(marking);
    const markingMeaning = tempoMarkingMeaning(marking);

    button.type = "button";
    button.dataset.tempoMarking = marking.id;
    button.setAttribute("role", "radio");
    button.setAttribute("aria-checked", "false");
    button.setAttribute(
      "aria-label",
      i18n.t("tempo.markingSelectAria", {
        name: markingName,
        recommended: marking.recommendedBpm,
      })
    );
    button.setAttribute(
      "title",
      i18n.t("tempo.markingMeaningAria", {
        name: markingName,
        meaning: markingMeaning,
      })
    );

    name.className = "tempo-marking-name";
    name.textContent = markingName;
    range.className = "tempo-marking-range";
    range.textContent = i18n.t("tempo.markingRange", {
      min: marking.min,
      max: marking.max,
    });

    button.append(name, range);
    button.addEventListener("click", () => selectTempoMarking(marking.id));
    elements.tempoMarkingOptions.append(button);
  });
}

function updateTempoMarkingSelection(marking) {
  const activeButton = elements.tempoMarkingOptions.querySelector(
    `[data-tempo-marking="${marking.id}"]`
  );

  elements.tempoMarkingOptions
    .querySelectorAll("[data-tempo-marking]")
    .forEach((button) => {
      const isActive = button === activeButton;
      button.setAttribute("aria-checked", String(isActive));
    });

  if (activeButton && activeTempoMarkingId !== marking.id) {
    activeTempoMarkingId = marking.id;
    activeButton.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
      block: "nearest",
      inline: "center",
    });
  }
}

function selectTempoMarking(markingId) {
  const marking = TEMPO_MARKINGS.find((item) => item.id === markingId);
  if (!marking) return;

  setBpm(marking.recommendedBpm);
}

function renderSubdivisions() {
  elements.subdivisionOptions.replaceChildren();

  SUBDIVISIONS.forEach((subdivision) => {
    const button = document.createElement("button");
    const icon = document.createElement("span");
    const label = document.createElement("small");
    const name = i18n.t(`subdivision.${subdivision.id}`);

    button.type = "button";
    button.dataset.subdivision = subdivision.id;
    button.setAttribute("role", "radio");
    button.setAttribute("aria-checked", String(subdivision.id === state.subdivisionId));
    button.setAttribute("aria-label", name);
    button.setAttribute("title", name);

    icon.className = "subdivision-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.innerHTML = subdivisionIconMarkup(subdivision);
    label.textContent = name;
    button.append(icon, label);
    elements.subdivisionOptions.append(button);
  });
}

function selectSubdivision(subdivisionId) {
  if (
    !SUBDIVISIONS.some((subdivision) => subdivision.id === subdivisionId) ||
    subdivisionId === state.subdivisionId
  ) {
    return;
  }

  state.subdivisionId = subdivisionId;
  renderSubdivisions();
  writeStorage(STORAGE_KEYS.subdivision, subdivisionId);

  if (state.isPlaying) {
    audio.update(audioSnapshot());
  }
}

function updateAccentUI() {
  const minInterval = Math.min(...ACCENT_INTERVALS);
  const maxInterval = Math.max(...ACCENT_INTERVALS);
  const intervalLabel = i18n.t("accent.intervalAria", {
    count: state.accentInterval,
  });

  elements.accentToggle.setAttribute("aria-checked", String(state.accentFirstBeat));
  elements.accentToggle.dataset.enabled = String(state.accentFirstBeat);
  elements.accentIntervalValue.textContent = String(state.accentInterval);
  elements.accentIntervalValue.setAttribute("aria-label", intervalLabel);
  elements.decreaseAccentInterval.disabled = state.accentInterval <= minInterval;
  elements.increaseAccentInterval.disabled = state.accentInterval >= maxInterval;
}

function setAccentFirstBeat(enabled) {
  state.accentFirstBeat = Boolean(enabled);
  updateAccentUI();
  writeStorage(STORAGE_KEYS.accentFirstBeat, state.accentFirstBeat);

  if (state.isPlaying) {
    audio.update(audioSnapshot(), { reschedule: false });
  }
}

function setAccentInterval(rawValue) {
  const interval = Number.parseInt(rawValue, 10);
  if (!ACCENT_INTERVALS.includes(interval) || interval === state.accentInterval) {
    updateAccentUI();
    return;
  }

  state.accentInterval = interval;
  writeStorage(STORAGE_KEYS.accentInterval, interval);
  updateAccentUI();

  if (state.isPlaying) {
    audio.update(audioSnapshot());
  }
}

function adjustAccentInterval(delta) {
  const currentIndex = ACCENT_INTERVALS.indexOf(state.accentInterval);
  if (currentIndex === -1) return;

  const nextIndex = clamp(
    currentIndex + delta,
    0,
    ACCENT_INTERVALS.length - 1
  );

  setAccentInterval(ACCENT_INTERVALS[nextIndex]);
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
  elements.tempoMarkingOptions.setAttribute(
    "aria-label",
    i18n.t("tempo.markings.groupAria")
  );

  applyStaticTranslations();
  renderTempoMarkings();
  renderSubdivisions();
  updateAccentUI();
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
  window.clearTimeout(beatFlashTimer);
  beatFlashTimer = 0;
  elements.beatLamp.classList.remove("is-beating", "is-accent");
}

function triggerVisualBeat(_beatIndex, accent) {
  const lamp = elements.beatLamp;

  window.clearTimeout(beatFlashTimer);
  lamp.classList.remove("is-beating");
  lamp.classList.toggle("is-accent", accent);
  void lamp.offsetWidth;
  lamp.classList.add("is-beating");
  beatFlashTimer = window.setTimeout(() => lamp.classList.remove("is-beating"), 130);
}

function restoreSettings() {
  state.bpm = clamp(readNumber(STORAGE_KEYS.bpm, DEFAULT_BPM), BPM_MIN, BPM_MAX);

  const savedSubdivision = readStorage(STORAGE_KEYS.subdivision);
  state.subdivisionId = SUBDIVISIONS.some(
    (subdivision) => subdivision.id === savedSubdivision
  )
    ? savedSubdivision
    : LEGACY_SUBDIVISIONS[savedSubdivision] ?? DEFAULT_SUBDIVISION;
  state.accentFirstBeat = readBoolean(
    STORAGE_KEYS.accentFirstBeat,
    DEFAULT_ACCENT_FIRST_BEAT
  );
  const savedAccentInterval = readNumber(
    STORAGE_KEYS.accentInterval,
    DEFAULT_ACCENT_INTERVAL
  );
  state.accentInterval = ACCENT_INTERVALS.includes(savedAccentInterval)
    ? savedAccentInterval
    : DEFAULT_ACCENT_INTERVAL;
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
  elements.decreaseAccentInterval.addEventListener("click", () => adjustAccentInterval(-1));
  elements.increaseAccentInterval.addEventListener("click", () => adjustAccentInterval(1));

  elements.tempoRange.addEventListener("input", (event) => setBpm(event.target.value));
  elements.bpmInput.addEventListener("change", (event) => setBpm(event.target.value));
  elements.bpmInput.addEventListener("blur", () => {
    elements.bpmInput.value = String(state.bpm);
  });
  elements.bpmInput.addEventListener("focus", (event) => event.target.select());

  elements.decreaseTempo.addEventListener("click", () => adjustBpm(-1));
  elements.increaseTempo.addEventListener("click", () => adjustBpm(1));

  elements.subdivisionOptions.addEventListener("click", (event) => {
    const button = event.target.closest("[data-subdivision]");
    if (button) selectSubdivision(button.dataset.subdivision);
  });

  elements.volumeRange.addEventListener("input", (event) => setVolume(event.target.value));
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
