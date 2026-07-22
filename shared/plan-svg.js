// Rendus SVG partagés (client + serveur) :
// - overviewSvg : « Vue d'ensemble du projet » avec repères numérotés,
// - technicalSvg : « Plan technique entièrement coté » d'une pièce.
// Reproduit la présentation des documents imprimés d'origine.

import { slabPath, cutoutBounds } from "./slab.js";

const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const num = (value) => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(Number(value || 0));
const mm = (value) => Math.round(Number(value || 0));

const CUT_TITLES = {
  hob: "Table de cuisson", sink: "Évier", "sink-apron": "Évier timbre", tap: "Trou robinet",
  socket: "Prise", custom: "Découpe", notch: "Encoche", drainer: "Rainurage égouttoir",
};

const SERVICE_SHORT = {
  "cut-rough": "découpe brute", "cut-flush": "découpe à fleur", "cut-polished": "découpe polie sous-plan",
  "cut-apron-sink": "évier timbre", "sink-integrated": "encastré dans la matière", "sink-glued": "collé sous plan",
  "drainer-5": "5 rainures", "drainer-recessed": "décaissé fond plat", "cut-tap": "perçage", "cut-inside": "encoche",
};

function cutGraphic(cut, ox, oy, { detail = false } = {}) {
  const b = cutoutBounds(cut);
  const x = ox + b.x;
  const y = oy + b.y;
  const cx = x + b.width / 2;
  const cy = y + b.height / 2;
  const stroke = "#b0492c";
  const rotation = Number(cut.rotationDeg || 0) ? ` transform="rotate(${cut.rotationDeg} ${cx} ${cy})"` : "";
  let body = "";
  if (cut.shape === "circle") {
    body = `<circle cx="${cx}" cy="${cy}" r="${b.width / 2}" fill="#fff" stroke="${stroke}" stroke-width="3"/>`;
  } else if (cut.shape === "capsule") {
    body = `<rect x="${x}" y="${y}" width="${b.width}" height="${b.height}" rx="${b.height / 2}" fill="#fff" stroke="${stroke}" stroke-width="3"/>`;
  } else if (cut.shape === "grooves") {
    const grooves = Math.max(3, Number(cut.grooves || 5));
    let lines = "";
    for (let i = 0; i < grooves; i += 1) {
      const gx = x + (b.width / (grooves - 1)) * i;
      lines += `<line x1="${gx}" y1="${y}" x2="${gx}" y2="${y + b.height}" stroke="${stroke}" stroke-width="2.5"/>`;
    }
    body = `${lines}<rect x="${x}" y="${y}" width="${b.width}" height="${b.height}" fill="none" stroke="${stroke}" stroke-width="1.6" stroke-dasharray="9 7"/>`;
  } else if (cut.shape === "recessed") {
    body = `<rect x="${x}" y="${y}" width="${b.width}" height="${b.height}" rx="${cut.radiusMm || 8}" fill="#fff" stroke="${stroke}" stroke-width="2.6" stroke-dasharray="11 8"/>`;
  } else if (cut.shape === "edge-notch") {
    const side = cut.edgeSide || "top";
    const segs = [];
    if (side !== "top") segs.push([x, y, x + b.width, y]);
    if (side !== "bottom") segs.push([x, y + b.height, x + b.width, y + b.height]);
    if (side !== "left") segs.push([x, y, x, y + b.height]);
    if (side !== "right") segs.push([x + b.width, y, x + b.width, y + b.height]);
    body = `<rect x="${x}" y="${y}" width="${b.width}" height="${b.height}" fill="#fff" stroke="none"/>`
      + segs.map(([x1, y1, x2, y2]) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="3"/>`).join("");
  } else {
    body = `<rect x="${x}" y="${y}" width="${b.width}" height="${b.height}" rx="${cut.radiusMm || 0}" fill="#fff" stroke="${stroke}" stroke-width="3"/>`;
  }
  if (cut.serviceId === "cut-flush" && cut.shape !== "circle") {
    const ow = Number(cut.flushOuterWidthMm || b.width);
    const oh = Number(cut.flushOuterHeightMm || b.height);
    body += `<rect x="${cx - ow / 2}" y="${cy - oh / 2}" width="${ow}" height="${oh}" rx="${cut.flushOuterRadiusMm || 0}" fill="none" stroke="${stroke}" stroke-width="1.6" stroke-dasharray="12 8"/>`;
  }
  let labels = "";
  if (detail) {
    if (cut.shape === "circle") {
      labels = `<g><rect x="${cx - 120}" y="${cy - b.width / 2 - 42}" width="240" height="30" fill="#fff" stroke="${stroke}" stroke-width="1"/>
        <text x="${cx}" y="${cy - b.width / 2 - 20}" text-anchor="middle" font-size="22" font-weight="600" fill="#7a3a22">${esc(CUT_TITLES[cut.kind] || "Perçage")} · Ø ${num(b.width)} mm</text></g>`;
    } else {
      const title = `${CUT_TITLES[cut.kind] || "Découpe"} · ${SERVICE_SHORT[cut.serviceId] || ""}${cut.brand || cut.reference ? ` · ${[cut.brand, cut.reference].filter(Boolean).join(" ")}` : ""}`;
      const dims = `${num(b.width)} × ${num(b.height)}${cut.radiusMm ? ` · R : ${num(cut.radiusMm)} mm` : ""}`;
      const flush = cut.serviceId === "cut-flush"
        ? `<text x="${cx}" y="${cy + 34}" text-anchor="middle" font-size="19" fill="#7a3a22">Défonçage ext. ${num(cut.flushOuterWidthMm || b.width)} × ${num(cut.flushOuterHeightMm || b.height)} mm - profondeur ${Number(cut.flushDepthMm || 0)} mm</text>` : "";
      labels = `<text x="${cx}" y="${cy - 14}" text-anchor="middle" font-size="19" font-weight="600" fill="#7a3a22">${esc(title)}</text>
        <text x="${cx}" y="${cy + 12}" text-anchor="middle" font-size="23" font-weight="700" fill="#7a3a22">${dims}</text>${flush}`;
    }
  }
  return `<g${rotation}>${body}${labels}</g>`;
}

// ---------- Vue d'ensemble ----------

const OVERVIEW_SCALE = 0.28;

export function overviewSvg(project, { numbered = true, maxHeightPx = 760 } = {}) {
  const pieces = (project.pieces || []);
  if (!pieces.length) return { svg: "", legend: [] };
  const scale = OVERVIEW_SCALE;
  const placed = pieces.map((piece) => {
    const w = piece.lengthMm * scale;
    const h = piece.kind === "wall" ? 26 : piece.widthMm * scale;
    return { piece, x: (piece.x || 0) * 2.4, y: (piece.y || 0) * 2.4, w, h };
  });
  const maxX = Math.max(...placed.map((p) => p.x + p.w)) + 80;
  const maxY = Math.max(...placed.map((p) => p.y + p.h)) + 60;
  const legend = [];
  let counter = 0;
  const body = placed.map(({ piece, x, y, w, h }) => {
    const rotation = piece.rotationDeg ? ` transform="rotate(${piece.rotationDeg} ${x + w / 2} ${y + h / 2})"` : "";
    if (piece.kind === "wall") {
      return `<g${rotation}><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" fill="#3d403b"/></g>`;
    }
    counter += 1;
    legend.push({ index: counter, name: piece.name || piece.kind, lengthMm: piece.lengthMm, widthMm: piece.widthMm, rotationDeg: piece.rotationDeg || 0 });
    const inner = `translate(${x} ${y}) scale(${scale})`;
    const cuts = (piece.cutouts || []).map((cut) => cutGraphic(cut, 0, 0)).join("");
    const stroke = piece.kind === "splashback" ? "#8a8d86" : "#2e7d5b";
    const badge = numbered ? `<g><circle cx="${x + w / 2}" cy="${y + h / 2}" r="15" fill="#fff" stroke="#20231f" stroke-width="1.6"/>
      <text x="${x + w / 2}" y="${y + h / 2 + 5}" text-anchor="middle" font-size="15" font-weight="600" fill="#20231f">${counter}</text></g>` : "";
    return `<g${rotation}><g transform="${inner}">
      <path d="${slabPath(piece)}" fill="#d9c9b6" stroke="${stroke}" stroke-width="${10 / scale * 0.28}"/>
      ${cuts}</g>${badge}</g>`;
  }).join("");
  const svg = `<svg viewBox="0 0 ${Math.max(maxX, 700)} ${Math.max(maxY, 420)}" width="100%" style="max-height:${maxHeightPx}px" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;
  return { svg, legend };
}

// ---------- Plan technique entièrement coté ----------

export function technicalSvg(piece, { face = null } = {}) {
  const isFace = face ?? ["splashback", "panel"].includes(piece.kind);
  const L = Number(piece.lengthMm || 0);
  const W = Number(piece.widthMm || 0);
  const cuts = piece.cutouts || [];
  const ox = 230;
  const oy = 120;
  const vbWidth = L + ox + 150 + cuts.length * 62 + 170;
  const vbHeight = W + oy + 190 + cuts.length * 48 + 70;
  const refEdge = isFace ? "chant bas" : "chant avant";

  const dim = (x1, y1, x2, y2, label, vertical = false) => {
    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2;
    return `<g color="#3f5b73">
      <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="currentColor" stroke-width="1.6" marker-start="url(#tech-arrow)" marker-end="url(#tech-arrow)"/>
      <text x="${vertical ? x1 - 10 : midX}" y="${vertical ? midY : y1 - 8}" text-anchor="middle" font-size="22" fill="currentColor"${vertical ? ` transform="rotate(-90 ${x1 - 10} ${midY})"` : ""}>${esc(label)}</text></g>`;
  };

  const parts = [];
  parts.push(dim(ox, oy - 60, ox + L, oy - 60, `Longueur ${num(L)} mm`));
  parts.push(dim(ox - 90, oy, ox - 90, oy + W, `Largeur ${num(W)} mm`, true));

  // Rayons d'angle (repères Rxx à l'intérieur des coins).
  for (const [key, corner] of Object.entries(piece.corners || {})) {
    if (!corner || corner.type !== "round") continue;
    const x = key.includes("Left") ? ox + 34 : ox + L - 34;
    const y = key.includes("top") ? oy + 30 : oy + W - 18;
    parts.push(`<text x="${x}" y="${y}" text-anchor="middle" font-size="21" font-weight="600" fill="#2e7d5b">R${num(corner.radiusMm)}</text>`);
  }

  let bottomLevel = 0;
  let rightLevel = 0;
  for (const cut of cuts) {
    const b = cutoutBounds(cut);
    const axisX = b.x + b.width / 2;
    const axisCenterY = oy + b.y + b.height / 2;
    const bottomY = oy + W + 120 + bottomLevel * 48;
    parts.push(`<line x1="${ox + axisX}" y1="${axisCenterY}" x2="${ox + axisX}" y2="${bottomY}" stroke="#9aa7b4" stroke-width="1" stroke-dasharray="7 7"/>`);
    parts.push(dim(ox, bottomY, ox + axisX, bottomY, `Axe depuis gauche ${num(mm(axisX))} mm`));
    bottomLevel += 1;
    const rightX = ox + L + 84 + rightLevel * 56;
    parts.push(`<line x1="${ox + b.x + b.width / 2}" y1="${axisCenterY}" x2="${rightX}" y2="${axisCenterY}" stroke="#9aa7b4" stroke-width="1" stroke-dasharray="7 7"/>`);
    parts.push(dim(rightX, axisCenterY, rightX, oy + W, `Axe depuis ${refEdge} ${num(mm(W - b.y - b.height / 2))} mm`, true));
    rightLevel += 1;
    if (["hob", "sink"].includes(cut.kind)) {
      const rightX2 = ox + L + 84 + rightLevel * 56;
      parts.push(dim(rightX2, oy + b.y + b.height, rightX2, oy + W, `Recul ${refEdge} ${num(mm(W - b.y - b.height))} mm`, true));
      rightLevel += 1;
    }
  }

  return `<svg viewBox="0 0 ${vbWidth} ${vbHeight}" width="100%" xmlns="http://www.w3.org/2000/svg">
    <defs><marker id="tech-arrow" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto"><path d="M8,0 L0,4 L8,8" fill="none" stroke="currentColor"/></marker></defs>
    <path d="${slabPath(piece, ox, oy)}" fill="#e2d5c2" stroke="#2e7d5b" stroke-width="5"/>
    ${cuts.map((cut) => cutGraphic(cut, ox, oy, { detail: true })).join("")}
    ${parts.join("")}
    <text x="${ox + L / 2}" y="${oy + W + 62}" text-anchor="middle" font-size="24" letter-spacing="5" fill="#40433e">${isFace ? "Chant bas" : "Chant avant"}</text>
  </svg>`;
}
