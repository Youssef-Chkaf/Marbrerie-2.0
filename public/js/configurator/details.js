// Éditeur « Découpes & chants » d'une pièce — réplique de l'éditeur d'origine :
// bibliothèque de découpes à gauche, plan entièrement coté au centre (zoom,
// molette, glisser-déposer), inspecteur contextuel à droite (chants par défaut,
// découpe, angle du plan, nouvel angle E1/E2 d'une encoche).

import { state, currentProject } from "../state.js";
import { request } from "../api.js";
import { esc, number, money, toast } from "../ui.js";
import { register } from "../actions.js";
import { makeId } from "/shared/plan.js";
import { slabPath, cutoutBounds, clampEdgeNotch } from "/shared/slab.js";
import { saveProject } from "./index.js";

const CUT_NAMES = {
  hob: "Table de cuisson", sink: "Évier", "sink-apron": "Évier timbre",
  tap: "Trou robinet", socket: "Prise de courant", custom: "Découpe sur mesure",
  notch: "Découpe spéciale", drainer: "Égouttoir",
};

let selectedCutId = null;
let selectedCorner = null;      // "topLeft" ou "topLeft:outerA|inner|outerB"
let selectedCutCorner = null;   // { cutId, key: "start"|"end" }

export function openDetailEditor(pieceId) {
  state.configurator.detailPieceId = pieceId;
  state.configurator.detailZoom = 1;
  selectedCutId = null;
  selectedCorner = null;
  selectedCutCorner = null;
  window.dispatchEvent(new Event("marbexa:render"));
}

function getPiece() {
  const project = currentProject();
  return project?.pieces.find((p) => p.id === state.configurator?.detailPieceId);
}

const isUnderSink = (cut) => cut.kind === "sink" && ["cut-polished", "sink-integrated", "sink-glued", "cut-flush"].includes(cut.serviceId);
const isFacePiece = (piece) => ["splashback", "panel"].includes(piece.kind);
const referenceEdgeLabel = (piece) => (isFacePiece(piece) ? "chant bas" : "chant avant");
const integerMm = (value) => Math.round(Number(value || 0));

function cutDisplayName(cut) {
  const base = CUT_NAMES[cut.kind] || "Découpe";
  return cut.reference ? `${base} · ${cut.reference}` : base;
}

function serviceOptions(categories, selected) {
  const project = currentProject();
  const piece = getPiece();
  const material = state.data.catalog.materials.find((m) => m.id === (piece?.materialId || project.materialId));
  const family = material?.family === "ultra" ? "ultra" : "stone";
  const list = Array.isArray(categories) ? categories : [categories];
  return state.data.catalog.services
    .filter((s) => s.active && list.includes(s.category))
    .map((s) => `<option value="${s.id}" ${selected === s.id ? "selected" : ""}>${esc(s.label)} · ${esc(s.codes[family])} · ${money(s.prices[family])}/${esc(s.unit)}</option>`)
    .join("");
}

// ---------- Bibliothèque ----------

function renderLibrary() {
  return `<aside class="cut-library">
    <h3>Découpes internes</h3>
    <button class="cut-option" data-add-cut="hob"><span class="cut-icon"></span><span>Cuisson brute</span></button>
    <button class="cut-option" data-add-cut="hob-flush"><span class="cut-icon"></span><span>Cuisson à fleur</span></button>
    <button class="cut-option" data-add-cut="sink"><span class="cut-icon"></span><span>Évier posé / encastré</span></button>
    <button class="cut-option" data-add-cut="sink-under"><span class="cut-icon"></span><span>Évier sous-plan</span></button>
    <button class="cut-option" data-add-cut="sink-apron"><span class="cut-icon edge-open"></span><span>Évier timbre</span></button>
    <button class="cut-option" data-add-cut="sink-integrated"><span class="cut-icon"></span><span>Évier encastré dans la matière</span></button>
    <button class="cut-option" data-add-cut="sink-glued"><span class="cut-icon"></span><span>Évier collé sous plan dans la matière</span></button>
    <button class="cut-option" data-add-cut="round"><span class="cut-icon circle"></span><span>Trou robinet</span></button>
    <button class="cut-option" data-add-cut="socket"><span class="cut-icon capsule"></span><span>Prise de courant</span></button>
    <button class="cut-option" data-add-cut="custom"><span class="cut-icon"></span><span>Découpe sur mesure</span></button>
    <button class="cut-option" data-add-cut="drainer"><span class="cut-icon grooves"></span><span>Rainurage d'égouttoir</span></button>
    <button class="cut-option" data-add-cut="drainer-recessed"><span class="cut-icon recessed"></span><span>Égouttoir décaissé</span></button>
    <h3>Découpes de forme</h3>
    <button class="cut-option" data-add-cut="notch"><span class="cut-icon"></span><span>Encoche de bord / poteau</span></button>
    <div class="corner-help"><strong>Zone de sécurité</strong><p>Le cadre pointillé indique les 40 mm minimum autour des découpes internes. Les encoches et l'évier timbre restent ouverts sur leur bord.</p></div>
    <div class="corner-help"><strong>Angles du plan</strong><p>Cliquez sur une bulle d'angle du dessin pour choisir : arrondi, coupe à 45° ou découpe d'angle. Les deux bulles E1 et E2 règlent les nouveaux angles d'un évier timbre ou d'une encoche.</p></div>
  </aside>`;
}

// ---------- SVG central ----------

