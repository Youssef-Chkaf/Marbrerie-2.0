// Point d'entrée du serveur Marbexa : fichiers statiques + API JSON.
// Aucune dépendance externe — Node 18+ suffit.

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Store } from "./lib/store.js";
import { buildSeed } from "./seed.js";
import { Api } from "./api.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const publicDir = path.join(root, "public");
const sharedDir = path.join(root, "shared");

const PORT = Number(process.env.PORT || 3000);
const DATA_FILE = process.env.MARBEXA_DATA || path.join(root, "data", "db.json");

const store = new Store(DATA_FILE, buildSeed);
store.load({ reset: process.argv.includes("--reset-data") });
if (process.argv.includes("--exit")) {
  console.log("Base réinitialisée :", DATA_FILE);
  process.exit(0);
}
const api = new Api(store);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".dxf": "application/dxf",
};

function serveFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream", "Cache-Control": "no-cache" });
  fs.createReadStream(filePath).pipe(res);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 20 * 1024 * 1024) { reject(new Error("Corps de requête trop volumineux.")); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!chunks.length) return resolve(null);
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
      catch { resolve(null); }
    });
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  try {
    if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/print/")) {
      const body = ["POST", "PATCH", "PUT"].includes(req.method) ? await readBody(req) : null;
      await api.handle(req, res, url, body || {});
      return;
    }

    // Modules partagés servis au navigateur.
    if (url.pathname.startsWith("/shared/")) {
      const filePath = path.join(sharedDir, path.normalize(url.pathname.slice(8)));
      if (filePath.startsWith(sharedDir) && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        return serveFile(res, filePath);
      }
    }

    let filePath = path.join(publicDir, path.normalize(url.pathname === "/" ? "index.html" : url.pathname));
    if (!filePath.startsWith(publicDir)) { res.writeHead(403); return res.end(); }
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      filePath = path.join(publicDir, "index.html"); // SPA fallback
    }
    serveFile(res, filePath);
  } catch (error) {
    console.error(error);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Erreur interne du serveur." }));
  }
});

server.listen(PORT, () => {
  console.log(`Marbexa 2.0 démarré sur http://localhost:${PORT}`);
  console.log("Comptes de démonstration : atelier@marbexa.fr / usine2026 · cuisine@marbexa.fr / revendeur2026");
});
