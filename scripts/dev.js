// Static server for web/, the same files GitHub Pages serves.
import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../web/", import.meta.url));
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png" };

http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const p = normalize(url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, "");
  try {
    const data = await readFile(join(root, p));
    res.setHeader("content-type", types[extname(p)] || "application/octet-stream");
    res.end(data);
  } catch {
    res.statusCode = 404;
    res.end("not found");
  }
}).listen(process.env.PORT || 3000, () => console.log(`skywatch on http://localhost:${process.env.PORT || 3000}`));
