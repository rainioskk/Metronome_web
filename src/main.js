import "./styles.css";
import { createMetronomeApp } from "./app.js";

createMetronomeApp();

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    const serviceWorkerUrl = new URL("sw.js", document.baseURI);
    navigator.serviceWorker.register(serviceWorkerUrl, { scope: "./" }).catch(() => {});
  });
}
