// Aperçu SVG des pièces d'un projet (fiches commande) — utilise le rendu
// partagé « Vue d'ensemble » identique aux documents imprimés.

import { overviewSvg } from "/shared/plan-svg.js";

export function previewPieces(project, { height = 420 } = {}) {
  if (!(project?.pieces || []).length) {
    return `<div class="empty" style="padding:30px"><p>Aucun plan dessiné.</p></div>`;
  }
  const { svg } = overviewSvg(project, { numbered: true, maxHeightPx: height });
  return svg;
}
