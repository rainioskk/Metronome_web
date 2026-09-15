export class ScreenWakeLock {
  constructor(onStateChange = () => {}) {
    this.onStateChange = onStateChange;
    this.sentinel = null;
    this.state = "idle";
    this.requestId = 0;
  }

  get supported() {
    const wakeLockApi = navigator.wakeLock;
    return (
      "wakeLock" in navigator &&
      wakeLockApi !== null &&
      typeof wakeLockApi?.request === "function"
    );
  }

  setState(state) {
    if (this.state === state) return;
    this.state = state;
    this.onStateChange(state);
  }

  async acquire() {
    if (!this.supported) {
      this.setState("unsupported");
      return false;
    }

    if (this.sentinel && !this.sentinel.released) {
      this.setState("active");
      return true;
    }

    const requestId = ++this.requestId;
    this.setState("requesting");

    try {
      const sentinel = await navigator.wakeLock.request("screen");

      if (requestId !== this.requestId) {
        await sentinel.release();
        return false;
      }

      this.sentinel = sentinel;
      sentinel.addEventListener(
        "release",
        () => {
          if (this.sentinel !== sentinel) return;
          this.sentinel = null;
          this.setState("idle");
        },
        { once: true }
      );
      this.setState("active");
      return true;
    } catch {
      this.sentinel = null;
      this.setState("error");
      return false;
    }
  }

  async release() {
    this.requestId += 1;
    const sentinel = this.sentinel;
    this.sentinel = null;
    this.setState("idle");

    if (sentinel && !sentinel.released) {
      try {
        await sentinel.release();
      } catch {
        // Browsers can release the sentinel automatically when the page is hidden.
      }
    }
  }

  async syncVisibility(shouldBeActive) {
    if (!shouldBeActive || document.visibilityState !== "visible" || this.sentinel) return;
    await this.acquire();
  }
}
