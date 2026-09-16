const FALLBACK_VIDEO_TYPE = 'video/mp4; codecs="avc1.42000B"';

// A 10x10, two-second H.264 clip with silent black frames. Keeping this as
// inline data avoids network fetches and lets muted iOS playback start from
// a user-gesture callback without an additional request.
const FALLBACK_VIDEO_SOURCE = [
  "data:video/mp4;base64,",
  "AAAAHGZ0eXBtcDQyAAAAAWlzb21tcDQxbXA0MgAAAAFtZGF0AAAAAAAAAYsAAAA6BgUyR1ZK3FxMQz+U78URPNFDqAEAAAMAAQMAAAMAAQIAAE4gCwAAAwAA",
  "AwAAC3IMA4kdAQ3/////gAAAAEwluCABD///h6KAAb/h//h4EQv33333333338f/+Hov1111111111111111111111111111111111111111111111111111",
  "11111114AAAAGSHhBA74kTF/zIEii/9VF/6qL/1UX/qov4AAAAAXIeIIDOpsV/oEyi/9VF/6qL/1UX/qov4AAAAWIeMMCuM/0ChRf+qi/9VF/6qL/1UX8AAA",
  "ABYh5BATjP9AuUX/qov/VRf+qi/9VF/AAAAAFSHlFHjP9AyUX/qov/VRf+qi/9VF/AAAABYh5hgXjP9AzUX/qov/VRf+qi/9VF/AAAAAFiHnHBeM/0DNRf+q",
  "i/9VF/6qL/1UX8AAAAAWIeggF4z/QM1F/6qL/1UX/qov/VRfwAAAABYh6SQXjP9AzUX/qov/VRf+qi/9VF/AAAAC621vb3YAAABsbXZoZAAAAADm0Bhs5tAY",
  "bAAAAlgAAASwAAEAAAEAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIA",
  "AAJ3dHJhawAAAFx0a2hkAAAAAebQGGzm0BhsAAAAAQAAAAAAAASwAAAAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAQAAA",
  "AAAKAAAACgAAAAAAJGVkdHMAAAAcZWxzdAAAAAAAAAABAAAEsAAAAAAAAQAAAAAB721kaWEAAAAgbWRoZAAAAADm0Bhs5tAYbAAAAlgAAASwVcQAAAAAADFo",
  "ZGxyAAAAAAAAAAB2aWRlAAAAAAAAAAAAAAAAQ29yZSBNZWRpYSBWaWRlbwAAAAGWbWluZgAAABR2bWhkAAAAAQAAAAAAAAAAAAAAJGRpbmYAAAAcZHJlZgAA",
  "AAAAAAABAAAADHVybCAAAAABAAABVnN0YmwAAACcc3RzZAAAAAAAAAABAAAAjGF2YzEAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAACgAKAEgAAABIAAAAAAAA",
  "AAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY//8AAAAiYXZjQwFCAAv/4QALJ0IAC6tBhvAuQWIBAAQozjyAAAAACmZpZWwBAAAAAApjaHJt",
  "AAAAAAAYc3R0cwAAAAAAAAABAAAACgAAAHgAAAAUc3RzcwAAAAAAAAABAAAAAQAAABZzZHRwAAAAACAQEBAQEBAQEBAAAAAcc3RzYwAAAAAAAAABAAAAAQAA",
  "AAUAAAABAAAAPHN0c3oAAAAAAAAAAAAAAAoAAACOAAAAHQAAABsAAAAaAAAAGgAAABkAAAAaAAAAGgAAABoAAAAaAAAAGHN0Y28AAAAAAAAAAgAAACwAAAEm",
].join("");

async function releaseSentinel(sentinel) {
  if (!sentinel || sentinel.released) return;

  try {
    await sentinel.release();
  } catch {
    // The browser may have released the sentinel when the page was hidden.
  }
}

function isIOSDevice() {
  if (typeof navigator === "undefined") return false;

  const userAgent = navigator.userAgent || "";
  return (
    /iPad|iPhone|iPod/.test(userAgent) ||
    (/Macintosh/.test(userAgent) && navigator.maxTouchPoints > 1)
  );
}

export class ScreenWakeLock {
  constructor(onStateChange = () => {}) {
    this.onStateChange = onStateChange;
    this.sentinel = null;
    this.nativeRequestId = 0;
    this.fallbackVideo = null;
    this.state = "idle";
    this.desired = false;
    this.requestId = 0;
    this.pendingAcquire = null;
    this.fallbackSupportCache = undefined;
    this.iosDeviceCache = undefined;
  }

  get nativeSupported() {
    return (
      typeof navigator !== "undefined" &&
      typeof navigator.wakeLock?.request === "function"
    );
  }

  get iosDevice() {
    if (this.iosDeviceCache === undefined) {
      this.iosDeviceCache = isIOSDevice();
    }
    return this.iosDeviceCache;
  }

  get nativeAvailable() {
    // iOS 16.4+ exposes Wake Lock, but WebKit's implementation is not a
    // reliable screen-keepalive mechanism. Treat the video fallback as the
    // only wake strategy on iOS and iPadOS.
    return this.nativeSupported && !this.iosDevice;
  }

