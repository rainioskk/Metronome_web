import test from "node:test";
import assert from "node:assert/strict";
import { TapTempo, TempoTrainer, normalizeTrainer, readPresets } from "../src/practice.js";
import { practiceMessages } from "../src/practice-i18n.js";
import { SUPPORTED_LOCALES } from "../src/i18n.js";

const settings = { enabled: true, everyBars: 2, step: 7, target: 130 };
const preset = { version: 1, id: "one", name: "Slow practice", bpm: 120, subdivisionId: "quarter", accentInterval: 4, accentFirstBeat: true, volume: .5, trainer: settings };

test("tap tempo averages recent taps, ignores double clicks and resets after a gap", () => {
  const tap = new TapTempo();
  assert.equal(tap.tap(0), null);
  assert.equal(tap.tap(500), 120);
  assert.equal(tap.tap(520), null);
  assert.equal(tap.tap(1000), 120);
  assert.equal(tap.tap(5000), null);
  assert.equal(tap.tap(6000), 60);
  assert.equal(tap.tap(6500), 80);
});

test("tap tempo clamps to the supported BPM range", () => {
  const tap = new TapTempo();
  tap.tap(0);
  assert.equal(tap.tap(100), 240);
});

test("trainer increments only after complete bars and clamps at its target", () => {
  const trainer = new TempoTrainer();
  let bpm = 120, time = 0;
  const downbeats = [];
  for (let beat = 0; beat <= 16; beat++) {
    const index = beat % 4;
    bpm = trainer.beat(index, bpm, time, settings);
    if (index === 0) downbeats.push(bpm);
    time += 60 / bpm;
  }
  assert.deepEqual(downbeats, [120, 120, 127, 127, 130]);
  assert.equal(trainer.beat(0, 150, time, settings), 150, "never slow down to a lower target");
});

test("trainer resets its count on pause, disable and missing background beats", () => {
  const trainer = new TempoTrainer();
  trainer.beat(0, 120, 0, settings);
  trainer.beat(0, 120, 10, settings);
  assert.equal(trainer.bars, 0);
  trainer.reset();
  assert.equal(trainer.beat(0, 120, 11, settings), 120);
  trainer.beat(0, 120, 12, { ...settings, enabled: false });
  assert.equal(trainer.started, false);
});

test("trainer settings recover safely from corrupt or out-of-range storage", () => {
  assert.deepEqual(normalizeTrainer(null), { enabled: false, everyBars: 4, step: 5, target: 160 });
  assert.deepEqual(normalizeTrainer({ enabled: "true", everyBars: -1, step: 999, target: Infinity }),
    { enabled: false, everyBars: 1, step: 40, target: 160 });
});

test("presets round-trip settings and reject invalid or duplicate records", () => {
  assert.deepEqual(readPresets(JSON.stringify([preset])), [preset]);
  assert.deepEqual(readPresets("corrupt"), []);
  assert.deepEqual(readPresets('{"bpm":120}'), []);
  assert.deepEqual(readPresets(JSON.stringify([null, { ...preset, bpm: 999 }, preset, preset])), [preset]);
  assert.deepEqual(readPresets(JSON.stringify([{ ...preset, subdivisionId: "unknown" }])), []);
  assert.equal(readPresets(JSON.stringify(Array.from({ length: 15 }, (_, i) => ({ ...preset, id: String(i) })))).length, 10);
});

test("all practice tools have translations and matching placeholders in every locale", () => {
  const english = practiceMessages.en;
  for (const locale of SUPPORTED_LOCALES) {
    assert.deepEqual(Object.keys(practiceMessages[locale]).sort(), Object.keys(english).sort());
    for (const key of Object.keys(english)) {
      const placeholders = text => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
      assert.deepEqual(placeholders(practiceMessages[locale][key]), placeholders(english[key]));
    }
  }
});
