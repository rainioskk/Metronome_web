import "./styles.css";
import { createMetronomeApp, setOfflineState } from "./app.js";
import { inject } from "@vercel/analytics";

inject();
createMetronomeApp();

if (!import.meta.env.PROD) {
  setOfflineState("development");
} else if (!("serviceWorker" in navigator)) {
  setOfflineState("unsupported");
} else {
  window.addEventListener("load", async () => {
    try {
      const serviceWorkerUrl = new URL("sw.js", document.baseURI);
      await navigator.serviceWorker.register(serviceWorkerUrl, { scope: "./", updateViaCache: "none" });
      await navigator.serviceWorker.ready;
      setOfflineState("ready");
    } catch {
      setOfflineState("error");
    }
  });
}
