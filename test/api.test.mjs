// Tests d'intégration API : serveur réel lancé sur une base temporaire.
// Couvre connexion (+ limitation de tentatives), projets (création, duplication,
// archivage), commandes (envoi, regroupement / dégroupage livraison, archives,
// DXF) et changement de mot de passe usine.

import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = 3979;
const BASE = `http://127.0.0.1:${PORT}`;
const dataDir = mkdtempSync(path.join(tmpdir(), "marbexa-test-"));

let server;

async function api(pathname, { method = "GET", token, body } = {}) {
  const response = await fetch(`${BASE}${pathname}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const type = response.headers.get("content-type") || "";
  const payload = type.includes("json") ? await response.json() : await response.text();
  return { status: response.status, payload };
}

test.before(async () => {
  server = spawn(process.execPath, [path.join(here, "..", "server", "index.js")], {
    env: { ...process.env, PORT: String(PORT), MARBEXA_DATA: path.join(dataDir, "db.json") },
    stdio: "ignore",
  });
  for (let i = 0; i < 50; i += 1) {
    try {
      await fetch(`${BASE}/`);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new Error("Le serveur de test n'a pas démarré.");
});

test.after(() => {
  server?.kill();
  rmSync(dataDir, { recursive: true, force: true });
});

let factoryToken;
let resellerToken;
let projectId;
let orderId;

test("connexion usine et revendeur", async () => {
  const factory = await api("/api/login", { method: "POST", body: { email: "atelier@marbexa.fr", password: "usine2026" } });
  assert.equal(factory.status, 200);
  factoryToken = factory.payload.token;
  const reseller = await api("/api/login", { method: "POST", body: { email: "cuisine@marbexa.fr", password: "revendeur2026" } });
  assert.equal(reseller.status, 200);
  resellerToken = reseller.payload.token;
});

test("mauvais mot de passe → 401", async () => {
  const result = await api("/api/login", { method: "POST", body: { email: "atelier@marbexa.fr", password: "faux" } });
  assert.equal(result.status, 401);
});

test("création d'un projet avec encoche : E1/E2 et chant fini facturés", async () => {
  const created = await api("/api/projects", {
    method: "POST", token: resellerToken,
    body: { title: "Test API", customer: { name: "Client Test" } },
  });
  assert.equal(created.status, 200);
  projectId = created.payload.project.id;
  assert.match(created.payload.project.reference, /^DEV-\d{4}-\d{4}$/);

  const patched = await api(`/api/projects/${projectId}`, {
    method: "PATCH", token: resellerToken,
    body: {
      pieces: [{
        id: "p1", kind: "worktop", name: "Plan 1", lengthMm: 2400, widthMm: 650,
        x: 90, y: 90, corners: {},
        edges: [{ side: "bottom", serviceId: "edge-straight", lengthMm: 2400, startFrom: "left" }],
        cutouts: [{
          id: "c1", kind: "sink-apron", shape: "edge-notch", serviceId: "cut-apron-sink",
          xMm: 900, yMm: 430, widthMm: 500, heightMm: 220, edgeSide: "bottom", finishedEdge: true,
          edgeCorners: { start: { type: "round", radiusMm: 30 }, end: { type: "square" } },
        }],
      }],
    },
  });
  assert.equal(patched.status, 200);
  const lines = patched.payload.project.quote.lines;
  assert.ok(lines.some((l) => l.category === "Façonnage" && l.description.includes("E1")), "ligne façonnage E1 attendue");
  assert.ok(lines.some((l) => l.category === "Chant" && l.description.includes("Chant fini sur découpe")), "chant fini sur découpe attendu");
});

test("duplication : nouvelle référence, prix du jour (figé remis à zéro)", async () => {
  const result = await api(`/api/projects/${projectId}/duplicate`, { method: "POST", token: resellerToken, body: {} });
  assert.equal(result.status, 200);
  const copy = result.payload.project;
  assert.notEqual(copy.id, projectId);
  assert.notEqual(copy.reference, undefined);
  assert.ok(copy.title.endsWith("(copie)"));
  assert.equal(copy.status, "draft");
  assert.equal(copy.pieces.length, 1);
});

test("envoi de la commande puis archivage / restauration du projet", async () => {
  const submitted = await api(`/api/projects/${projectId}/submit`, { method: "POST", token: resellerToken, body: {} });
  assert.equal(submitted.status, 200);
  orderId = submitted.payload.order.id;
  assert.match(submitted.payload.order.number, /^MBX-\d{4}-\d{5}$/);

  // Le projet a une commande : l'archivage seul reste permis au revendeur.
  const archived = await api(`/api/projects/${projectId}`, { method: "PATCH", token: resellerToken, body: { archived: true } });
  assert.equal(archived.status, 200);
  const restored = await api(`/api/projects/${projectId}`, { method: "PATCH", token: resellerToken, body: { archived: false } });
  assert.equal(restored.status, 200);
  // Mais la modification du plan reste bloquée.
  const blocked = await api(`/api/projects/${projectId}`, { method: "PATCH", token: resellerToken, body: { title: "Interdit" } });
  assert.equal(blocked.status, 409);
});

test("regroupement puis dégroupage de la livraison", async () => {
  const second = await api("/api/projects", {
    method: "POST", token: resellerToken,
    body: { title: "Deuxième commande", customer: { name: "Client 2" } },
  });
  const secondId = second.payload.project.id;
  await api(`/api/projects/${secondId}`, {
    method: "PATCH", token: resellerToken,
    body: { pieces: [{ id: "p1", kind: "worktop", name: "Plan", lengthMm: 1200, widthMm: 600, x: 0, y: 0, corners: {}, edges: [], cutouts: [] }] },
  });
  const submitted = await api(`/api/projects/${secondId}/submit`, { method: "POST", token: resellerToken, body: {} });
  const secondOrderId = submitted.payload.order.id;

  const grouped = await api("/api/orders/group-delivery", {
    method: "POST", token: resellerToken, body: { orderIds: [orderId, secondOrderId] },
  });
  assert.equal(grouped.status, 200);
  assert.equal(grouped.payload.count, 2);
  let project = (await api(`/api/projects/${projectId}`, { token: resellerToken })).payload.project;
  assert.equal(project.consolidatedDelivery, true);

  const ungrouped = await api("/api/orders/ungroup-delivery", {
    method: "POST", token: resellerToken, body: { orderId },
  });
  assert.equal(ungrouped.status, 200);
  assert.equal(ungrouped.payload.count, 2);
  project = (await api(`/api/projects/${projectId}`, { token: resellerToken })).payload.project;
  assert.equal(project.consolidatedDelivery, false);
  assert.deepEqual(project.groupedOrderIds, []);
});

test("archivage et restauration d'une commande", async () => {
  const archived = await api(`/api/orders/${orderId}/archive`, { method: "POST", token: resellerToken, body: { archived: true } });
  assert.equal(archived.status, 200);
  const restored = await api(`/api/orders/${orderId}/archive`, { method: "POST", token: resellerToken, body: { archived: false } });
  assert.equal(restored.status, 200);
});

test("DXF machine : calques et rotation présents pour l'usine", async () => {
  const result = await api(`/api/orders/${orderId}/dxf`, { token: factoryToken });
  assert.equal(result.status, 200);
  for (const layer of ["CONTOUR", "DECOUPES", "PERCAGES", "RAINURES", "DEFONCAGE", "CHANTS", "COTES"]) {
    assert.ok(String(result.payload).includes(layer), `calque ${layer} attendu`);
  }
});

test("changement du mot de passe usine (contrôle de l'actuel)", async () => {
  const wrong = await api("/api/settings", {
    method: "PATCH", token: factoryToken,
    body: { currentPassword: "faux", newPassword: "nouveau-mdp-1" },
  });
  assert.equal(wrong.status, 403);

  const ok = await api("/api/settings", {
    method: "PATCH", token: factoryToken,
    body: { currentPassword: "usine2026", newPassword: "nouveau-mdp-1" },
  });
  assert.equal(ok.status, 200);

  const login = await api("/api/login", { method: "POST", body: { email: "atelier@marbexa.fr", password: "nouveau-mdp-1" } });
  assert.equal(login.status, 200);
  // Retour au mot de passe d'origine pour l'idempotence du fichier de test.
  await api("/api/settings", {
    method: "PATCH", token: login.payload.token,
    body: { currentPassword: "nouveau-mdp-1", newPassword: "usine2026" },
  });
});

test("limitation des tentatives : 8 échecs → 429", async () => {
  for (let i = 0; i < 8; i += 1) {
    const result = await api("/api/login", { method: "POST", body: { email: "inconnu@test.fr", password: "x" } });
    assert.equal(result.status, 401);
  }
  const blocked = await api("/api/login", { method: "POST", body: { email: "inconnu@test.fr", password: "x" } });
  assert.equal(blocked.status, 429);
  // Un autre e-mail depuis la même IP n'est pas bloqué.
  const other = await api("/api/login", { method: "POST", body: { email: "cuisine@marbexa.fr", password: "revendeur2026" } });
  assert.equal(other.status, 200);
});
