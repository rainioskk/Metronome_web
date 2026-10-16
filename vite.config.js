import { defineConfig } from "vite";

import { offlineShell } from "./scripts/pwa-plugin.js";

export default defineConfig({
  plugins: [offlineShell()],
  base: "./",
  build: {
    target: "es2022",
  },
});
