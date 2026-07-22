// Étape 2 · Dessin : vue d'ensemble SVG avec outils, glisser-déposer,
// accrochage entre pièces et inspecteur latéral.

import { state, currentProject } from "../state.js";
import { esc, number } from "../ui.js";
import { register } from "../actions.js";
import { makePiece, plateDims } from "/shared/plan.js";
import { saveProject } from "./index.js";
import { renderInspector } from "./inspector.js";

export const SCALE = 0.12;

const pieceBox = (piece) => ({
  w: Math.max(26, piece.lengthMm * SCALE),
  h: piece.kind === "wall" ? 9 : Math.max(18, piece.widthMm * SCALE),
});

function pieceSvg(piece, selected) {
  const { w, h } = pieceBox(piece);
  const x = piece.x || 0;
  const y = piece.y || 0;
  const rotation = piece.rotationDeg ? ` transform="rotate(${piece.rotationDeg} ${x + w / 2} ${y + h / 2})"` : "";
  if (piece.kind === "wall") {
    return `<g class="overview-piece" data-piece="${piece.id}"${rotation} style="cursor:move">
      <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="3" fill="#3d403b" ${selected ? 'stroke="#c75b39" stroke-width="2"' : ""}/>
      <text x="${x + 4}" y="${y - 4}" class="wall-label" font-size="10" fill="#6c6f6a">${esc(piece.name || "Mur")}</text></g>`;
  }
  const scaleX = w / piece.lengthMm;
  const scaleY = h / piece.widthMm;
  const cuts = (piece.cutouts || []).map((cut) => {
    const cx = x + cut.xMm * scaleX;
    const cy = y + cut.yMm * scaleY;
    const cw = Math.max(4, cut.widthMm * scaleX);
    const ch = Math.max(4, cut.heightMm * scaleY);
    if (cut.shape === "circle") return `<circle cx="${cx + cw / 2}" cy="${cy + ch / 2}" r="${Math.max(2.5, cw / 2)}" class="overview-cut" fill="none" stroke="#b0492c" stroke-width="1.8"/>`;
    if (cut.shape === "grooves") {
      const grooves = Math.max(2, Number(cut.grooves || 5));
      let lines = "";
      for (let i = 0; i < grooves; i += 1) {
        lines += `<line x1="${cx}" y1="${cy + ch / (grooves - 1) * i}" x2="${cx + cw}" y2="${cy + ch / (grooves - 1) * i}" stroke="#b0492c" stroke-width="1.4" class="overview-groove"/>`;
      }
      return lines;
    }
    return `<rect x="${cx}" y="${cy}" width="${cw}" height="${ch}" rx="2" class="overview-cut" fill="none" stroke="#b0492c" stroke-width="1.8"/>`;
  }).join("");
  const edges = (piece.edges || []).map((edge) => {
    const points = edge.side === "top" ? [x, y, x + w, y]
      : edge.side === "bottom" ? [x, y + h, x + w, y + h]
      : edge.side === "left" ? [x, y, x, y + h]
      : [x + w, y, x + w, y + h];
    return `<line x1="${points[0]}" y1="${points[1]}" x2="${points[2]}" y2="${points[3]}" class="overview-finished-edge-path" stroke="#2e7d5b" stroke-width="3"/>`;
  }).join("");
  const fill = piece.kind === "splashback" ? "#e4d5bf" : "#d9c9b6";
  const stroke = selected ? "#c75b39" : piece.kind === "splashback" ? "#8a6d3b" : "#2e7d5b";
  const badge = piece.needsReview ? `<text x="${x + 4}" y="${y + 12}" font-size="10" fill="#b0492c">⚠ à vérifier</text>` : "";
  return `<g class="overview-piece" data-piece="${piece.id}"${rotation} style="cursor:move">
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="3" class="overview-piece-fill" fill="${fill}" stroke="${stroke}" stroke-width="${selected ? 2.6 : 2}"/>
    ${cuts}${edges}${badge}
    <text x="${x + 4}" y="${y - 5}" font-size="10" fill="#40433e">${esc(piece.name || "")}</text>
    <title>${esc(piece.name || piece.kind)}</title></g>
    ${selected ? `<g><rect x="${x - 3}" y="${y + h + 6}" width="${Math.max(120, w)}" height="16" rx="8" fill="#20231f"/><text x="${x + 5}" y="${y + h + 18}" font-size="10" fill="#fff">${number(piece.lengthMm)} × ${number(piece.widthMm)} mm · ${piece.rotationDeg || 0}°</text></g>` : ""}`;
}

