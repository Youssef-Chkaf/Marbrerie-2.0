// Étape 2 · Dessin : vue d'ensemble SVG avec outils, glisser-déposer,
// accrochage entre pièces et inspecteur latéral.

import { state, currentProject } from "../state.js";
import { esc, number, money } from "../ui.js";
import { openDetailEditor } from "./details.js";
import { register } from "../actions.js";
import { makePiece, plateDims } from "/shared/plan.js";
import { slabPath, edgeSegmentMm } from "/shared/slab.js";
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
  // Chants travaillés : longueur partielle et point de départ respectés.
  const edges = (piece.edges || []).filter((e) => e.serviceId).map((edge) => {
    const [ex1, ey1, ex2, ey2] = edgeSegmentMm(piece, edge);
    return `<line x1="${x + ex1 * scaleX}" y1="${y + ey1 * scaleY}" x2="${x + ex2 * scaleX}" y2="${y + ey2 * scaleY}" class="overview-finished-edge-path" stroke="#2e7d5b" stroke-width="3" stroke-linecap="round"/>`;
  }).join("");
  const fill = piece.kind === "splashback" ? "#e4d5bf" : "#d9c9b6";
  const stroke = selected ? "#c75b39" : piece.kind === "splashback" ? "#8a6d3b" : "#2e7d5b";
  const badge = piece.needsReview ? `<text x="${x + 4}" y="${y + 12}" font-size="10" fill="#b0492c">⚠ à vérifier</text>` : "";
  // Contour réel (angles arrondis / pans coupés / découpes d'angle visibles).
  return `<g class="overview-piece" data-piece="${piece.id}"${rotation} style="cursor:move">
    <g transform="translate(${x} ${y}) scale(${scaleX} ${scaleY})"><path d="${slabPath(piece)}" class="overview-piece-fill" fill="${fill}" stroke="${stroke}" stroke-width="${(selected ? 2.6 : 2) / scaleX}"/></g>
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

  // Bandeau matière : cascade Produit → Coloris → Épaisseur → Finition en ligne,
  // comme dans l'app d'origine.
  const materials = state.data.catalog.materials.filter((m) => m.active);
  const brands = [...new Set(materials.map((m) => m.brand))];
  const colors = materials.filter((m) => m.brand === (material?.brand || brands[0]));
  const finishes = [...new Map((material?.variants || []).map((v) => [v.finish, v.finishLabel || v.finish])).entries()];
  const variantsOfFinish = (material?.variants || []).filter((v) => v.finish === project.finish);
  const thicknesses = [...new Set(variantsOfFinish.map((v) => v.thicknessMm))].sort((a, b) => a - b);
  const currentVariant = variantsOfFinish.find((v) => v.thicknessMm === Number(project.thicknessMm)) || variantsOfFinish[0];
  const dims = plateDims(material, project.finish, project.thicknessMm);

  return `
  <div class="material-strip">
    <div class="material-chip"><span class="swatch" style="background:${esc(material?.tone || "#999")}"></span><strong>Matière principale</strong></div>
    <label>Produit<select data-strip-field="brand">${brands.map((b) => `<option ${b === material?.brand ? "selected" : ""}>${esc(b)}</option>`).join("")}</select></label>
    <label>Coloris<select data-strip-field="materialId">${colors.map((m) => `<option value="${m.id}" ${m.id === project.materialId ? "selected" : ""}>${esc(m.color)}${currentVariant && m.id === project.materialId ? ` · dès ${money(Math.min(...m.variants.map((v) => v.priceM2)))}/m²` : ""}</option>`).join("")}</select></label>
    <label>Finition<select data-strip-field="finish">${finishes.map(([code, label]) => `<option value="${esc(code)}" ${project.finish === code ? "selected" : ""}>${esc(label)}</option>`).join("")}</select></label>
    <label>Épaisseur<select data-strip-field="thicknessMm">${thicknesses.map((t) => `<option value="${t}" ${Number(project.thicknessMm) === t ? "selected" : ""}>${t} mm</option>`).join("")}</select></label>
    <span class="limit-note">${dims ? `Plaque maxi : ${number(dims.maxLengthMm)} × ${number(dims.maxWidthMm)} mm` : ""}</span>
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
      const selectionChanged = cfg.selectedPieceId !== piece.id;
      cfg.selectedPieceId = piece.id;
      const point = svgPoint(event);
      // On garde l'id (pas l'objet) : une sauvegarde différée peut remplacer
      // le projet en mémoire pendant le glissement.
      drag = { type: "piece", pieceId: piece.id, offsetX: point.x - (piece.x || 0), offsetY: point.y - (piece.y || 0), moved: false };
      // Re-rendu seulement si la sélection change : un re-rendu systématique
      // remplacerait le SVG entre les deux clics d'un double-clic.
      if (selectionChanged) window.dispatchEvent(new Event("marbexa:render"));
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
    const project = currentProject();
    const piece = project?.pieces.find((p) => p.id === drag.pieceId);
    if (!piece) return;
    let nx = point.x - drag.offsetX;
    let ny = point.y - drag.offsetY;
    // Accrochage : bords des autres pièces (déplacement lent = précision).
    const { w, h } = pieceBox(piece);
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
    window.requestAnimationFrame(() => window.dispatchEvent(new Event("marbexa:render-canvas")));
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

  // Double-clic sur une pièce fabriquée → éditeur découpes & chants.
  svg.addEventListener("dblclick", (event) => {
    // La capture du pointeur (drag) recible les clics vers le SVG :
    // on retrouve la pièce sous le curseur par ses coordonnées.
    const pieceEl = event.target.closest("[data-piece]")
      || document.elementFromPoint(event.clientX, event.clientY)?.closest("[data-piece]");
    if (!pieceEl) return;
    const project = currentProject();
    const piece = project?.pieces.find((p) => p.id === pieceEl.dataset.piece);
    if (piece && !["wall", "cabinet"].includes(piece.kind)) openDetailEditor(piece.id);
  });

  currentSvg = svg;
}

// Cascade du bandeau matière (Produit → Coloris → Finition → Épaisseur).
export function handleStripField(select) {
  if (select.dataset.stripField === undefined) return false;
  const project = currentProject();
  if (!project) return true;
  const materials = state.data.catalog.materials.filter((m) => m.active);
  const field = select.dataset.stripField;
  if (field === "brand") {
    const first = materials.find((m) => m.brand === select.value);
    if (first) project.materialId = first.id;
  } else if (field === "materialId") {
    project.materialId = select.value;
  } else if (field === "finish") {
    project.finish = select.value;
  } else if (field === "thicknessMm") {
    project.thicknessMm = Number(select.value);
  }
  // Garde finition et épaisseur cohérentes avec les variantes disponibles.
  const material = materials.find((m) => m.id === project.materialId);
  const finishes = [...new Set((material?.variants || []).map((v) => v.finish))];
  if (finishes.length && !finishes.includes(project.finish)) project.finish = finishes[0];
  const thicknesses = (material?.variants || []).filter((v) => v.finish === project.finish).map((v) => v.thicknessMm);
  if (thicknesses.length && !thicknesses.includes(Number(project.thicknessMm))) project.thicknessMm = thicknesses[0];
  saveProject(false, { rerender: true });
  return true;
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
