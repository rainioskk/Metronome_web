import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { offlineShell } from "../scripts/pwa-plugin.js";

function build(bundle = { "index.html": { type: "asset", source: "<html>app</html>" },
  "assets/app-123.js": { type: "chunk", code: "console.log('app')" },
  "assets/app-456.css": { type: "asset", source: "body{color:black}" } }) {
  const plugin = offlineShell();
  plugin.configResolved({ publicDir: new URL("../public", import.meta.url).pathname });
  let output;
  plugin.generateBundle.call({ emitFile(asset) { output = asset.source; } }, {}, bundle);
  return output;
}

function worker({ failInstall = false, previousAssets = [] } = {}) {
  const handlers = {}, stores = new Map(), deleted = [], precached = [];
  let networkCalls = 0, claimed = false, skipped = false;
  const cache = {
    async addAll(paths) {
      if (failInstall) throw new Error("missing chunk");
      for (const request of paths) {
        assert.equal(request.cache, "reload", "new versions must bypass the HTTP cache");
        const url = request.url;
        precached.push(url);
        stores.set(url, `cached:${url}`);
      }
    },
    async match(request, options) {
      assert.equal(options?.ignoreVary, true, "static precache must match Vary: Origin across request modes");
      return stores.get(typeof request === "string" ? request : request.url);
    },
  };
  const scope = "https://example.test/metronome/";
  const self = { location: { origin: "https://example.test" }, registration: { scope },
    addEventListener(type, callback) { handlers[type] = callback; },
    async skipWaiting() { skipped = true; }, clients: { async claim() { claimed = true; } } };
  const previous = new Map(previousAssets.map(path => [`https://example.test/metronome/${path}`, `previous:${path}`]));
  const caches = { async open(key) {
      if (key.endsWith(":previous")) return { async match(request, options) { assert.equal(options?.ignoreVary, true); return previous.get(request.url); } };
      return cache;
    },
    async keys() { return ["unrelated-cache", "metronome-shell:/other/:old", "metronome-shell:/metronome/:oldest", "metronome-shell:/metronome/:previous"]; },
    async delete(key) { deleted.push(key); } };
  vm.runInNewContext(build(), { self, caches, URL, Request, fetch() { networkCalls++; throw new Error("offline"); } });
  return { precached, deleted, get networkCalls() { return networkCalls; }, get claimed() { return claimed; }, get skipped() { return skipped; },
    async dispatch(type, request) {
      let operation;
      handlers[type]({ request, waitUntil(promise) { operation = promise; }, respondWith(promise) { operation = promise; } });
      return operation;
    } };
}

test("the build precaches HTML, hashed scripts, CSS and every public icon", async () => {
  const instance = worker();
  await instance.dispatch("install");
  for (const path of ["", "assets/app-123.js", "assets/app-456.css", "manifest.webmanifest", "icon-192.png", "icon-512.png", "apple-touch-icon.png"]) {
    assert.ok(instance.precached.includes(`https://example.test/metronome/${path}`));
  }
  assert.equal(instance.skipped, true);
});

test("a missing asset prevents an incomplete offline version from activating", async () => {
  const instance = worker({ failInstall: true });
  await assert.rejects(instance.dispatch("install"), /missing chunk/);
  assert.equal(instance.skipped, false);
  assert.equal(instance.deleted.length, 1, "failed installs must not leave an empty version cache");
  assert.match(instance.deleted[0], /^metronome-shell:\/metronome\/:/);
});

test("activation retains the previous version and only removes this app's older caches", async () => {
  const instance = worker();
  await instance.dispatch("activate");
  assert.deepEqual(instance.deleted, ["metronome-shell:/metronome/:oldest"]);
  assert.equal(instance.claimed, true);
});

test("the first installed version serves navigations and all required assets offline", async () => {
  const instance = worker();
  await instance.dispatch("install");
  const html = await instance.dispatch("fetch", { url: "https://example.test/metronome/?practice=1", method: "GET", mode: "navigate" });
  assert.equal(html, "cached:https://example.test/metronome/");
  const js = await instance.dispatch("fetch", { url: "https://example.test/metronome/assets/app-123.js", method: "GET", mode: "cors" });
  assert.equal(js, "cached:https://example.test/metronome/assets/app-123.js");
  assert.equal(instance.networkCalls, 0);
});

test("API requests, analytics, external requests and non-GET requests bypass caching", async () => {
  const instance = worker();
  for (const request of [
    { url: "https://example.test/api/data", method: "GET", mode: "cors" },
    { url: "https://example.test/_vercel/insights/script.js", method: "GET", mode: "cors" },
    { url: "https://other.test/file.js", method: "GET", mode: "cors" },
    { url: "https://example.test/metronome/", method: "POST", mode: "navigate" },
  ]) assert.equal(await instance.dispatch("fetch", request), undefined);
});

test("cache versions are deterministic and change with HTML, assets or bundled code", () => {
  const bundle = { "index.html": { type: "asset", source: "one" }, "app.js": { type: "chunk", code: "one" } };
  const initial = build(bundle);
  assert.equal(initial, build(bundle));
  bundle["index.html"].source = "two";
  assert.notEqual(initial, build(bundle));
  const htmlChanged = build(bundle);
  bundle["app.js"].code = "two";
  assert.notEqual(htmlChanged, build(bundle));
  assert.ok(!initial.includes("__BUILD_ID__"));
  assert.ok(!initial.includes("__PRECACHE_MANIFEST__"));
});


test("requests from an in-flight old page can still load the previous version's hashed assets", async () => {
  const instance = worker({ previousAssets: ["assets/old-123.js"] });
  await instance.dispatch("install");
  await instance.dispatch("activate");
  const js = await instance.dispatch("fetch", { url: "https://example.test/metronome/assets/old-123.js", method: "GET", mode: "cors" });
  assert.equal(js, "previous:assets/old-123.js");
  assert.equal(instance.networkCalls, 0);
});
