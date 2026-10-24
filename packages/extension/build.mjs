// Bundles the extension into dist/ with esbuild. Content scripts are IIFEs (Chrome does
// not load them as modules); the service worker, popup and options page are ES modules.
import { build, context } from "esbuild";
import { cpSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dist = resolve(here, "dist");
const watch = process.argv.includes("--watch");

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

const common = {
  bundle: true,
  sourcemap: false,
  target: ["chrome120"],
  logLevel: "info",
  alias: { "@impersonation-guard/engine": resolve(here, "../engine/src/index.ts") },
  loader: { ".json": "json" },
  define: { "process.env.NODE_ENV": '"production"' },
};

const jobs = [
  { entryPoints: [resolve(here, "src/background.ts")], outfile: resolve(dist, "background.js"), format: "esm" },
  { entryPoints: [resolve(here, "src/content/gmail.ts")], outfile: resolve(dist, "content-gmail.js"), format: "iife" },
  { entryPoints: [resolve(here, "src/content/outlook.ts")], outfile: resolve(dist, "content-outlook.js"), format: "iife" },
  { entryPoints: [resolve(here, "src/content/forms.ts")], outfile: resolve(dist, "content-forms.js"), format: "iife" },
  { entryPoints: [resolve(here, "src/popup/popup.ts")], outfile: resolve(dist, "popup.js"), format: "esm" },
  { entryPoints: [resolve(here, "src/options/options.ts")], outfile: resolve(dist, "options.js"), format: "esm" },
  { entryPoints: [resolve(here, "src/demo/demo.ts")], outfile: resolve(dist, "demo.js"), format: "iife" },
];

function copyStatic() {
  for (const f of ["manifest.json"]) cpSync(resolve(here, f), resolve(dist, f));
  for (const dir of ["static", "icons"]) {
    const p = resolve(here, dir);
    if (existsSync(p)) cpSync(p, dist, { recursive: true });
  }
}

if (watch) {
  const ctxs = await Promise.all(jobs.map((j) => context({ ...common, ...j })));
  await Promise.all(ctxs.map((c) => c.watch()));
  copyStatic();
  console.log("watching...");
} else {
  await Promise.all(jobs.map((j) => build({ ...common, ...j })));
  copyStatic();
  console.log("built", dist);
}
