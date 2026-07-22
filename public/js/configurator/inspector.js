// Inspecteur latéral de la pièce sélectionnée : géométrie, rotation,
// déplacement précis, matière propre, position en vue crédence, détails.

import { state, currentProject } from "../state.js";
import { esc, number } from "../ui.js";
import { register } from "../actions.js";
import { saveProject } from "./index.js";
import { openDetailEditor } from "./details.js";
import { plateDims } from "/shared/plan.js";

const activeMaterials = () => state.data.catalog.materials.filter((m) => m.active);

export function renderInspector(project, piece) {
  const isWall = piece.kind === "wall";
  const material = activeMaterials().find((m) => m.id === (piece.materialId || project.materialId));
  const walls = project.pieces.filter((p) => p.kind === "wall");
  const cfg = state.configurator;
  const kindLabels = { worktop: "Plan de travail", splashback: "Crédence", panel: "Panneau", wall: "Mur", cabinet: "Meuble" };

  const pieceFinish = piece.finish || project.finish;
  const finishes = [...new Map((material?.variants || []).map((v) => [v.finish, v.finishLabel || v.finish])).entries()];
  const thicknesses = (material?.variants || []).filter((v) => v.finish === pieceFinish).map((v) => v.thicknessMm).sort((a, b) => a - b);
  const dims = plateDims(material, pieceFinish, piece.thicknessMm || project.thicknessMm);
  const materialSection = isWall ? "" : `
    <div class="inspector-section"><h4>Matière de cet élément</h4>
      ${piece.materialId ? `<button class="btn btn-small btn-ghost" data-action="piece-use-main">Utiliser la matière principale</button>` : `<p class="help">Matière principale du projet.</p>`}
      <label>Coloris<select data-piece-field="materialId">
        <option value="">— matière principale —</option>
        ${activeMaterials().map((m) => `<option value="${m.id}" ${piece.materialId === m.id ? "selected" : ""}>${esc(m.brand)} · ${esc(m.color)}</option>`).join("")}</select></label>
      <label>Finition<select data-piece-field="finish">
        <option value="">— comme le projet —</option>
        ${finishes.map(([code, label]) => `<option value="${esc(code)}" ${piece.finish === code ? "selected" : ""}>${esc(label)}</option>`).join("")}</select></label>
      <label>Épaisseur<select data-piece-field="thicknessMm">
        <option value="">— comme le projet (${esc(project.thicknessMm)} mm) —</option>
        ${thicknesses.map((t) => `<option value="${t}" ${Number(piece.thicknessMm) === t ? "selected" : ""}>${t} mm</option>`).join("")}</select></label>
      <p class="help">Plaque maxi : ${dims ? `${number(dims.maxLengthMm)} × ${number(dims.maxWidthMm)} mm` : "—"}</p>
    </div>`;

  const wallSection = ["splashback", "panel"].includes(piece.kind) ? `
    <div class="inspector-section"><h4>Position en vue crédence</h4>
      <label>Mur associé<select data-piece-field="wallId">
        <option value="">— aucun —</option>
        ${walls.map((wall) => `<option value="${wall.id}" ${piece.wallId === wall.id ? "selected" : ""}>${esc(wall.name)}</option>`).join("")}</select></label>
      <div class="form-grid">
        <label>Depuis la gauche du mur<input type="number" data-piece-field="wallOffsetMm" value="${esc(piece.wallOffsetMm || 0)}"></label>
        <label>Hauteur depuis le sol<input type="number" data-piece-field="heightFromFloorMm" value="${esc(piece.heightFromFloorMm || 0)}"></label>
      </div>
      ${piece.wallId ? `<button class="btn btn-small btn-dark" data-action="cfg-credence-view" data-wall="${piece.wallId}">Voir en vue Crédence</button>` : ""}
    </div>` : "";

  const detailCount = `${(piece.cutouts || []).length} découpe(s) · ${(piece.edges || []).length} chant(s) travaillé(s)`;

  return `<aside class="inspector">
    <div class="inspector-head"><div><h3>${esc(piece.name || kindLabels[piece.kind])}</h3>
      <small>${esc(kindLabels[piece.kind])} · dimensions en mm</small></div>
      <button class="icon-btn inspector-close" data-action="deselect-piece">×</button></div>

    <div class="inspector-section"><h4>Géométrie</h4>
      <label>Nom<input data-piece-field="name" value="${esc(piece.name || "")}"></label>
      <div class="form-grid">
        <label>Longueur<input type="number" min="10" data-piece-field="lengthMm" value="${esc(piece.lengthMm)}"></label>
        <label>${isWall ? "Épaisseur" : "Largeur"}<input type="number" min="10" data-piece-field="widthMm" value="${esc(piece.widthMm)}"></label>
      </div>
    </div>

    <div class="inspector-section rotation-panel"><h4>Rotation</h4>
      <div class="rotation-controls" style="display:flex;align-items:center;gap:10px">
        <button class="rotation-arrow" data-action="rotate-piece" data-deg="-90" title="Quart de tour à gauche">↺</button>
        <strong class="rotation-main">${piece.rotationDeg || 0}°</strong>
        <button class="rotation-arrow" data-action="rotate-piece" data-deg="90" title="Quart de tour à droite">↻</button>
        <button class="btn btn-small btn-ghost" data-action="rotate-piece" data-deg="reset">Revenir à 0°</button>
      </div>
      <div class="rotation-custom form-grid">
        <label>Angle libre<input type="number" id="free-angle" value="${esc(cfg.freeAngle)}" min="1" max="359"></label>
        <div style="display:flex;gap:7px;align-items:end">
          <button class="btn btn-small btn-soft" data-action="rotate-piece" data-deg="free-left">↺ Gauche</button>
          <button class="btn btn-small btn-soft" data-action="rotate-piece" data-deg="free-right">Droite ↻</button>
        </div>
      </div>
    </div>

    <div class="inspector-section nudge-controls"><h4>Déplacer précisément de</h4>
      <div class="form-grid"><label><input type="number" id="nudge-step" value="${esc(cfg.nudgeMm)}" min="1"> <small>mm</small></label></div>
      <div class="rotation-directions" style="display:grid;grid-template-columns:1fr 1fr;gap:7px">
        <button class="btn btn-small" data-action="nudge-piece" data-dir="left">← Gauche</button>
        <button class="btn btn-small" data-action="nudge-piece" data-dir="right">Droite →</button>
        <button class="btn btn-small" data-action="nudge-piece" data-dir="up">↑ Haut</button>
        <button class="btn btn-small" data-action="nudge-piece" data-dir="down">Bas ↓</button>
      </div>
      <p class="help">Les angles se règlent dans « Modifier découpes & chants » en cliquant sur leurs repères.</p>
    </div>

    ${materialSection}
    ${wallSection}

    ${isWall ? "" : `<div class="inspector-section"><h4>Détails</h4>
      <p class="help">${detailCount}</p>
      <button class="btn btn-dark" style="width:100%" data-action="open-details">Modifier découpes & chants</button>
    </div>`}

    <div class="inspector-section">
      <button class="btn btn-ghost btn-danger" style="width:100%" data-action="delete-piece">Supprimer cet élément</button>
    </div>
  </aside>`;
}