export function renderDesignStep(project) {
  const cfg = state.configurator;
  const selected = project.pieces.find((p) => p.id === cfg.selectedPieceId);
  const material = state.data.catalog.materials.find((m) => m.id === project.materialId);
  const transform = `translate(${cfg.panX || 0} ${cfg.panY || 0}) scale(${cfg.zoom || 1})`;

  return `
  <div class="material-strip" style="padding:9px 18px;display:flex;gap:12px;align-items:center;background:var(--paper,#fbfaf7);border-bottom:1px solid #e2ded6;flex-wrap:wrap">
    <span class="material-chip">Matière principale : <strong>${esc(material ? `${material.brand} · ${material.color}` : "—")}</strong> · ${esc(project.thicknessMm)} mm · ${esc(project.finish)}</span>
    <span class="help">${(() => { const d = plateDims(material, project.finish, project.thicknessMm); return d ? `Plaque maxi : ${number(d.maxLengthMm)} × ${number(d.maxWidthMm)} mm` : ""; })()}</span>
    <button class="btn btn-small btn-ghost" data-action="cfg-step" data-step="material">Changer</button>
    <button class="btn btn-small btn-soft" data-action="cfg-credence-view">Crédences · vues des murs</button>
  </div>
  <div class="design-layout">
    <div class="tool-rail">
      <button class="tool-btn" data-action="add-piece" data-kind="worktop" title="Ajouter un plan de travail"><span>▭</span>Plan</button>
      <button class="tool-btn" data-action="add-piece" data-kind="wall" title="Ajouter un mur"><span>╱</span>Mur</button>
      <button class="tool-btn" data-action="add-piece" data-kind="splashback" title="Ajouter une crédence"><span>▨</span>Crédence</button>
      <button class="tool-btn" data-action="add-piece" data-kind="panel" title="Ajouter un panneau"><span>▤</span>Panneau</button>
      <button class="tool-btn" data-action="cfg-zoom" data-dir="in" title="Zoomer"><span>+</span>Zoom</button>
      <button class="tool-btn" data-action="cfg-zoom" data-dir="out" title="Réduire"><span>−</span>Réduire</button>
      <button class="tool-btn" data-action="cfg-center" title="Centrer"><span>⌖</span>Centrer</button>
      <div class="zoom-value">${Math.round((cfg.zoom || 1) * 100)} %</div>
    </div>
    <div class="drawing-area">
      <div class="canvas-label" style="pointer-events:none;z-index:5">Vue d'ensemble · glissez le fond pour déplacer la vue · molette pour zoomer · glissez une pièce pour la déplacer, déplacement lent pour l'accrochage</div>
      <svg id="overview-canvas" class="canvas" width="100%" height="620" style="touch-action:none">
        <g id="canvas-root" transform="${transform}">
          ${project.pieces.map((piece) => pieceSvg(piece, piece.id === cfg.selectedPieceId)).join("")}
        </g>
      </svg>
    </div>
    ${selected ? renderInspector(project, selected) : `
      <aside class="inspector"><div class="inspector-head"><h3>Aucune sélection</h3></div>
      <div class="inspector-section"><p class="help">Cliquez sur une pièce pour l'inspecter, ou ajoutez un plan, un mur, une crédence ou un panneau avec la barre d'outils.</p>
      ${(state.lastIssues || []).length ? `<div class="warning" style="margin-top:10px"><strong>Points de contrôle</strong><ul>${state.lastIssues.slice(0, 8).map((issue) => `<li>${esc(issue)}</li>`).join("")}</ul></div>` : ""}
      </div></aside>`}
  </div>`;
}

// ---------- Interactions pointeur (déplacement, accrochage, pan, zoom) ----------

let drag = null;

