import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

export function offlineShell() {
  let publicDir;
  return {
    name: "metronome-offline-shell",
    apply: "build",
    enforce: "post",
    configResolved(config) { publicDir = config.publicDir; },
    generateBundle(_options, bundle) {
      const hash = createHash("sha256");
      const paths = ["./"];
      const template = readFileSync(resolve(publicDir, "sw.js"), "utf8");
      hash.update(template);
      function collect(directory, prefix = "") {
        for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
          const name = `${prefix}${entry.name}`;
          if (entry.isDirectory()) collect(resolve(directory, entry.name), `${name}/`);
          else if (name !== "sw.js") {
            paths.push(`./${name}`);
            hash.update(name).update(readFileSync(resolve(directory, entry.name)));
          }
        }
      }
      collect(publicDir);
      for (const [name, output] of Object.entries(bundle).sort(([a], [b]) => a.localeCompare(b))) {
        if (name !== "index.html") paths.push(`./${name}`);
        hash.update(name).update(output.type === "chunk" ? output.code : output.source);
      }
      this.emitFile({
        type: "asset", fileName: "sw.js",
        source: template.replace("__BUILD_ID__", hash.digest("hex").slice(0, 16))
          .replace("/* __PRECACHE_MANIFEST__ */ []", JSON.stringify(paths)),
      });
    },
  };
}