export function handlePieceField(input) {
  const project = currentProject();
  const piece = project?.pieces.find((p) => p.id === state.configurator?.selectedPieceId);
  if (!piece || input.dataset.pieceField === undefined) return false;
  const field = input.dataset.pieceField;
  const numeric = ["lengthMm", "widthMm", "wallOffsetMm", "heightFromFloorMm", "thicknessMm"];
  let value = input.value;
  if (numeric.includes(field)) value = value === "" ? null : Math.max(0, Math.round(Number(value)));
  if (["materialId", "wallId", "finish"].includes(field)) value = value || null;
  if (value === null && field !== "materialId" && field !== "wallId" && field !== "thicknessMm") return true;
  piece[field] = value;
  if (field === "lengthMm") {
    for (const edge of piece.edges || []) {
      if (["top", "bottom"].includes(edge.side) && edge.lengthMm > value) edge.lengthMm = value;
    }
  }
  saveProject();
  return true;
}

register({
  "deselect-piece": () => {
    state.configurator.selectedPieceId = null;
    window.dispatchEvent(new Event("marbexa:render"));
  },
  "piece-use-main": () => {
    const project = currentProject();
    const piece = project.pieces.find((p) => p.id === state.configurator.selectedPieceId);
    piece.materialId = null;
    piece.thicknessMm = null;
    saveProject();
    window.dispatchEvent(new Event("marbexa:render"));
  },
  "rotate-piece": (el) => {
    const project = currentProject();
    const piece = project.pieces.find((p) => p.id === state.configurator.selectedPieceId);
    if (!piece) return;
    const mode = el.dataset.deg;
    const free = Number(document.querySelector("#free-angle")?.value || state.configurator.freeAngle || 45);
    state.configurator.freeAngle = free;
    if (mode === "reset") piece.rotationDeg = 0;
    else if (mode === "free-left") piece.rotationDeg = ((piece.rotationDeg || 0) - free + 360) % 360;
    else if (mode === "free-right") piece.rotationDeg = ((piece.rotationDeg || 0) + free) % 360;
    else piece.rotationDeg = ((piece.rotationDeg || 0) + Number(mode) + 360) % 360;
    saveProject();
    window.dispatchEvent(new Event("marbexa:render"));
  },
  "nudge-piece": (el) => {
    const project = currentProject();
    const piece = project.pieces.find((p) => p.id === state.configurator.selectedPieceId);
    if (!piece) return;
    const step = Number(document.querySelector("#nudge-step")?.value || 15);
    state.configurator.nudgeMm = step;
    const px = step * 0.12; // conversion mm → unités écran
    if (el.dataset.dir === "left") piece.x -= px;
    if (el.dataset.dir === "right") piece.x += px;
    if (el.dataset.dir === "up") piece.y -= px;
    if (el.dataset.dir === "down") piece.y += px;
    saveProject();
    window.dispatchEvent(new Event("marbexa:render"));
  },
  "open-details": () => openDetailEditor(state.configurator.selectedPieceId),
  "delete-piece": () => {
    const project = currentProject();
    const piece = project.pieces.find((p) => p.id === state.configurator.selectedPieceId);
    if (!piece) return;
    if (!confirm(`Supprimer « ${piece.name || piece.kind} » ?`)) return;
    project.pieces = project.pieces.filter((p) => p.id !== piece.id);
    state.configurator.selectedPieceId = null;
    saveProject();
    window.dispatchEvent(new Event("marbexa:render"));
  },
});
