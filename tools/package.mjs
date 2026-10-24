// Zips packages/extension/dist into store/impersonation-guard-<version>.zip for the Chrome
// Web Store. The zip must contain manifest.json at its root, not inside a folder.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(root, "packages/extension/dist");
if (!existsSync(resolve(dist, "manifest.json"))) {
  console.error("dist/manifest.json missing: run `npm run build` first");
  process.exit(1);
}
const version = JSON.parse(readFileSync(resolve(dist, "manifest.json"), "utf8")).version;
const out = resolve(root, `store/impersonation-guard-${version}.zip`);
mkdirSync(resolve(root, "store"), { recursive: true });
rmSync(out, { force: true });
// Exclude the demo bundles and macOS metadata; the store package only needs the extension.
execFileSync("zip", ["-r", "-q", "-X", out, ".", "-x", "demo.js", "demo-popup.js", ".DS_Store", "*/.DS_Store"], { cwd: dist, stdio: "inherit" });
const mb = (statSync(out).size / 1024 / 1024).toFixed(1);
console.log(`wrote ${out} (${mb} MB)`);