  get fallbackSupported() {
    if (typeof document === "undefined") return false;
    if (this.fallbackSupportCache !== undefined) {
      return this.fallbackSupportCache;
    }

    this.fallbackSupportCache =
      document.createElement("video").canPlayType(FALLBACK_VIDEO_TYPE) !== "";
    return this.fallbackSupportCache;
  }

  get supported() {
    return this.nativeAvailable || this.fallbackSupported;
  }

  get active() {
    return Boolean(
      (this.sentinel && !this.sentinel.released) ||
        (this.fallbackVideo &&
          !this.fallbackVideo.ended &&
          !this.fallbackVideo.paused)
    );
  }

  setState(nextState) {
    if (this.state === nextState) return;
    this.state = nextState;
    this.onStateChange(nextState);
  }

  isCurrentRequest(requestId) {
    return requestId === this.requestId && requestId > 0;
  }

  trackPendingAcquire(operation) {
    this.pendingAcquire = operation;
    void Promise.resolve(operation).finally(() => {
      if (this.pendingAcquire === operation) this.pendingAcquire = null;
    });
  }

  cleanupFallbackVideo(video = this.fallbackVideo) {
    if (this.fallbackVideo === video) this.fallbackVideo = null;
    if (!video) return;

    video.onerror = null;
    try {
      video.pause();
    } catch {
      // Media cleanup should continue even if playback already stopped.
    }
    try {
      video.src = "";
    } catch {
      // Some WebKit versions throw when resetting a detached media source.
    }
    video.remove();
  }

  createFallbackVideo(requestId) {
    const video = document.createElement("video");

    // Keep a visible 1x1 pixel because iOS suspends display:none and
    // zero-sized videos. playsinline is required for WebApp and iPadOS.
    video.muted = true;
    video.defaultMuted = true;
    video.volume = 0;
    video.loop = true;
    video.playsInline = true;
    video.setAttribute("muted", "");
    video.setAttribute("loop", "");
    video.setAttribute("playsinline", "");
    video.setAttribute("webkit-playsinline", "");
    video.setAttribute("preload", "auto");
    video.setAttribute("aria-hidden", "true");
    video.setAttribute("tabindex", "-1");
    video.dataset.wakeLockFallback = "true";
    video.dataset.requestId = String(requestId);
    video.src = FALLBACK_VIDEO_SOURCE;

    Object.assign(video.style, {
      position: "fixed",
      bottom: "0",
      right: "0",
      width: "1px",
      height: "1px",
      opacity: "0.01",
      pointerEvents: "none",
      zIndex: "-9999",
    });

    video.onerror = () => {
      if (
        this.fallbackVideo !== video ||
        !this.isCurrentRequest(requestId) ||
        !this.desired
      ) {
        return;
      }

      if (this.sentinel && !this.sentinel.released) {
        this.cleanupFallbackVideo(video);
        return;
      }

      this.cleanupFallbackVideo(video);
      this.setState("error");
    };

    return video;
  }

  ensureFallbackVideo(requestId) {
    if (!this.fallbackSupported) return null;

    if (this.fallbackVideo) {
      this.fallbackVideo.dataset.requestId = String(requestId);
      return this.fallbackVideo;
    }

    const video = this.createFallbackVideo(requestId);
    this.fallbackVideo = video;

    // Mounting must be synchronous with the click callback. Using appendChild
    // instead of .append() keeps older iOS WebViews on the expected path.
    document.body.appendChild(video);
    return video;
  }

  handleFallbackPlayFailure(video, requestId, error) {
    if (error?.name === "AbortError") {
      // pause() can interrupt an unresolved play() promise. If this request is
      // still current and no native lock owns the pause, expose idle so the
      // next visibilitychange or click can restart it.
      if (
        this.fallbackVideo === video &&
        this.isCurrentRequest(requestId) &&
        this.desired &&
        !this.sentinel &&
        video.paused
      ) {
        this.setState("idle");
      }
      return;
    }

    if (
      this.fallbackVideo !== video ||
      !this.isCurrentRequest(requestId) ||
      !this.desired
    ) {
      return;
    }

    if (this.sentinel && !this.sentinel.released) {
      // The native lock is healthy, so the failed fallback decoder can be
      // removed without changing the externally visible active state.
      this.cleanupFallbackVideo(video);
      return;
    }

    this.cleanupFallbackVideo(video);
    this.setState("error");
  }

  playFallbackSafely(video, requestId) {
    if (!video) return Promise.resolve(false);

    let playPromise;
    try {
      // play() must be called synchronously here. Do not move this call behind
      // an await or a native Wake Lock rejection callback.
      playPromise = video.play();
    } catch (error) {
      this.handleFallbackPlayFailure(video, requestId, error);
      return Promise.resolve(false);
    }

    this.setState("active");
    return Promise.resolve(playPromise).then(
      () => {
        if (
          this.fallbackVideo === video &&
          this.isCurrentRequest(requestId) &&
          this.desired
        ) {
          this.setState("active");
          return true;
        }
        return false;
      },
      (error) => {
        this.handleFallbackPlayFailure(video, requestId, error);
        return false;
      }
    );
  }

