import "./styles.css";
import { createMetronomeApp } from "./app.js";

import { inject } from '@vercel/analytics';
// 初始化 Vercel Analytics
inject();

createMetronomeApp();

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    const serviceWorkerUrl = new URL("sw.js", document.baseURI);
    navigator.serviceWorker.register(serviceWorkerUrl, { scope: "./" }).catch(() => {});
  });
}
