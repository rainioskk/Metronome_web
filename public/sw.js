const CACHE_PREFIX = `metronome-shell:${new URL(self.registration.scope).pathname}:`;
const CACHE_NAME = `${CACHE_PREFIX}__BUILD_ID__`;
const APP_SHELL = /* __PRECACHE_MANIFEST__ */ [];
const APP_URL = new URL("./", self.registration.scope).href;
const ASSET_PATH = new URL("./assets/", self.registration.scope).pathname;
const SHELL_URLS = new Set(APP_SHELL.map(path => new URL(path, self.registration.scope).href));

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // Installation succeeds only when the complete version is available offline.
    try {
      await cache.addAll(APP_SHELL.map(path => new Request(
        new URL(path, self.registration.scope), { cache: "reload" }
      )));
    } catch (error) {
      await caches.delete(CACHE_NAME);
      throw error;
    }
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    // A navigation can receive old HTML just before controllerchange. Retain
    // the previous version so its in-flight hashed asset requests still work.
    const previous = keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME);
    await Promise.all(previous.slice(0, -1).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  const navigation = request.mode === "navigate";
  const versionedAsset = url.pathname.startsWith(ASSET_PATH);
  if (!navigation && !versionedAsset && !SHELL_URLS.has(url.href)) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    // Serve HTML and its hashed assets from the same installed version. The
    // next service worker install fetches a fresh, complete shell atomically.
    // The shell is public static content; preview hosts may add Vary: Origin,
    // which differs between installation fetches and module requests.
    const cached = await cache.match(navigation ? APP_URL : request, { ignoreVary: true });
    if (cached) return cached;
    if (versionedAsset) {
      const previous = (await caches.keys()).filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME);
      for (const key of previous.reverse()) {
        const old = await (await caches.open(key)).match(request, { ignoreVary: true });
        if (old) return old;
      }
    }
    return fetch(request);
  })());
});
