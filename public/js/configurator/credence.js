// Vue « Crédences · vues des murs » : élévation de face d'un mur avec les
// crédences et panneaux associés, positionnés en mm depuis le sol.

import { state, currentProject } from "../state.js";
import { esc, number } from "../ui.js";
import { register } from "../actions.js";
import { makePiece } from "/shared/plan.js";
import { saveProject } from "./index.js";
import { renderInspector } from "./inspector.js";

const WALL_HEIGHT_DEFAULT = 2500;

export function renderCredenceView(project) {
  const cfg = state.configurator;
  const walls = project.pieces.filter((p) => p.kind === "wall");
  if (!walls.length) {
    return `<div class="workspace" style="padding:26px"><div class="empty"><p>Ajoutez d'abord un mur dans la vue d'ensemble pour ouvrir la vue crédence.</p>
      <button class="btn btn-primary" data-action="cfg-step" data-step="design">← Retour au dessin</button></div></div>`;
  }
  const wall = walls.find((w) => w.id === cfg.wallViewId) || walls[0];
  cfg.wallViewId = wall.id;
  const wallHeight = Number(wall.heightMm || WALL_HEIGHT_DEFAULT);
  const attached = project.pieces.filter((p) => ["splashback", "panel"].includes(p.kind) && p.wallId === wall.id);
  const selected = project.pieces.find((p) => p.id === cfg.selectedPieceId);

  const viewW = 860;
  const scale = Math.min(viewW / wall.lengthMm, 460 / wallHeight);
  const w = wall.lengthMm * scale;
  const h = wallHeight * scale;
  const ox = (viewW - w) / 2;
  const oy = 20;

  const shapes = attached.map((piece) => {
    const px = ox + Number(piece.wallOffsetMm || 0) * scale;
    const pw = piece.lengthMm * scale;
    const ph = piece.widthMm * scale;
    const py = oy + h - (Number(piece.heightFromFloorMm || 0) + piece.widthMm) * scale;
    const isSelected = piece.id === cfg.selectedPieceId;
    const cuts = (piece.cutouts || []).map((cut) => {
      const cx = px + cut.xMm * scale;
      const cy = py + cut.yMm * scale;
      if (cut.shape === "circle") return `<circle cx="${cx + cut.widthMm * scale / 2}" cy="${cy + cut.heightMm * scale / 2}" r="${Math.max(3, cut.widthMm * scale / 2)}" fill="none" stroke="#b0492c" stroke-width="2"/>`;
      return `<rect x="${cx}" y="${cy}" width="${Math.max(4, cut.widthMm * scale)}" height="${Math.max(4, cut.heightMm * scale)}" rx="3" fill="none" stroke="#b0492c" stroke-width="2"/>`;
    }).join("");
    return `<g class="elevation-piece" data-piece="${piece.id}" style="cursor:pointer">
      <rect x="${px}" y="${py}" width="${pw}" height="${ph}" rx="3" fill="#d9c9b6" stroke="${isSelected ? "#c75b39" : "#2e7d5b"}" stroke-width="${isSelected ? 3 : 2}"/>
      ${cuts}
      <text x="${px + 6}" y="${py + 16}" font-size="12" fill="#40433e">${esc(piece.name)} · ${number(piece.lengthMm)} × ${number(piece.widthMm)} mm · ${number(piece.heightFromFloorMm || 0)} mm du sol</text></g>`;
  }).join("");

  return `
  <div class="elevation-layout" style="display:grid;grid-template-columns:230px 1fr ${selected ? "330px" : ""};gap:0">
    <aside class="sidebar" style="position:static;padding:18px">
      <h3 class="elevation-title">Crédences · vues des murs</h3>
      <div class="elevation-list" style="display:grid;gap:7px;margin:12px 0">
        ${walls.map((item) => `<button class="btn btn-small ${item.id === wall.id ? "btn-primary" : "btn-ghost"}" data-action="cfg-credence-view" data-wall="${item.id}">▤ ${esc(item.name)}</button>`).join("")}
      </div>
      <h4 style="margin-top:16px">Ajouter sur ce mur</h4>
      <div style="display:grid;gap:7px;margin-top:8px">
        <button class="btn btn-small btn-soft" data-action="add-on-wall" data-kind="splashback">▨ Crédence</button>
        <button class="btn btn-small btn-soft" data-action="add-on-wall" data-kind="panel">▤ Panneau</button>
      </div>
      <div class="ai-safety-note" style="margin-top:16px"><strong>Positionnement</strong>
        <span>Les crédences et panneaux s'ajoutent ici. Réglez leur décalage depuis la gauche du mur et leur hauteur depuis le sol ; l'association reste modifiable dans l'inspecteur.</span></div>
    </aside>
    <div class="drawing-area" style="padding:16px">
      <div class="canvas-label" style="display:flex;justify-content:space-between">
        <span>${esc(wall.name)} · vue Crédence de face</span>
        <span>${number(wall.lengthMm)} × ${number(wallHeight)} mm</span>
      </div>
      <div class="form-grid" style="max-width:280px;margin:8px 0"><label>Hauteur du mur (mm)<input type="number" data-wall-height="${wall.id}" value="${esc(wallHeight)}"></label></div>
      <svg class="elevation-canvas" viewBox="0 0 ${viewW} ${oy * 2 + h + 16}" width="100%" style="background:repeating-linear-gradient(0deg,transparent,transparent 23px,#eee6da 24px),repeating-linear-gradient(90deg,transparent,transparent 23px,#eee6da 24px)">
        <rect x="${ox}" y="${oy}" width="${w}" height="${h}" fill="#f4ece1" stroke="#8a8d86" stroke-width="2" class="elevation-wall"/>
        <line x1="${ox - 12}" y1="${oy + h}" x2="${ox + w + 12}" y2="${oy + h}" stroke="#20231f" stroke-width="3" class="elevation-ground"/>
        <text x="${ox + w + 4}" y="${oy + h + 14}" font-size="11" fill="#6c6f6a">sol</text>
        ${shapes || `<text x="${ox + w / 2 - 130}" y="${oy + h / 2}" font-size="14" fill="#8a8d86" class="elevation-empty">Aucune crédence ou panneau associé à ce mur.</text>`}
      </svg>
    </div>
    ${selected ? renderInspector(project, selected) : ""}
  </div>`;
}