function renderSvgCut(piece, cut, ox, oy) {
  const b = cutoutBounds(cut);
  const x = ox + b.x;
  const y = oy + b.y;
  const active = cut.id === selectedCutId;
  const stroke = active ? "#c75b39" : "#8a4a33";
  const strokeWidth = active ? 5 : 3;
  const cx = x + b.width / 2;
  const cy = y + b.height / 2;
  const rotation = Number(cut.rotationDeg || 0) ? ` transform="rotate(${cut.rotationDeg} ${cx} ${cy})"` : "";
  let body = "";

  if (cut.shape === "circle") {
    body = `<circle cx="${cx}" cy="${cy}" r="${b.width / 2}" fill="rgba(199,91,57,.07)" stroke="${stroke}" stroke-width="${strokeWidth}"/>`;
  } else if (cut.shape === "capsule") {
    body = `<rect x="${x}" y="${y}" width="${b.width}" height="${b.height}" rx="${b.height / 2}" fill="rgba(199,91,57,.07)" stroke="${stroke}" stroke-width="${strokeWidth}"/>`;
  } else if (cut.shape === "grooves") {
    const grooves = Math.max(3, Number(cut.grooves || 5));
    let lines = "";
    for (let i = 0; i < grooves; i += 1) {
      const gx = x + (b.width / (grooves - 1)) * i;
      lines += `<line x1="${gx}" y1="${y}" x2="${gx}" y2="${y + b.height}" stroke="${stroke}" stroke-width="3"/>`;
    }
    body = `${lines}<rect x="${x}" y="${y}" width="${b.width}" height="${b.height}" fill="transparent" stroke="${active ? stroke : "transparent"}" stroke-dasharray="8 6" stroke-width="2"/>`;
  } else if (cut.shape === "recessed") {
    body = `<rect x="${x}" y="${y}" width="${b.width}" height="${b.height}" rx="${cut.radiusMm || 8}" fill="rgba(138,74,51,.12)" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-dasharray="10 7"/>
      <rect x="${x + 14}" y="${y + 14}" width="${Math.max(4, b.width - 28)}" height="${Math.max(4, b.height - 28)}" rx="6" fill="none" stroke="${stroke}" stroke-width="1.5"/>`;
  } else if (cut.shape === "edge-notch") {
    // Ouverte sur son bord : trois côtés seulement.
    const side = cut.edgeSide || "top";
    const segs = [];
    if (side !== "top") segs.push([x, y, x + b.width, y]);
    if (side !== "bottom") segs.push([x, y + b.height, x + b.width, y + b.height]);
    if (side !== "left") segs.push([x, y, x, y + b.height]);
    if (side !== "right") segs.push([x + b.width, y, x + b.width, y + b.height]);
    body = `<rect x="${x}" y="${y}" width="${b.width}" height="${b.height}" fill="rgba(199,91,57,.07)" stroke="none"/>`
      + segs.map(([x1, y1, x2, y2]) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="${strokeWidth}"/>`).join("");
    // Bulles E1 / E2 sur les deux nouveaux angles côté ouvert.
    const horizontal = ["top", "bottom"].includes(side);
    const e1 = horizontal ? [x, side === "top" ? y : y + b.height] : [side === "left" ? x : x + b.width, y];
    const e2 = horizontal ? [x + b.width, side === "top" ? y : y + b.height] : [side === "left" ? x : x + b.width, y + b.height];
    body += [["start", e1, "E1"], ["end", e2, "E2"]].map(([key, [bx, by], label]) => `
      <g data-cut-corner-marker="${cut.id}:${key}" style="cursor:pointer">
        <circle cx="${bx}" cy="${by}" r="26" fill="${selectedCutCorner?.cutId === cut.id && selectedCutCorner?.key === key ? "#c75b39" : "#fff"}" stroke="#20231f" stroke-width="2.5"/>
        <text x="${bx}" y="${by + 8}" text-anchor="middle" font-size="22" font-weight="700" fill="${selectedCutCorner?.cutId === cut.id && selectedCutCorner?.key === key ? "#fff" : "#20231f"}">${label}</text>
      </g>`).join("");
  } else {
    body = `<rect x="${x}" y="${y}" width="${b.width}" height="${b.height}" rx="${cut.radiusMm || 0}" fill="rgba(199,91,57,.07)" stroke="${stroke}" stroke-width="${strokeWidth}"/>`;
  }

  // Défonçage à fleur : contour extérieur en pointillé autour de la découpe.
  if (cut.serviceId === "cut-flush" && cut.shape !== "circle") {
    const ow = Number(cut.flushOuterWidthMm || b.width);
    const oh = Number(cut.flushOuterHeightMm || b.height);
    body += `<rect x="${cx - ow / 2}" y="${cy - oh / 2}" width="${ow}" height="${oh}" rx="${cut.flushOuterRadiusMm || 0}" fill="none" stroke="${stroke}" stroke-width="2" stroke-dasharray="14 9"/>`;
  }

  const label = [cut.brand, cut.reference].filter(Boolean).join(" ") || CUT_NAMES[cut.kind] || "Découpe";
  const dims = cut.shape === "circle" ? `Ø ${number(b.width)}` : `${number(b.width)} × ${number(b.height)}${cut.radiusMm ? ` · R ${number(cut.radiusMm)}` : ""}`;
  return `<g class="svg-cut" data-detail-cut="${cut.id}" style="cursor:move"${rotation}>${body}
    <text x="${cx}" y="${cy - 10}" text-anchor="middle" font-size="26" font-weight="600" fill="#7a4632">${esc(label)}${cut.verified ? " ✓" : ""}</text>
    <text x="${cx}" y="${cy + 24}" text-anchor="middle" font-size="24" fill="#7a4632">${dims}</text></g>`;
}

function edgeSegment(piece, edge, ox, oy) {
  const L = piece.lengthMm;
  const W = piece.widthMm;
  const horizontal = ["top", "bottom"].includes(edge.side);
  const max = horizontal ? L : W;
  const length = Math.min(Number(edge.lengthMm || max), max);
  const fromEnd = edge.startFrom === "right" || edge.startFrom === "bottom";
  const start = fromEnd ? max - length : 0;
  const end = fromEnd ? max : length;
  if (edge.side === "top") return [ox + start, oy, ox + end, oy];
  if (edge.side === "bottom") return [ox + start, oy + W, ox + end, oy + W];
  if (edge.side === "left") return [ox, oy + start, ox, oy + end];
  return [ox + L, oy + start, ox + L, oy + end];
}

function renderSvgEdges(piece, ox, oy) {
  const project = currentProject();
  const material = state.data.catalog.materials.find((m) => m.id === (piece.materialId || project.materialId));
  const family = material?.family === "ultra" ? "ultra" : "stone";
  return (piece.edges || []).filter((e) => e.serviceId).map((edge) => {
    const service = state.data.catalog.services.find((s) => s.id === edge.serviceId);
    const [x1, y1, x2, y2] = edgeSegment(piece, edge, ox, oy);
    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2;
    const horizontal = y1 === y2;
    const offset = edge.side === "top" ? -16 : edge.side === "bottom" ? 26 : 0;
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#2e7d5b" stroke-width="9" stroke-linecap="round" opacity=".85" class="svg-edge"/>
      <text x="${horizontal ? midX : x1 + (edge.side === "left" ? -14 : 14)}" y="${horizontal ? midY + offset : midY}" text-anchor="${horizontal ? "middle" : edge.side === "left" ? "end" : "start"}" font-size="22" fill="#2e7d5b" class="svg-edge-label"${horizontal ? "" : ` transform="rotate(-90 ${horizontal ? midX : x1 + (edge.side === "left" ? -14 : 14)} ${midY})"`}>${esc(service?.codes?.[family] || "")}</text>`;
  }).join("");
}

function dimensionLine(x1, y1, x2, y2, label, { vertical = false } = {}) {
  const midX = (x1 + x2) / 2;
  const midY = (y1 + y2) / 2;
  return `<g class="svg-dim" color="#3f5b73">
    <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="currentColor" stroke-width="1.6" marker-start="url(#detail-arrow)" marker-end="url(#detail-arrow)"/>
    <text x="${vertical ? x1 - 10 : midX}" y="${vertical ? midY : y1 - 8}" text-anchor="middle" font-size="24" fill="currentColor"${vertical ? ` transform="rotate(-90 ${x1 - 10} ${midY})"` : ""}>${esc(label)}</text>
  </g>`;
}

function renderSvgDimensions(piece, ox, oy) {
  const L = piece.lengthMm;
  const W = piece.widthMm;
  const face = isFacePiece(piece);
  const parts = [];
  // Cotes principales.
  parts.push(dimensionLine(ox, oy - 70, ox + L, oy - 70, `Longueur ${number(L)} mm`));
  parts.push(dimensionLine(ox - 80, oy, ox - 80, oy + W, `Largeur ${number(W)} mm`, { vertical: true }));

  // Chaînes de cotes des découpes : axes depuis la gauche (dessous) et depuis
  // le chant avant / chant bas (à droite), comme sur les plans imprimés.
  let bottomLevel = 0;
  let rightLevel = 0;
  for (const cut of piece.cutouts || []) {
    const b = cutoutBounds(cut);
    const axisX = b.x + b.width / 2;
    const axisYFromFront = W - b.y - b.height / 2;
    const bottomY = oy + W + 110 + bottomLevel * 46;
    parts.push(`<line x1="${ox + axisX}" y1="${oy + b.y + b.height / 2}" x2="${ox + axisX}" y2="${bottomY}" stroke="#9aa7b4" stroke-width="1" stroke-dasharray="6 6" class="svg-axis"/>`);
    parts.push(dimensionLine(ox, bottomY, ox + axisX, bottomY, `Axe depuis gauche ${number(integerMm(axisX))} mm`));
    bottomLevel += 1;
    const rightX = ox + L + 70 + rightLevel * 52;
    parts.push(`<line x1="${ox + b.x + b.width / 2}" y1="${oy + b.y + b.height / 2}" x2="${rightX}" y2="${oy + b.y + b.height / 2}" stroke="#9aa7b4" stroke-width="1" stroke-dasharray="6 6" class="svg-axis"/>`);
    parts.push(dimensionLine(rightX, oy + b.y + b.height / 2, rightX, oy + W, `Axe depuis ${face ? "chant bas" : "chant avant"} ${number(integerMm(axisYFromFront))} mm`, { vertical: true }));
    rightLevel += 1;
    if (["hob", "sink"].includes(cut.kind)) {
      const recul = W - b.y - b.height;
      const rightX2 = ox + L + 70 + rightLevel * 52;
      parts.push(dimensionLine(rightX2, oy + b.y + b.height, rightX2, oy + W, `Recul ${face ? "chant bas" : "chant avant"} ${number(integerMm(recul))} mm`, { vertical: true }));
      rightLevel += 1;
    }
  }
  return parts.join("");
}

