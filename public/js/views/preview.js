// Aperçu SVG miniature des pièces d'un projet (utilisé dans les fiches commande).

import { esc } from "../ui.js";

const SCALE = 0.12;

export function previewPieces(project, { width = 640, height = 420 } = {}) {
  const pieces = project?.pieces || [];
  if (!pieces.length) return `<div class="empty" style="padding:30px"><p>Aucun plan dessiné.</p></div>`;

  const shapes = pieces.map((piece) => {
    const w = Math.max(24, piece.lengthMm * SCALE);
    const h = piece.kind === "wall" ? 8 : Math.max(16, piece.widthMm * SCALE);
    return { piece, w, h, x: piece.x || 0, y: piece.y || 0 };
  });
  const maxX = Math.max(...shapes.map((s) => s.x + s.w + 30), 200);
  const maxY = Math.max(...shapes.map((s) => s.y + s.h + 30), 160);

  const body = shapes.map(({ piece, w, h, x, y }) => {
    const rotation = piece.rotationDeg ? ` transform="rotate(${piece.rotationDeg} ${x + w / 2} ${y + h / 2})"` : "";
    if (piece.kind === "wall") {
      return `<g${rotation}><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="3" class="order-preview-wall" fill="#3d403b"/></g>`;
    }
    const cuts = (piece.cutouts || []).map((cut) => {
      const cx = x + cut.xMm * SCALE * (w / (piece.lengthMm * SCALE));
      const cy = y + cut.yMm * SCALE * (h / (piece.widthMm * SCALE));
      const cw = Math.max(4, cut.widthMm * SCALE);
      const ch = Math.max(4, cut.heightMm * SCALE);
      if (cut.shape === "circle") {
        return `<circle cx="${cx + cw / 2}" cy="${cy + ch / 2}" r="${Math.max(2, cw / 2)}" class="order-preview-cut" fill="none" stroke="#b0492c" stroke-width="2"/>`;
      }
      if (cut.shape === "grooves") {
        const grooves = Math.max(2, Number(cut.grooves || 5));
        let lines = "";
        for (let i = 0; i < grooves; i += 1) {
          const gy = cy + (ch / (grooves - 1)) * i;
          lines += `<line x1="${cx}" y1="${gy}" x2="${cx + cw}" y2="${gy}" class="order-preview-groove" stroke="#b0492c" stroke-width="1.6"/>`;
        }
        return lines;
      }
      return `<rect x="${cx}" y="${cy}" width="${cw}" height="${ch}" rx="2" class="order-preview-cut" fill="none" stroke="#b0492c" stroke-width="2"/>`;
    }).join("");
    const stroke = piece.kind === "splashback" ? "#8a6d3b" : "#2e7d5b";
    return `<g${rotation}><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="3" class="order-preview-piece" fill="#d9c9b6" stroke="${stroke}" stroke-width="2.4"/>${cuts}<title>${esc(piece.name || piece.kind)}</title></g>`;
  }).join("");

  return `<svg class="order-preview-svg" viewBox="0 0 ${maxX} ${maxY}" width="100%" preserveAspectRatio="xMidYMid meet" style="max-height:${height}px">${body}</svg>`;
}