export function bindCredence(root) {
  root.querySelectorAll(".elevation-piece").forEach((el) => {
    el.addEventListener("click", () => {
      state.configurator.selectedPieceId = el.dataset.piece;
      window.dispatchEvent(new Event("marbexa:render"));
    });
  });
}

export function handleWallHeight(input) {
  if (input.dataset.wallHeight === undefined) return false;
  const project = currentProject();
  const wall = project.pieces.find((p) => p.id === input.dataset.wallHeight);
  if (wall) { wall.heightMm = Number(input.value); saveProject(); window.dispatchEvent(new Event("marbexa:render")); }
  return true;
}

register({
  "add-on-wall": (el) => {
    const project = currentProject();
    const cfg = state.configurator;
    const wall = project.pieces.find((p) => p.id === cfg.wallViewId);
    if (!wall) return;
    const kind = el.dataset.kind;
    const count = project.pieces.filter((p) => p.kind === kind).length + 1;
    const piece = makePiece(kind, {
      name: `${kind === "splashback" ? "Crédence" : "Panneau"} ${count}`,
      wallId: wall.id,
      wallOffsetMm: 0,
      heightFromFloorMm: kind === "splashback" ? 900 : 0,
      lengthMm: Math.min(wall.lengthMm, kind === "splashback" ? 2400 : 900),
      x: (wall.x || 80) + 10,
      y: (wall.y || 80) + 20,
    });
    project.pieces.push(piece);
    cfg.selectedPieceId = piece.id;
    saveProject();
    window.dispatchEvent(new Event("marbexa:render"));
  },
});