function renderCornerMarkers(piece, ox, oy) {
  const positions = {
    topLeft: [ox, oy], topRight: [ox + piece.lengthMm, oy],
    bottomRight: [ox + piece.lengthMm, oy + piece.widthMm], bottomLeft: [ox, oy + piece.widthMm],
  };
  return Object.entries(positions).map(([key, [x, y]]) => {
    const corner = piece.corners?.[key];
    const active = corner && corner.type && corner.type !== "square";
    const selected = selectedCorner === key || selectedCorner?.startsWith(`${key}:`);
    let extra = "";
    if (corner?.type === "cutout") {
      // Trois bulles numérotées : raccord n°1, angle intérieur, raccord n°2.
      const dx = Math.min(piece.lengthMm / 2, Number(corner.cutXmm || 0));
      const dy = Math.min(piece.widthMm / 2, Number(corner.cutYmm || 0));
      const sx = key.includes("Left") ? 1 : -1;
      const sy = key.includes("top") ? 1 : -1;
      const bubbles = [
        ["outerA", x + sx * dx, y, "1"],
        ["inner", x + sx * dx, y + sy * dy, "2"],
        ["outerB", x, y + sy * dy, "3"],
      ];
      extra = bubbles.map(([vertex, bx, by, label]) => `
        <g data-corner-marker="${key}:${vertex}" style="cursor:pointer">
          <circle cx="${bx}" cy="${by}" r="20" fill="${selectedCorner === `${key}:${vertex}` ? "#c75b39" : "#fff"}" stroke="#20231f" stroke-width="2"/>
          <text x="${bx}" y="${by + 7}" text-anchor="middle" font-size="20" font-weight="700" fill="${selectedCorner === `${key}:${vertex}` ? "#fff" : "#20231f"}">${label}</text>
        </g>`).join("");
    }
    return `<g data-corner-marker="${key}" style="cursor:pointer" class="corner-marker">
      <circle cx="${x}" cy="${y}" r="24" fill="${selected ? "#c75b39" : active ? "#f3d9cd" : "#fff"}" stroke="#20231f" stroke-width="2.5"/>
      ${active ? `<text x="${x}" y="${y + 8}" text-anchor="middle" font-size="21" font-weight="700" fill="${selected ? "#fff" : "#20231f"}">${corner.type === "round" ? "R" : corner.type === "bevel" ? "45" : "⌐"}</text>` : ""}
    </g>${extra}`;
  }).join("");
}

function renderDetailCanvas(piece) {
  const zoom = state.configurator.detailZoom || 1;
  const ox = 220;
  const oy = 140;
  const cutCount = (piece.cutouts || []).length;
  const vbWidth = piece.lengthMm + ox + 140 + cutCount * 60 + 160;
  const vbHeight = piece.widthMm + oy + 170 + cutCount * 46 + 90;
  const clearance = `<rect x="${ox + 40}" y="${oy + 40}" width="${Math.max(0, piece.lengthMm - 80)}" height="${Math.max(0, piece.widthMm - 80)}" fill="none" stroke="#b6b0a5" stroke-width="1.5" stroke-dasharray="14 10"/>`;
  const lowerEdgeLabel = isFacePiece(piece) ? "Chant bas" : "Chant avant";
  return `<section class="detail-canvas" title="Utilisez la molette pour zoomer">
    <div class="detail-zoom-controls">
      <button class="icon-btn" data-action="detail-zoom-out">−</button>
      <strong>${Math.round(zoom * 100)} %</strong>
      <button class="icon-btn" data-action="detail-zoom-in">＋</button>
      <button class="btn btn-small btn-ghost" data-action="detail-zoom-reset">Centrer</button>
      <button class="btn btn-small btn-dark" data-action="close-details">← Vue d'ensemble</button>
    </div>
    <svg class="slab-svg" id="detail-svg" style="width:${Math.round(zoom * 100)}%;min-width:${Math.round(1000 * zoom)}px"
      viewBox="0 0 ${vbWidth} ${vbHeight}" aria-label="Plan entièrement coté de ${esc(piece.name)}">
      <defs><marker id="detail-arrow" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto"><path d="M8,0 L0,4 L8,8" fill="none" stroke="currentColor"/></marker></defs>
      <path class="slab-shape" d="${slabPath(piece, ox, oy)}" fill="#d9c9b6" stroke="#20231f" stroke-width="4"/>
      ${clearance}
      ${(piece.cutouts || []).map((cut) => renderSvgCut(piece, cut, ox, oy)).join("")}
      ${renderSvgEdges(piece, ox, oy)}
      ${renderSvgDimensions(piece, ox, oy)}
      ${renderCornerMarkers(piece, ox, oy)}
      <text class="svg-front" x="${ox + piece.lengthMm / 2}" y="${oy + piece.widthMm + 70}" text-anchor="middle" font-size="26" letter-spacing="4" fill="#40433e">${lowerEdgeLabel}</text>
    </svg>
  </section>`;
}

// ---------- Inspecteurs ----------

function renderEdgesInspector(piece) {
  const edges = Object.fromEntries((piece.edges || []).map((edge) => [edge.side, edge]));
  const face = isFacePiece(piece);
  const sides = [
    ["top", face ? "Chant haut" : "Chant arrière", piece.lengthMm],
    ["bottom", face ? "Chant bas" : "Chant avant", piece.lengthMm],
    ["left", "Chant gauche", piece.widthMm],
    ["right", "Chant droit", piece.widthMm],
  ];
  return `<div class="inspector-head"><h3>Chants travaillés</h3><p>Longueur, origine et finition par côté.</p></div>
  <div class="inspector-section"><h4>Finitions</h4><div class="edge-grid">
    ${sides.map(([side, label, max]) => {
      const edge = edges[side] || { side, serviceId: "", lengthMm: max, startFrom: ["top", "bottom"].includes(side) ? "left" : "top" };
      const horizontal = ["top", "bottom"].includes(side);
      const waterfall = edge.serviceId === "edge-waterfall-5"
        ? `<label>Hauteur totale<input type="number" min="40" max="60" data-edge-field="heightMm" data-side="${side}" value="${esc(edge.heightMm || 40)}"><small>40 à 60 mm</small></label>`
        : edge.serviceId === "edge-waterfall-10"
        ? `<label>Hauteur totale<input type="number" min="70" max="100" data-edge-field="heightMm" data-side="${side}" value="${esc(edge.heightMm || 70)}"><small>70 à 100 mm</small></label>` : "";
      return `<div class="edge-row"><strong>${label}</strong>
        <select data-edge-field="serviceId" data-side="${side}"><option value="">Brut / contre mur</option>${serviceOptions("edge", edge.serviceId)}</select>
        <label>Longueur travaillée<input type="number" min="0" max="${max}" data-edge-field="lengthMm" data-side="${side}" value="${esc(edge.lengthMm)}" ${edge.serviceId ? "" : "disabled"}></label>
        <label>Ajouter la longueur depuis<select data-edge-field="startFrom" data-side="${side}" ${edge.serviceId ? "" : "disabled"}>
          ${horizontal
            ? `<option value="left" ${edge.startFrom !== "right" ? "selected" : ""}>la gauche</option><option value="right" ${edge.startFrom === "right" ? "selected" : ""}>la droite</option>`
            : `<option value="top" ${edge.startFrom !== "bottom" ? "selected" : ""}>le haut</option><option value="bottom" ${edge.startFrom === "bottom" ? "selected" : ""}>le bas</option>`}
        </select></label>${waterfall}</div>`;
    }).join("")}
  </div></div>
  <div class="inspector-section"><h4>Découpes</h4>
    ${(piece.cutouts || []).length
      ? piece.cutouts.map((cut) => `<button class="btn btn-ghost btn-small" data-select-cut="${cut.id}">${esc(CUT_NAMES[cut.kind] || "Découpe")} · ${number(cutoutBounds(cut).width)} × ${number(cutoutBounds(cut).height)}</button>`).join("")
      : `<p class="help">Ajoutez une découpe depuis la bibliothèque à gauche.</p>`}
  </div>`;
}

function renderCutInspector(piece, cut) {
  const face = isFacePiece(piece);
  const refEdge = referenceEdgeLabel(piece);
  const b = cutoutBounds(cut);
  const underSinks = (piece.cutouts || []).filter(isUnderSink);

  const source = `<div class="verification">Une erreur de recherche est possible. Vérifiez toujours les cotes sur la fiche technique du fabricant.${cut.verified ? "<br><strong>✓ Cotes issues de la base d'encastrement Marbexa.</strong>" : ""}</div>`;
  const appliance = ["hob", "sink", "socket", "custom"].includes(cut.kind) ? `
    <div class="inspector-section"><h4>Appareil</h4>
      <label>Marque<input data-cut-field="brand" value="${esc(cut.brand || "")}" placeholder="Bosch, Blanco, Legrand…" list="appliance-brands"></label>
      <datalist id="appliance-brands">${(state.data.appliances?.brands || []).map((br) => `<option>${esc(br)}</option>`).join("")}</datalist>
      <label>Référence<input data-cut-field="reference" value="${esc(cut.reference || "")}" placeholder="Référence exacte de l'appareil"></label>
      <button class="btn btn-soft" data-action="lookup-appliance">Rechercher les cotes</button>
      ${cut.verified ? "" : `<button class="btn btn-ghost btn-small" data-action="save-appliance">Enregistrer ces cotes dans la base</button>`}
      ${source}
    </div>` : "";

  const frontPosition = ["hob", "sink"].includes(cut.kind)
    ? `<label class="wide important-field">Distance depuis le ${refEdge} (mm)<input type="number" min="0" step="1" data-cut-field="frontOffsetMm" value="${esc(integerMm(cut.frontOffsetMm ?? Math.max(0, piece.widthMm - b.y - b.height)))}"><small>Exemple courant pour une table de cuisson : 70 mm.</small></label>` : "";

  const drainerSettings = cut.kind === "drainer" ? `
    <div class="inspector-section"><h4>Position par rapport à l'évier sous-plan</h4>
      <label>Évier associé<select data-cut-field="sinkCutoutId">${underSinks.map((sink) => `<option value="${sink.id}" ${cut.sinkCutoutId === sink.id ? "selected" : ""}>${esc(sink.reference || sink.brand || "Évier sous-plan")} · ${number(integerMm(sink.widthMm))} × ${number(integerMm(sink.heightMm))}</option>`).join("")}</select></label>
      <label>Côté du rainurage<select data-cut-field="side"><option value="left" ${cut.side === "left" ? "selected" : ""}>À gauche de l'évier</option><option value="right" ${cut.side !== "left" ? "selected" : ""}>À droite de l'évier</option></select></label>
      <label>Marge haute et basse<input type="number" min="0" step="1" data-cut-field="insetMm" value="${esc(integerMm(cut.insetMm ?? 0))}"></label>
      <p class="help">Le rainurage reste collé à la cuve. La marge haute et basse est de 0 mm par défaut et reste modifiable.</p>
    </div>` : "";

  const tapSettings = cut.kind === "tap" ? `
    <div class="inspector-section"><h4>Position par rapport à l'évier sous-plan</h4>
      ${underSinks.length ? `
        <label>Évier associé<select data-cut-field="sinkCutoutId"><option value="">Aucun</option>${underSinks.map((sink) => `<option value="${sink.id}" ${cut.sinkCutoutId === sink.id ? "selected" : ""}>${esc(sink.reference || sink.brand || "Évier sous-plan")}</option>`).join("")}</select></label>
        <label>Distance derrière le bord arrière de l'évier<input type="number" min="0" step="1" data-cut-field="tapOffsetMm" value="${esc(integerMm(cut.tapOffsetMm ?? 70))}"></label>
        <label class="inline-check"><input type="checkbox" data-cut-field="alignToSink" ${cut.alignToSink !== false ? "checked" : ""}> Centrer automatiquement le trou sur l'axe de l'évier</label>
        <p class="help">Valeur initiale : 70 mm. Désactivez le centrage pour décaler le trou par les axes ou à la souris.</p>`
        : `<p class="help">Ajoutez un évier sous-plan pour positionner automatiquement le trou robinet.</p>`}
    </div>` : "";

  const notchSettings = cut.shape === "edge-notch" ? `
    <div class="inspector-section"><h4>Accrochage au bord</h4>
      <label>Côté du plan<select data-cut-field="edgeSide">
        <option value="top" ${cut.edgeSide === "top" ? "selected" : ""}>${face ? "Chant haut" : "Chant arrière"}</option>
        <option value="bottom" ${cut.edgeSide === "bottom" ? "selected" : ""}>${face ? "Chant bas" : "Chant avant"}</option>
        <option value="left" ${cut.edgeSide === "left" ? "selected" : ""}>Côté gauche</option>
        <option value="right" ${cut.edgeSide === "right" ? "selected" : ""}>Côté droit</option></select></label>
      <p class="help">Le rayon s'applique uniquement aux deux angles intérieurs de l'ouverture. Les bulles E1 et E2 règlent les nouveaux angles.</p>
    </div>` : "";

  const leftAxis = integerMm(b.x + b.width / 2);
  const frontAxis = integerMm(cut.frontAxisMm ?? Math.max(0, piece.widthMm - b.y - b.height / 2));
  const rotation = Math.round(((Number(cut.rotationDeg || 0) % 360) + 360) % 360 * 10) / 10;
  const rotationSettings = !["circle", "edge-notch"].includes(cut.shape) ? `
    <div class="rotation-panel">
      <div class="rotation-main"><button class="rotation-arrow" data-rotate-cut="-90" title="Tourner de 90° vers la gauche">↺</button><strong>${number(rotation, 1)}°</strong><button class="rotation-arrow" data-rotate-cut="90" title="Tourner de 90° vers la droite">↻</button><button class="btn btn-small btn-ghost" data-rotate-cut="0">Revenir à 0°</button></div>
      <div class="rotation-custom"><label>Angle libre<input type="number" min="0.1" max="359.9" step="0.1" value="45" id="cut-rotation-step">°</label>
        <button class="btn btn-small btn-ghost" data-rotate-cut-custom="-1">↺ Gauche</button><button class="btn btn-small btn-ghost" data-rotate-cut-custom="1">Droite ↻</button></div>
    </div><p class="help">La rotation concerne uniquement cette découpe et reste visible sur les plans et dans le fichier DXF.</p>` : "";

  const dimensionFields = cut.shape === "circle"
    ? `<label>Diamètre<input type="number" step="1" data-cut-field="diameterMm" value="${esc(integerMm(cut.diameterMm || cut.widthMm))}"></label>`
    : cut.serviceId === "cut-flush"
    ? `<label>Découpe intérieure — largeur<input type="number" min="1" step="1" data-cut-field="flushInnerWidthMm" value="${esc(integerMm(cut.flushInnerWidthMm || cut.widthMm))}"></label>
       <label>Découpe intérieure — profondeur<input type="number" min="1" step="1" data-cut-field="flushInnerHeightMm" value="${esc(integerMm(cut.flushInnerHeightMm || cut.heightMm))}"></label>`
    : `<label>Largeur<input type="number" step="1" data-cut-field="widthMm" value="${esc(integerMm(cut.widthMm))}"></label>
       <label>Profondeur<input type="number" step="1" data-cut-field="heightMm" value="${esc(integerMm(cut.heightMm))}"></label>`;

  const flushSettings = cut.serviceId === "cut-flush" ? `
    <div class="inspector-section"><h4>Défonçage pour pose à fleur</h4><div class="form-grid">
      <label>Défonçage extérieur — largeur<input type="number" min="1" step="1" data-cut-field="flushOuterWidthMm" value="${esc(integerMm(cut.flushOuterWidthMm || cut.widthMm))}"></label>
      <label>Défonçage extérieur — profondeur<input type="number" min="1" step="1" data-cut-field="flushOuterHeightMm" value="${esc(integerMm(cut.flushOuterHeightMm || cut.heightMm))}"></label>
      <label>Profondeur du défonçage<input type="number" min="0" step="0.5" data-cut-field="flushDepthMm" value="${esc(cut.flushDepthMm || 0)}"></label>
      <label>Rayon découpe intérieure<input type="number" min="0" step="1" data-cut-field="flushInnerRadiusMm" value="${esc(integerMm(cut.flushInnerRadiusMm ?? cut.radiusMm ?? 0))}"></label>
      <label>Rayon défonçage extérieur<input type="number" min="0" step="1" data-cut-field="flushOuterRadiusMm" value="${esc(integerMm(cut.flushOuterRadiusMm ?? cut.radiusMm ?? 0))}"></label>
    </div><p class="help">La profondeur du défonçage est une cote d'usinage. Ce n'est ni l'épaisseur du plan ni la hauteur totale de l'appareil.</p></div>` : "";

  return `<div class="inspector-head"><h3>${esc(cutDisplayName(cut))}</h3><p>Cliquez-glissez la découpe sur le plan.</p></div>
    <div class="inspector-section"><h4>Type & dimensions</h4>
      <label>Prestation<select data-cut-field="serviceId">${serviceOptions(["cutout", "drainer", "shape", "sink"], cut.serviceId)}</select></label>
      <label>Forme<select data-cut-field="shape">
        <option value="rect" ${cut.shape === "rect" ? "selected" : ""}>Rectangle droit</option>
        <option value="rounded" ${cut.shape === "rounded" ? "selected" : ""}>Rectangle arrondi</option>
        <option value="capsule" ${cut.shape === "capsule" ? "selected" : ""}>Oblongue, extrémités arrondies</option>
        <option value="circle" ${cut.shape === "circle" ? "selected" : ""}>Rond</option>
        <option value="grooves" ${cut.shape === "grooves" ? "selected" : ""}>Rainures</option>
        <option value="recessed" ${cut.shape === "recessed" ? "selected" : ""}>Égouttoir décaissé</option>
        <option value="edge-notch" ${cut.shape === "edge-notch" ? "selected" : ""}>Encoche ouverte sur un bord</option></select></label>
      <div class="form-grid">
        <label>Axe depuis le bord gauche<input type="number" step="1" data-cut-axis="left" value="${esc(leftAxis)}"></label>
        <label>Axe depuis le ${refEdge}<input type="number" step="1" data-cut-field="frontAxisMm" value="${esc(frontAxis)}"></label>
        ${dimensionFields}
        ${!["circle", "grooves", "capsule"].includes(cut.shape) ? `<label>Rayon<input type="number" min="0" step="1" data-cut-field="radiusMm" value="${esc(integerMm(cut.radiusMm || 0))}"></label>` : ""}
        ${cut.shape === "grooves" ? `<label>Rainures<input type="number" min="3" max="8" step="1" data-cut-field="grooves" value="${esc(integerMm(cut.grooves || 5))}"></label>` : ""}
        ${frontPosition}
      </div>${rotationSettings}
    </div>${flushSettings}${notchSettings}${tapSettings}${drainerSettings}${appliance}
    <div class="inspector-section"><button class="btn btn-danger" data-action="delete-cut">Supprimer la découpe</button>
      <button class="btn btn-ghost" data-action="show-edges">Afficher les chants</button></div>`;
}

function renderCornerInspector(piece, key) {
  const names = { topLeft: "haut gauche", topRight: "haut droit", bottomRight: "bas droit", bottomLeft: "bas gauche" };
  const [rootKey, vertex] = key.split(":");
  const corner = piece.corners?.[rootKey] || { type: "square", radiusMm: 50, cutXmm: 100, cutYmm: 100, outerRadiusAmm: 0, innerRadiusMm: 10, outerRadiusBmm: 0 };
  if (vertex) {
    const fields = {
      outerA: ["outerRadiusAmm", "nouvel angle extérieur n° 1"],
      inner: ["innerRadiusMm", "angle intérieur de la découpe"],
      outerB: ["outerRadiusBmm", "nouvel angle extérieur n° 2"],
    };
    const [field, label] = fields[vertex];
    return `<div class="inspector-head"><h3>Rayon · ${label}</h3><p>Découpe de l'angle ${names[rootKey]}.</p></div>
      <div class="inspector-section"><label>Rayon (mm)<input type="number" min="0" data-corner-field="${field}" data-corner-key="${rootKey}" value="${esc(corner[field] || 0)}"></label>
        <div class="corner-preview-note">Les trois bulles numérotées règlent indépendamment les deux raccords extérieurs et l'angle intérieur.</div></div>
      <div class="inspector-section"><button class="btn btn-ghost" data-corner-select="${rootKey}">Revenir à la découpe d'angle</button></div>`;
  }
  return `<div class="inspector-head"><h3>Angle ${names[rootKey]}</h3><p>Le repère sélectionné correspond à cet angle du plan.</p></div>
    <div class="inspector-section"><h4>Traitement de l'angle</h4>
      <label>Type<select data-corner-field="type" data-corner-key="${rootKey}">
        <option value="square" ${corner.type === "square" ? "selected" : ""}>Angle droit, sans découpe</option>
        <option value="round" ${corner.type === "round" ? "selected" : ""}>Angle arrondi</option>
        <option value="bevel" ${corner.type === "bevel" ? "selected" : ""}>Coupe à 45°</option>
        <option value="cutout" ${corner.type === "cutout" ? "selected" : ""}>Découpe de l'angle</option></select></label>
      ${corner.type === "round" ? `<label>Rayon de l'angle (mm)<input type="number" min="1" data-corner-field="radiusMm" data-corner-key="${rootKey}" value="${esc(corner.radiusMm || 50)}"></label>` : ""}
      ${["bevel", "cutout"].includes(corner.type) ? `<div class="form-grid">
        <label>Dimension horizontale<input type="number" min="1" data-corner-field="cutXmm" data-corner-key="${rootKey}" value="${esc(corner.cutXmm || 100)}"></label>
        <label>Dimension verticale<input type="number" min="1" data-corner-field="cutYmm" data-corner-key="${rootKey}" value="${esc(corner.cutYmm || 100)}"></label></div>` : ""}
      ${corner.type === "cutout" ? `<div class="form-grid">
        <label>Rayon raccord n° 1<input type="number" min="0" data-corner-field="outerRadiusAmm" data-corner-key="${rootKey}" value="${esc(corner.outerRadiusAmm || 0)}"></label>
        <label>Rayon intérieur<input type="number" min="0" data-corner-field="innerRadiusMm" data-corner-key="${rootKey}" value="${esc(corner.innerRadiusMm || 0)}"></label>
        <label>Rayon raccord n° 2<input type="number" min="0" data-corner-field="outerRadiusBmm" data-corner-key="${rootKey}" value="${esc(corner.outerRadiusBmm || 0)}"></label></div>
        <p class="help">Vous pouvez aussi cliquer les trois bulles numérotées directement sur la découpe.</p>` : ""}
      <div class="corner-preview-note">Le dessin et les lignes de cotation se mettent à jour immédiatement.</div></div>
    <div class="inspector-section"><button class="btn btn-ghost" data-action="show-edges">Revenir aux chants</button></div>`;
}

function renderCutCornerInspector(piece, cut, key) {
  cut.edgeCorners = cut.edgeCorners || { start: { type: "square" }, end: { type: "square" } };
  const treatment = cut.edgeCorners[key] = cut.edgeCorners[key] || { type: "square" };
  const horizontal = ["top", "bottom"].includes(cut.edgeSide);
  const face = isFacePiece(piece);
  const position = key === "start" ? (horizontal ? "gauche" : face ? "haut" : "arrière") : (horizontal ? "droit" : face ? "bas" : "avant");
  return `<div class="inspector-head"><h3>Nouvel angle ${key === "start" ? "E1" : "E2"}</h3>
    <p>${esc(CUT_NAMES[cut.kind] || "Encoche")} · côté ${position}. Le chant fini suit automatiquement ce traitement.</p></div>
    <div class="inspector-section"><h4>Traitement de l'angle</h4>
      <label>Type<select data-cut-corner-field="type">
        <option value="square" ${treatment.type === "square" ? "selected" : ""}>Angle droit</option>
        <option value="round" ${treatment.type === "round" ? "selected" : ""}>Angle arrondi</option>
        <option value="bevel" ${treatment.type === "bevel" ? "selected" : ""}>Coupe à 45°</option>
        <option value="cutout" ${treatment.type === "cutout" ? "selected" : ""}>Découpe de l'angle</option></select></label>
      ${treatment.type === "round" ? `<label>Rayon (mm)<input type="number" min="1" data-cut-corner-field="radiusMm" value="${esc(treatment.radiusMm || 30)}"></label>` : ""}
      ${["bevel", "cutout"].includes(treatment.type) ? `<div class="form-grid">
        <label>Dimension le long du chant<input type="number" min="1" data-cut-corner-field="cutXmm" value="${esc(treatment.cutXmm || 50)}"></label>
        <label>Dimension vers l'intérieur<input type="number" min="1" data-cut-corner-field="cutYmm" value="${esc(treatment.cutYmm || 50)}"></label></div>` : ""}
      ${treatment.type === "cutout" ? `<div class="form-grid">
        <label>Rayon extérieur<input type="number" min="0" data-cut-corner-field="outerRadiusMm" value="${esc(treatment.outerRadiusMm || 0)}"></label>
        <label>Rayon intérieur<input type="number" min="0" data-cut-corner-field="innerRadiusMm" value="${esc(treatment.innerRadiusMm || 0)}"></label></div>` : ""}
      <div class="corner-preview-note">La forme se met à jour dans l'éditeur, la vue d'ensemble, le devis, le bon de commande et la commande usine.</div></div>
    <div class="inspector-section"><button class="btn btn-ghost" data-select-cut="${cut.id}">Revenir à ${cut.kind === "sink-apron" ? "l'évier timbre" : "l'encoche"}</button></div>`;
}

export function renderDetailEditor() {
  const piece = getPiece();
  if (!piece) return "";
  const selectedCut = (piece.cutouts || []).find((c) => c.id === selectedCutId);
  const inspectorBody = selectedCutCorner
    ? renderCutCornerInspector(piece, (piece.cutouts || []).find((c) => c.id === selectedCutCorner.cutId) || selectedCut, selectedCutCorner.key)
    : selectedCut ? renderCutInspector(piece, selectedCut)
    : selectedCorner ? renderCornerInspector(piece, selectedCorner)
    : renderEdgesInspector(piece);
  return `<div class="detail-layout">${renderLibrary()}${renderDetailCanvas(piece)}
    <aside class="inspector open">${inspectorBody}</aside></div>`;
}

// ---------- Positionnements automatiques ----------

function applyTapPosition(piece, cut) {
  if (cut.kind !== "tap" || !cut.sinkCutoutId || cut.alignToSink === false) return;
  const sink = (piece.cutouts || []).find((c) => c.id === cut.sinkCutoutId);
  if (!sink) return;
  const b = cutoutBounds(cut);
  cut.xMm = Math.round(Number(sink.xMm) + Number(sink.widthMm) / 2 - b.width / 2);
  cut.yMm = Math.round(Math.max(0, Number(sink.yMm) - Number(cut.tapOffsetMm ?? 70) - b.height / 2));
}

function applyDrainerPosition(piece, cut) {
  if (cut.kind !== "drainer" || !cut.sinkCutoutId) return;
  const sink = (piece.cutouts || []).find((c) => c.id === cut.sinkCutoutId);
  if (!sink) return;
  const inset = Number(cut.insetMm || 0);
  cut.yMm = Number(sink.yMm) + inset;
  cut.heightMm = Math.max(40, Number(sink.heightMm) - inset * 2);
  cut.xMm = cut.side === "left"
    ? Math.max(0, Number(sink.xMm) - Number(cut.widthMm))
    : Math.min(piece.lengthMm - Number(cut.widthMm), Number(sink.xMm) + Number(sink.widthMm));
}

function refreshDerived(piece, cut) {
  if (cut.shape === "edge-notch") clampEdgeNotch(piece, cut);
  applyTapPosition(piece, cut);
  applyDrainerPosition(piece, cut);
  if (["hob", "sink"].includes(cut.kind)) {
    const b = cutoutBounds(cut);
    cut.frontOffsetMm = integerMm(Math.max(0, piece.widthMm - cut.yMm - b.height));
    cut.frontAxisMm = integerMm(Math.max(0, piece.widthMm - cut.yMm - b.height / 2));
  }
}

// ---------- Ajout de découpes (préréglages d'origine) ----------

const CUT_PRESETS = {
  hob: { kind: "hob", shape: "rounded", serviceId: "cut-rough", widthMm: 560, heightMm: 490, radiusMm: 10 },
  "hob-flush": { kind: "hob", shape: "rounded", serviceId: "cut-flush", widthMm: 560, heightMm: 490, radiusMm: 10, flushInnerWidthMm: 560, flushInnerHeightMm: 490, flushInnerRadiusMm: 10, flushOuterWidthMm: 580, flushOuterHeightMm: 510, flushOuterRadiusMm: 10, flushDepthMm: 5.5 },
  sink: { kind: "sink", shape: "rounded", serviceId: "cut-rough", widthMm: 500, heightMm: 400, radiusMm: 15 },
  "sink-under": { kind: "sink", shape: "rounded", serviceId: "cut-polished", widthMm: 500, heightMm: 400, radiusMm: 15 },
  "sink-apron": { kind: "sink-apron", shape: "edge-notch", serviceId: "cut-apron-sink", widthMm: 500, heightMm: 220, radiusMm: 15, edgeSide: "bottom", finishedEdge: true, edgeCorners: { start: { type: "square" }, end: { type: "square" } } },
  "sink-integrated": { kind: "sink", shape: "rounded", serviceId: "sink-integrated", widthMm: 500, heightMm: 400, radiusMm: 15 },
  "sink-glued": { kind: "sink", shape: "rounded", serviceId: "sink-glued", widthMm: 500, heightMm: 400, radiusMm: 15 },
  round: { kind: "tap", shape: "circle", serviceId: "cut-tap", widthMm: 35, heightMm: 35, diameterMm: 35, tapOffsetMm: 70 },
  socket: { kind: "socket", shape: "capsule", serviceId: "cut-tap", widthMm: 120, heightMm: 55, radiusMm: 27.5 },
  custom: { kind: "custom", shape: "rounded", serviceId: "cut-rough", widthMm: 200, heightMm: 150, radiusMm: 10 },
  drainer: { kind: "drainer", shape: "grooves", serviceId: "drainer-5", widthMm: 380, heightMm: 180, grooves: 5, side: "right", insetMm: 0 },
  "drainer-recessed": { kind: "drainer", shape: "recessed", serviceId: "drainer-recessed", widthMm: 380, heightMm: 180, radiusMm: 8, side: "right", insetMm: 0 },
  notch: { kind: "notch", shape: "edge-notch", serviceId: "cut-inside", widthMm: 230, heightMm: 180, radiusMm: 10, edgeSide: "top", edgeCorners: { start: { type: "square" }, end: { type: "square" } } },
};

function addCut(type) {
  const piece = getPiece();
  if (!piece) return;
  if (piece.kind !== "worktop" && ["hob", "hob-flush", "sink", "sink-under", "sink-apron", "sink-integrated", "sink-glued", "round", "drainer", "drainer-recessed"].includes(type)) {
    toast("Cette découpe est réservée aux plans de travail", "error");
    return;
  }
  const underSinks = (piece.cutouts || []).filter(isUnderSink);
  if (["drainer", "drainer-recessed"].includes(type) && !underSinks.length) {
    toast("Ajoutez d'abord un évier sous-plan ou en matière : l'égouttoir doit être placé à sa gauche ou à sa droite.", "error");
    return;
  }
  const preset = CUT_PRESETS[type];
  if (!preset) return;
  let xMm = Math.max(40, Math.round((piece.lengthMm - preset.widthMm) / 2));
  let yMm = Math.max(0, Math.round((piece.widthMm - preset.heightMm) / 2));
  if (["hob", "hob-flush"].includes(type)) yMm = Math.max(0, piece.widthMm - preset.heightMm - 70);
  if (["sink", "sink-under", "sink-integrated", "sink-glued"].includes(type)) yMm = Math.max(40, piece.widthMm - preset.heightMm - 80);
  if (type === "notch") yMm = 0;
  if (type === "sink-apron") yMm = Math.max(0, piece.widthMm - preset.heightMm);
  const cut = {
    id: makeId("cut"),
    ...structuredClone(preset),
    xMm: Math.round(xMm), yMm: Math.round(yMm),
    rotationDeg: 0, brand: "", reference: "", verified: false,
    sinkCutoutId: ["drainer", "drainer-recessed", "round"].includes(type) ? underSinks[0]?.id : preset.sinkCutoutId,
    alignToSink: type === "round" ? Boolean(underSinks.length) : undefined,
  };
  piece.cutouts = piece.cutouts || [];
  piece.cutouts.push(cut);
  refreshDerived(piece, cut);
  selectedCutId = cut.id;
  selectedCorner = null;
  selectedCutCorner = null;
  saveProject();
  window.dispatchEvent(new Event("marbexa:render"));
}

// ---------- Champs & clics ----------

const rerender = () => window.dispatchEvent(new Event("marbexa:render"));

export function handleDetailField(input) {
  const piece = getPiece();
  if (!piece) return false;

  if (input.dataset.edgeField !== undefined) {
    const side = input.dataset.side;
    const field = input.dataset.edgeField;
    let edge = (piece.edges || []).find((e) => e.side === side);
    if (field === "serviceId") {
      const max = ["top", "bottom"].includes(side) ? piece.lengthMm : piece.widthMm;
      piece.edges = (piece.edges || []).filter((e) => e.side !== side);
      if (input.value) piece.edges.push({ side, serviceId: input.value, lengthMm: edge?.lengthMm || max, startFrom: edge?.startFrom || (["top", "bottom"].includes(side) ? "left" : "top") });
      saveProject(); rerender(); return true;
    }
    if (!edge) return true;
    edge[field] = ["lengthMm", "heightMm"].includes(field) ? Number(input.value) : input.value;
    saveProject(); rerender(); return true;
  }

  if (input.dataset.cornerField !== undefined) {
    const key = input.dataset.cornerKey || String(selectedCorner || "").split(":")[0];
    if (!key) return true;
    piece.corners = piece.corners || {};
    const corner = piece.corners[key] || { type: "square" };
    const field = input.dataset.cornerField;
    if (field === "type") {
      if (input.value === "square") delete piece.corners[key];
      else piece.corners[key] = { type: input.value, radiusMm: corner.radiusMm || 50, cutXmm: corner.cutXmm || 100, cutYmm: corner.cutYmm || 100, outerRadiusAmm: corner.outerRadiusAmm || 0, innerRadiusMm: corner.innerRadiusMm ?? 10, outerRadiusBmm: corner.outerRadiusBmm || 0 };
    } else {
      piece.corners[key] = { ...corner, [field]: Number(input.value) };
    }
    saveProject(); rerender(); return true;
  }

  if (input.dataset.cutCornerField !== undefined) {
    const cut = (piece.cutouts || []).find((c) => c.id === selectedCutCorner?.cutId);
    if (!cut) return true;
    cut.edgeCorners = cut.edgeCorners || { start: { type: "square" }, end: { type: "square" } };
    const treatment = cut.edgeCorners[selectedCutCorner.key] || { type: "square" };
    const field = input.dataset.cutCornerField;
    cut.edgeCorners[selectedCutCorner.key] = field === "type"
      ? { ...treatment, type: input.value }
      : { ...treatment, [field]: Number(input.value) };
    saveProject(); rerender(); return true;
  }

  if (input.dataset.cutAxis !== undefined) {
    const cut = (piece.cutouts || []).find((c) => c.id === selectedCutId);
    if (!cut) return true;
    const b = cutoutBounds(cut);
    cut.xMm = Math.round(Number(input.value) - b.width / 2);
    refreshDerived(piece, cut);
    saveProject(); rerender(); return true;
  }

  if (input.dataset.cutField !== undefined) {
    const cut = (piece.cutouts || []).find((c) => c.id === selectedCutId);
    if (!cut) return true;
    const field = input.dataset.cutField;
    const numeric = ["xMm", "yMm", "widthMm", "heightMm", "radiusMm", "diameterMm", "grooves",
      "frontOffsetMm", "frontAxisMm", "tapOffsetMm", "insetMm", "flushInnerWidthMm", "flushInnerHeightMm",
      "flushOuterWidthMm", "flushOuterHeightMm", "flushDepthMm", "flushInnerRadiusMm", "flushOuterRadiusMm"];
    if (field === "alignToSink") cut.alignToSink = input.checked;
    else cut[field] = numeric.includes(field) ? Number(input.value) : input.value;
    if (field === "diameterMm") { cut.widthMm = cut.diameterMm; cut.heightMm = cut.diameterMm; }
    if (field === "flushInnerWidthMm") cut.widthMm = Number(input.value);
    if (field === "flushInnerHeightMm") cut.heightMm = Number(input.value);
    if (field === "frontOffsetMm") cut.yMm = Math.max(0, Math.round(piece.widthMm - cutoutBounds(cut).height - Number(input.value)));
    if (field === "frontAxisMm") cut.yMm = Math.max(0, Math.round(piece.widthMm - Number(input.value) - cutoutBounds(cut).height / 2));
    if (["brand", "reference", "widthMm", "heightMm", "diameterMm", "flushInnerWidthMm", "flushInnerHeightMm"].includes(field)) cut.verified = false;
    refreshDerived(piece, cut);
    saveProject(); rerender(); return true;
  }
  return false;
}

export function handleDetailClick(target) {
  const piece = getPiece();
  if (!piece) return false;

  const cutCornerEl = target.closest("[data-cut-corner-marker]");
  if (cutCornerEl) {
    const [cutId, key] = cutCornerEl.dataset.cutCornerMarker.split(":");
    selectedCutCorner = { cutId, key };
    selectedCutId = cutId;
    selectedCorner = null;
    rerender(); return true;
  }
  const cornerEl = target.closest("[data-corner-marker]");
  if (cornerEl) {
    selectedCorner = cornerEl.dataset.cornerMarker;
    selectedCutId = null;
    selectedCutCorner = null;
    rerender(); return true;
  }
  const cornerBack = target.closest("[data-corner-select]");
  if (cornerBack) { selectedCorner = cornerBack.dataset.cornerSelect; rerender(); return true; }
  const selectBtn = target.closest("[data-select-cut]");
  if (selectBtn) {
    selectedCutId = selectBtn.dataset.selectCut;
    selectedCorner = null;
    selectedCutCorner = null;
    rerender(); return true;
  }
  const addBtn = target.closest("[data-add-cut]");
  if (addBtn) { addCut(addBtn.dataset.addCut); return true; }
  const rotateBtn = target.closest("[data-rotate-cut]");
  if (rotateBtn) {
    const cut = (piece.cutouts || []).find((c) => c.id === selectedCutId);
    if (cut) {
      const value = rotateBtn.dataset.rotateCut;
      cut.rotationDeg = value === "0" ? 0 : ((Number(cut.rotationDeg || 0) + Number(value)) % 360 + 360) % 360;
      saveProject(); rerender();
    }
    return true;
  }
  const rotateCustom = target.closest("[data-rotate-cut-custom]");
  if (rotateCustom) {
    const cut = (piece.cutouts || []).find((c) => c.id === selectedCutId);
    const step = Number(document.querySelector("#cut-rotation-step")?.value || 45);
    if (cut) {
      cut.rotationDeg = ((Number(cut.rotationDeg || 0) + step * Number(rotateCustom.dataset.rotateCutCustom)) % 360 + 360) % 360;
      saveProject(); rerender();
    }
    return true;
  }
  return false;
}

// Glisser-déposer des découpes sur le plan coté.
export function bindDetailCanvas(root) {
  const svg = root.querySelector("#detail-svg");
  if (!svg) return;
  let drag = null;

  const toMm = (event) => {
    const rect = svg.getBoundingClientRect();
    const viewBox = svg.viewBox.baseVal;
    return {
      x: (event.clientX - rect.left) * viewBox.width / rect.width,
      y: (event.clientY - rect.top) * viewBox.height / rect.height,
    };
  };

  svg.addEventListener("pointerdown", (event) => {
    const cutEl = event.target.closest("[data-detail-cut]");
    if (!cutEl) return;
    const piece = getPiece();
    const cut = piece?.cutouts.find((c) => c.id === cutEl.dataset.detailCut);
    if (!cut) return;
    if (selectedCutId !== cut.id) {
      selectedCutId = cut.id;
      selectedCorner = null;
      selectedCutCorner = null;
      rerender();
      return;
    }
    svg.setPointerCapture(event.pointerId);
    const point = toMm(event);
    drag = { cut, piece, offsetX: point.x - 220 - Number(cut.xMm), offsetY: point.y - 140 - Number(cut.yMm), moved: false };
  });
  svg.addEventListener("pointermove", (event) => {
    if (!drag) return;
    const point = toMm(event);
    const b = cutoutBounds(drag.cut);
    drag.cut.xMm = Math.round(Math.min(Math.max(0, point.x - 220 - drag.offsetX), drag.piece.lengthMm - b.width));
    drag.cut.yMm = Math.round(Math.min(Math.max(0, point.y - 140 - drag.offsetY), drag.piece.widthMm - b.height));
    if (drag.cut.shape === "edge-notch") clampEdgeNotch(drag.piece, drag.cut);
    if (drag.cut.kind === "tap") drag.cut.alignToSink = false;
    drag.moved = true;
    rerender();
  });
  const endDrag = () => {
    if (drag?.moved) {
      refreshDerived(drag.piece, drag.cut);
      saveProject();
      rerender();
    }
    drag = null;
  };
  svg.addEventListener("pointerup", endDrag);
  svg.addEventListener("pointercancel", endDrag);
  svg.addEventListener("wheel", (event) => {
    event.preventDefault();
    const cfg = state.configurator;
    cfg.detailZoom = Math.min(3, Math.max(0.4, (cfg.detailZoom || 1) * (event.deltaY < 0 ? 1.1 : 0.9)));
    svg.style.width = `${Math.round(cfg.detailZoom * 100)}%`;
    svg.style.minWidth = `${Math.round(1000 * cfg.detailZoom)}px`;
    const label = root.querySelector(".detail-zoom-controls strong");
    if (label) label.textContent = `${Math.round(cfg.detailZoom * 100)} %`;
  }, { passive: false });
}

register({
  "close-details": () => {
    state.configurator.detailPieceId = null;
    selectedCutId = null; selectedCorner = null; selectedCutCorner = null;
    rerender();
  },
  "show-edges": () => { selectedCutId = null; selectedCorner = null; selectedCutCorner = null; rerender(); },
  "detail-zoom-in": () => { const cfg = state.configurator; cfg.detailZoom = Math.min(3, (cfg.detailZoom || 1) * 1.15); rerender(); },
  "detail-zoom-out": () => { const cfg = state.configurator; cfg.detailZoom = Math.max(0.4, (cfg.detailZoom || 1) * 0.87); rerender(); },
  "detail-zoom-reset": () => { state.configurator.detailZoom = 1; rerender(); },
  "delete-cut": () => {
    const piece = getPiece();
    if (!piece) return;
    piece.cutouts = (piece.cutouts || []).filter((c) => c.id !== selectedCutId);
    selectedCutId = null; selectedCutCorner = null;
    saveProject(); rerender();
  },
  "lookup-appliance": async () => {
    const piece = getPiece();
    const cut = (piece?.cutouts || []).find((c) => c.id === selectedCutId);
    if (!cut) return;
    const brand = document.querySelector("[data-cut-field=brand]")?.value || "";
    const reference = document.querySelector("[data-cut-field=reference]")?.value || "";
    if (!reference.trim()) { toast("Renseignez la référence de l'appareil.", "error"); return; }
    try {
      const result = await request("/api/appliance-lookup", { body: { brand, reference } });
      if (result.found) {
        const a = result.appliance;
        Object.assign(cut, {
          widthMm: a.cutoutWidthMm, heightMm: a.cutoutDepthMm, radiusMm: a.cornerRadiusMm ?? cut.radiusMm,
          brand: a.brand, reference: a.reference, applianceId: a.id,
          minFrontMm: a.minFrontMm ?? 50, verified: true,
        });
        if (cut.serviceId === "cut-flush") {
          cut.flushInnerWidthMm = a.cutoutWidthMm;
          cut.flushInnerHeightMm = a.cutoutDepthMm;
        }
        refreshDerived(piece, cut);
        saveProject(); rerender();
        toast(`Cotes trouvées : découpe ${a.cutoutWidthMm} × ${a.cutoutDepthMm} mm. ${result.note || ""}`);
      } else {
        toast(result.message, "error");
        if (result.suggestions?.length) toast(`Suggestions : ${result.suggestions.map((s) => s.reference).join(", ")}`);
      }
    } catch (error) { toast(error.message, "error"); }
  },
  "save-appliance": async () => {
    const piece = getPiece();
    const cut = (piece?.cutouts || []).find((c) => c.id === selectedCutId);
    if (!cut) return;
    if (!cut.brand || !cut.reference) { toast("Renseignez la marque et la référence avant d'enregistrer.", "error"); return; }
    try {
      const b = cutoutBounds(cut);
      const result = await request("/api/appliances", {
        body: {
          type: cut.kind === "hob" ? "hob" : "sink",
          brand: cut.brand, reference: cut.reference,
          cutoutWidthMm: b.width, cutoutDepthMm: b.height,
          cornerRadiusMm: cut.radiusMm, minFrontMm: cut.minFrontMm || 50,
        },
      });
      cut.verified = true;
      cut.applianceId = result.appliance.id;
      saveProject(); rerender();
      toast("Cotes enregistrées dans la base d'encastrement.");
    } catch (error) { toast(error.message, "error"); }
  },
});