export function bindCanvas(root) {
  const svg = root.querySelector("#overview-canvas");
  if (!svg) return;
  const cfg = state.configurator;

  const svgPoint = (event) => {
    const rect = svg.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left - (cfg.panX || 0)) / (cfg.zoom || 1),
      y: (event.clientY - rect.top - (cfg.panY || 0)) / (cfg.zoom || 1),
    };
  };

  svg.addEventListener("pointerdown", (event) => {
    const pieceEl = event.target.closest("[data-piece]");
    const project = currentProject();
    if (!project) return;
    svg.setPointerCapture(event.pointerId);
    if (pieceEl) {
      const piece = project.pieces.find((p) => p.id === pieceEl.dataset.piece);
      cfg.selectedPieceId = piece.id;
      const point = svgPoint(event);
      drag = { type: "piece", piece, offsetX: point.x - (piece.x || 0), offsetY: point.y - (piece.y || 0), moved: false };
      window.dispatchEvent(new Event("marbexa:render"));
    } else {
      drag = { type: "pan", startX: event.clientX - (cfg.panX || 0), startY: event.clientY - (cfg.panY || 0) };
    }
  });

  svg.addEventListener("pointermove", (event) => {
    if (!drag) return;
    if (drag.type === "pan") {
      cfg.panX = event.clientX - drag.startX;
      cfg.panY = event.clientY - drag.startY;
      svg.querySelector("#canvas-root")?.setAttribute("transform", `translate(${cfg.panX} ${cfg.panY}) scale(${cfg.zoom || 1})`);
      return;
    }
    const point = svgPoint(event);
    const piece = drag.piece;
    let nx = point.x - drag.offsetX;
    let ny = point.y - drag.offsetY;
    // Accrochage : bords des autres pièces (déplacement lent = précision).
    const { w, h } = pieceBox(piece);
    const project = currentProject();
    const threshold = 7;
    for (const other of project.pieces) {
      if (other.id === piece.id) continue;
      const ob = pieceBox(other);
      const ox = other.x || 0; const oy = other.y || 0;
      for (const snapX of [ox, ox + ob.w, ox - w, ox + ob.w - w]) {
        if (Math.abs(nx - snapX) < threshold) nx = snapX;
      }
      for (const snapY of [oy, oy + ob.h, oy - h, oy + ob.h - h]) {
        if (Math.abs(ny - snapY) < threshold) ny = snapY;
      }
    }
    piece.x = Math.round(nx);
    piece.y = Math.round(ny);
    drag.moved = true;
    // Mise à jour directe sans re-render complet pour rester fluide.
    const g = svg.querySelector(`[data-piece="${piece.id}"]`);
    if (g) {
      const rect = g.querySelector("rect");
      const dx = piece.x - Number(rect.getAttribute("x"));
      const dy = piece.y - Number(rect.getAttribute("y"));
      if (dx || dy) window.requestAnimationFrame(() => window.dispatchEvent(new Event("marbexa:render-canvas")));
    }
  });

  const endDrag = () => {
    if (drag?.type === "piece" && drag.moved) {
      saveProject();
      window.dispatchEvent(new Event("marbexa:render"));
    }
    drag = null;
  };
  svg.addEventListener("pointerup", endDrag);
  svg.addEventListener("pointercancel", endDrag);

  svg.addEventListener("wheel", (event) => {
    event.preventDefault();
    const factor = event.deltaY < 0 ? 1.1 : 0.9;
    cfg.zoom = Math.min(3, Math.max(0.3, (cfg.zoom || 1) * factor));
    svg.querySelector("#canvas-root")?.setAttribute("transform", `translate(${cfg.panX || 0} ${cfg.panY || 0}) scale(${cfg.zoom})`);
    const zoomLabel = root.querySelector(".zoom-value");
    if (zoomLabel) zoomLabel.textContent = `${Math.round(cfg.zoom * 100)} %`;
  }, { passive: false });

  currentSvg = svg;
}

// Rendu partiel pendant le drag (un seul listener global, SVG courant).
let currentSvg = null;
window.addEventListener("marbexa:render-canvas", () => {
  const project = currentProject();
  const cfg = state.configurator;
  if (!project || !cfg || !currentSvg?.isConnected) return;
  const rootGroup = currentSvg.querySelector("#canvas-root");
  if (rootGroup) rootGroup.innerHTML = project.pieces.map((piece) => pieceSvg(piece, piece.id === cfg.selectedPieceId)).join("");
});

register({
  "add-piece": (el) => {
    const project = currentProject();
    const kind = el.dataset.kind;
    const count = project.pieces.filter((p) => p.kind === kind).length + 1;
    const names = { worktop: "Plan de travail", wall: "Mur", splashback: "Crédence", panel: "Panneau" };
    const piece = makePiece(kind, {
      name: `${names[kind]} ${count}`,
      x: 90 + (project.pieces.length % 5) * 40,
      y: 90 + (project.pieces.length % 5) * 34,
      materialId: kind === "wall" ? null : undefined,
    });
    if (kind === "worktop") {
      piece.edges = [{ side: "bottom", serviceId: "edge-straight", lengthMm: piece.lengthMm, startFrom: "left" }];
    }
    project.pieces.push(piece);
    state.configurator.selectedPieceId = piece.id;
    saveProject();
    window.dispatchEvent(new Event("marbexa:render"));
  },
  "cfg-zoom": (el) => {
    const cfg = state.configurator;
    cfg.zoom = Math.min(3, Math.max(0.3, (cfg.zoom || 1) * (el.dataset.dir === "in" ? 1.15 : 0.87)));
    window.dispatchEvent(new Event("marbexa:render"));
  },
  "cfg-center": () => {
    const cfg = state.configurator;
    cfg.panX = 0; cfg.panY = 0; cfg.zoom = 1;
    window.dispatchEvent(new Event("marbexa:render"));
  },
});
