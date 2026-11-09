// Bundles the Thunderbird MailExtension into dist/ with esbuild, and (with --xpi) packs
// dist/ into a .xpi. The background and message-display scripts are classic scripts (IIFE);
// the options page is loaded as an ES module.
import { build, context } from "esbuild";
import { cpSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const dist = resolve(here, "dist");
const watch = process.argv.includes("--watch");
const xpi = process.argv.includes("--xpi");

const engine = resolve(here, "../engine/src/index.ts");

const common = {
  bundle: true,
  sourcemap: false,
  target: ["firefox115"], // Thunderbird 128 ESR is built on Gecko 128; this is a safe floor.
  logLevel: "info",
  alias: { "@impersonation-guard/engine": engine },
  loader: { ".json": "json" },
  define: { "process.env.NODE_ENV": '"production"' },
};

const jobs = [
  { entryPoints: [resolve(here, "src/background.ts")], outfile: resolve(dist, "background.js"), format: "iife" },
  { entryPoints: [resolve(here, "src/message-display.ts")], outfile: resolve(dist, "message-display.js"), format: "iife" },
  { entryPoints: [resolve(here, "src/options.ts")], outfile: resolve(dist, "options.js"), format: "esm" },
];

function copyStatic() {
  cpSync(resolve(here, "manifest.json"), resolve(dist, "manifest.json"));
  for (const dir of ["static", "icons"]) {
    const p = resolve(here, dir);
    if (existsSync(p)) cpSync(p, dist, { recursive: true });
  }
}

function packXpi() {
  const out = resolve(here, "impersonation-guard-thunderbird.xpi");
  rmSync(out, { force: true });
  // A .xpi is a plain zip of the dist contents (manifest.json at the root).
  execFileSync("zip", ["-r", "-FS", "-X", out, "."], { cwd: dist, stdio: "inherit" });
  console.log("packed", out);
}

if (watch) {
  const ctxs = await Promise.all(jobs.map((j) => context({ ...common, ...j })));
  await Promise.all(ctxs.map((c) => c.watch()));
  copyStatic();
  console.log("watching...");
} else {
  rmSync(dist, { recursive: true, force: true });
  mkdirSync(dist, { recursive: true });
  await Promise.all(jobs.map((j) => build({ ...common, ...j })));
  copyStatic();
  console.log("built", dist);
  if (xpi) packXpi();
}