  pauseFallbackVideo() {
    if (this.iosDevice) return;

    const video = this.fallbackVideo;
    if (!video) return;

    try {
      video.pause();
    } catch {
      // The video may already be paused by iOS when the tab was hidden.
    }
  }

  handleNativeSuccess(sentinel, requestId) {
    if (!this.isCurrentRequest(requestId) || !this.desired) {
      void releaseSentinel(sentinel);
      return false;
    }

    if (!sentinel || sentinel.released) {
      // Treat an already-released sentinel as a native failure; the fallback
      // video started earlier remains the active mechanism.
      return false;
    }

    this.sentinel = sentinel;
    this.nativeRequestId = requestId;

    try {
      sentinel.addEventListener(
        "release",
        () => this.handleNativeRelease(sentinel),
        { once: true }
      );
    } catch {
      this.sentinel = null;
      this.nativeRequestId = 0;
      void releaseSentinel(sentinel);
      return false;
    }

    // The fallback video already holds the screen awake while the native
    // request settles. Once the native lock is active, pause the redundant
    // decoder to save battery while keeping the element available for later
    // sentinel-loss recovery.
    this.pauseFallbackVideo();
    this.setState("active");
    return true;
  }

  handleNativeFailure(_error, requestId) {
    if (!this.isCurrentRequest(requestId) || !this.desired) return false;

    // The cooperative flow deliberately leaves a successfully started video
    // untouched here. It remains the fallback mechanism.
    if (this.fallbackVideo) return true;

    this.setState("error");
    return false;
  }

  requestNativeLock(requestId) {
    if (!this.nativeAvailable) return null;

    let requestPromise;
    try {
      // This call is made in the same synchronous stack as video.play(), so
      // iOS user activation remains available to both APIs.
      requestPromise = navigator.wakeLock.request("screen");
    } catch (error) {
      this.handleNativeFailure(error, requestId);
      return null;
    }

    if (!requestPromise || typeof requestPromise.then !== "function") {
      this.handleNativeFailure(new Error("Wake Lock request is not thenable"), requestId);
      return null;
    }

    return Promise.resolve(requestPromise).then(
      (sentinel) => this.handleNativeSuccess(sentinel, requestId),
      (error) => this.handleNativeFailure(error, requestId)
    );
  }

  acquireCurrent(requestId) {
    const video = this.ensureFallbackVideo(requestId);
    const fallbackPromise = video
      ? this.playFallbackSafely(video, requestId)
      : Promise.resolve(false);

    // Order matters: video.play() above and wakeLock.request() below must both
    // be reached before this function yields to the microtask queue.
    const nativePromise = this.requestNativeLock(requestId);

    if (nativePromise) return nativePromise;
    if (video) return fallbackPromise;

    if (!this.nativeAvailable) {
      this.setState("unsupported");
    } else {
      this.setState("error");
    }
    return Promise.resolve(false);
  }

  async acquire() {
    if (!this.supported) {
      this.setState("unsupported");
      return false;
    }

    if (this.sentinel && !this.sentinel.released) {
      this.pauseFallbackVideo();
      this.setState("active");
      return true;
    }

    if (this.state === "requesting" && this.pendingAcquire) {
      return this.pendingAcquire;
    }

    this.desired = true;
    const requestId = ++this.requestId;
    this.setState("requesting");

    // acquireCurrent must execute synchronously inside this call. It starts
    // the fallback video and issues the native request before any await point.
    const operation = this.acquireCurrent(requestId);
    this.trackPendingAcquire(operation);
    return operation;
  }

  async release() {
    this.desired = false;
    const requestId = ++this.requestId;
    const sentinel = this.sentinel;
    const video = this.fallbackVideo;

    this.sentinel = null;
    this.nativeRequestId = 0;
    this.fallbackVideo = null;
    this.setState("idle");

    // Clean the media element before awaiting native release. The browser can
    // safely reject an unresolved play() promise with AbortError here.
    this.cleanupFallbackVideo(video);
    await releaseSentinel(sentinel);
  }

  handleNativeRelease(sentinel) {
    if (this.sentinel !== sentinel) return;

    const requestId = this.nativeRequestId;
    this.sentinel = null;
    this.nativeRequestId = 0;

    if (!this.desired || !this.isCurrentRequest(requestId)) {
      this.setState("idle");
      return;
    }

    if (document.visibilityState !== "visible") {
      // syncVisibility() will restart the cooperative flow when visible again.
      this.setState("idle");
      return;
    }

    this.setState("requesting");
    const operation = this.acquireCurrent(requestId);
    this.trackPendingAcquire(operation);
  }

  async syncVisibility(shouldBeActive) {
    this.desired = shouldBeActive;
    if (!shouldBeActive || document.visibilityState !== "visible") {
      return false;
    }

    return this.acquire();
  }
}
