import test from "node:test";
import assert from "node:assert/strict";
import { MetronomeAudio } from "../src/audio-engine.js";

const config = { bpm: 120, beats: 4, subdivisionOffsets: [0], accentFirstBeat: true, volume: 1 };

function setup(onBeat = () => {}) {
  const timers = new Map();
  let id = 0;
  const clock = { now: 0 };
  globalThis.window = {
    setTimeout(callback, delay) { timers.set(++id, { callback, at: clock.now + delay }); return id; },
    clearTimeout(timer) { timers.delete(timer); },
  };
  const param = () => ({ value: 0, setValueAtTime(value) { this.value = value; },
    setTargetAtTime(value) { this.value = value; }, cancelScheduledValues() {},
    linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} });
  const context = {
    state: "running", destination: {}, voices: [],
    get currentTime() { return clock.now / 1000; },
    createGain() { return { gain: param(), connect() {}, disconnect() {} }; },
    createOscillator() {
      const oscillator = { frequency: param(), connect() {}, disconnect() {},
        start(time) { this.startTime = time; }, stop(time) { this.stopTime = time; }, addEventListener() {} };
      this.voices.push(oscillator);
      return oscillator;
    },
  };
  clock.tick = seconds => {
    const target = clock.now + seconds * 1000;
    while (true) {
      const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > target) break;
      timers.delete(next[0]);
      clock.now = Math.max(clock.now, next[1].at);
      next[1].callback();
    }
    clock.now = target;
  };
  const audio = new MetronomeAudio(onBeat);
  audio.context = context;
  audio.masterGain = context.createGain();
  return { audio, context, clock, timers };
}

test("starting muted then unmuting generates audible clicks without restarting", async () => {
  const { audio, context, clock } = setup();
  await audio.start({ ...config, volume: 0 });
  assert.equal(context.voices.length, 0);
  audio.setVolume(1);
  clock.tick(0.7);
  assert.equal(audio.config.volume, 1);
  assert.ok(context.voices.some(voice => voice.startTime >= 0.5));
  assert.equal(audio.masterGain.gain.value, 1);
});

test("stop cancels an in-flight audio initialization", async () => {
  const { audio, context, timers } = setup();
  let resolve;
  context.state = "suspended";
  context.resume = () => new Promise(done => { resolve = done; });
  const pending = audio.start(config);
  audio.stop();
  resolve();
  assert.equal(await pending, false);
  assert.equal(audio.isPlaying, false);
  assert.equal(context.voices.length, 0);
  assert.equal(timers.size, 0);
});

test("a superseded start cannot overwrite a newer start", async () => {
  const { audio, context } = setup();
  const resolvers = [];
  context.state = "suspended";
  context.resume = () => new Promise(resolve => resolvers.push(resolve));
  const first = audio.start(config);
  const second = audio.start({ ...config, bpm: 90 });
  resolvers[1]();
  assert.equal(await second, true);
  resolvers[0]();
  assert.equal(await first, false);
  assert.equal(audio.config.bpm, 90);
  assert.equal(context.voices.length, 1);
});

test("settings changed during initialization survive its completion", async () => {
  const { audio, context } = setup();
  let resolve;
  context.state = "suspended";
  context.resume = () => new Promise(done => { resolve = done; });
  const pending = audio.start(config);
  audio.update({ ...config, bpm: 80 });
  audio.setVolume(0.2);
  resolve();
  await pending;
  assert.equal(audio.config.bpm, 80);
  assert.equal(audio.config.volume, 0.2);
  assert.ok(Math.abs(audio.masterGain.gain.value - 0.04) < 1e-10);
});

test("a throttled scheduler skips overdue clicks instead of bursting", async () => {
  const beats = [];
  const { audio, context, clock } = setup((index, accent, time) => beats.push(time));
  await audio.start({ ...config, bpm: 240, subdivisionOffsets: [0, .25, .5, .75] });
  const initial = context.voices.length;
  clock.now = 10000;
  clock.tick(0);
  const created = context.voices.slice(initial);
  assert.ok(created.length <= 2);
  assert.ok(created.every(voice => voice.startTime >= 10));
  assert.equal(beats.length, 0, "stale visual callbacks must also be dropped");
  clock.now = 6 * 60 * 60 * 1000;
  clock.tick(0);
  assert.ok(audio.nextNoteTime > context.currentTime);
});

test("changing 1 BPM to 120 BPM promptly retimes the next click", async () => {
  const { audio, clock } = setup();
  await audio.start({ ...config, bpm: 1 });
  clock.tick(1);
  audio.update(config, { reschedule: false });
  const remaining = audio.nextNoteTime - 1;
  assert.ok(remaining > 0.45 && remaining < 0.5);
});

test("tempo changes preserve the elapsed fraction of the current beat", async () => {
  const { audio, clock } = setup();
  await audio.start(config);
  clock.tick(.31);
  audio.update({ ...config, bpm: 60 });
  assert.ok(Math.abs(audio.nextNoteTime - .81) < 1e-9);
});

test("subdivision changes preserve beat phase and the focused beat sequence", async () => {
  const { audio, clock, context } = setup();
  await audio.start(config);
  clock.tick(.26);
  audio.update({ ...config, subdivisionOffsets: [0, .25, .5, .75] });
  assert.equal(audio.beatIndex, 0);
  assert.ok(context.voices.some(voice => Math.abs(voice.startTime - .31) < 1e-9));
  clock.tick(.4);
  assert.ok(context.voices.some(voice => Math.abs(voice.startTime - .56) < 1e-9));
});

test("a change before the first click preserves the initial downbeat", async () => {
  const { audio, clock, context } = setup();
  await audio.start(config);
  clock.tick(.01);
  audio.update({ ...config, bpm: 60 });
  const live = context.voices.filter(voice => voice.stopTime > voice.startTime);
  assert.equal(live.length, 1);
  assert.equal(live[0].startTime, .06);
});

test("stopping clears future audio and visual callbacks", async () => {
  const beats = [];
  const { audio, clock, context, timers } = setup(index => beats.push(index));
  await audio.start(config);
  audio.stop();
  clock.tick(2);
  assert.equal(timers.size, 0);
  assert.equal(beats.length, 0);
  assert.ok(context.voices.every(voice => voice.stopTime <= voice.startTime));
});
