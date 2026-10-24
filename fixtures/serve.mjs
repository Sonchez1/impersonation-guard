// Tiny static server for the demo pages: `node fixtures/serve.mjs` then open
// http://localhost:8765/fixtures/demo-inbox.html or /fixtures/demo-login.html.
import { createServer } from "node:http";
import { createReadStream, statSync } from "node:fs";
import { extname, join, normalize, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.PORT ?? 8765);
const types = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".wasm": "application/wasm",
  ".png": "image/png", ".svg": "image/svg+xml", ".gz": "application/gzip", ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8", ".traineddata": "application/octet-stream",
};

createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${port}`);
  let path = decodeURIComponent(url.pathname);
  if (path === "/") path = "/fixtures/demo-inbox.html";
  const file = normalize(join(root, path));
  if (!file.startsWith(root)) { res.writeHead(403); return res.end("forbidden"); }
  let st;
  try { st = statSync(file); } catch { res.writeHead(404); return res.end("not found: " + path); }
  if (st.isDirectory()) { res.writeHead(403); return res.end("directory"); }
  res.writeHead(200, { "Content-Type": types[extname(file)] ?? "application/octet-stream", "Content-Length": st.size, "Cache-Control": "no-store" });
  createReadStream(file).pipe(res);
}).listen(port, () => {
  console.log(`demo server: http://localhost:${port}/fixtures/demo-inbox.html  (root ${root})`);
});
