// Géométrie des pièces : contour avec angles travaillés et découpes.
// Repère : millimètres, origine en haut à gauche de la pièce, Y vers le bas
// (le haut = chant arrière d'un plan, le bas = chant avant).
//
// Modèle d'angle (piece.corners[key]) :
//   { type: "square" | "round" | "bevel" | "cutout",
//     radiusMm,                    — arrondi
//     cutXmm, cutYmm,              — dimensions du pan coupé / de la découpe
//     outerRadiusAmm, innerRadiusMm, outerRadiusBmm } — rayons de la découpe d'angle

export function cornerSpans(corner, lengthMm, widthMm) {
  const dx = Math.min(lengthMm / 2, Number(corner?.type === "round" ? corner.radiusMm : corner?.cutXmm) || 0);
  const dy = Math.min(widthMm / 2, Number(corner?.type === "round" ? corner.radiusMm : corner?.cutYmm) || 0);
  return { dx, dy };
}

// Sommets du contour (sens horaire depuis le haut-gauche), avec rayon de
// raccord par sommet. Rendu ensuite en quadratiques par roundedPath().
export function slabVertices(piece) {
  const L = Number(piece.lengthMm || 0);
  const W = Number(piece.widthMm || 0);
  const corners = piece.corners || {};
  const vertices = [];

  const pushCorner = (key, cx, cy, signX, signY) => {
    // (cx, cy) = coin théorique ; signX/signY orientent vers l'intérieur.
    const corner = corners[key];
    if (!corner || corner.type === "square" || !corner.type) {
      vertices.push({ x: cx, y: cy, r: 0 });
      return;
    }
    const { dx, dy } = cornerSpans(corner, L, W);
    if (corner.type === "round") {
      vertices.push({ x: cx, y: cy, r: Math.min(dx, dy) });
      return;
    }
    // Ordre des deux points selon le sens de parcours (horaire).
    const horizontalFirst = (key === "topRight" || key === "bottomLeft");
    const pointOnH = { x: cx + signX * dx, y: cy, r: 0 };
    const pointOnV = { x: cx, y: cy + signY * dy, r: 0 };
    if (corner.type === "bevel") {
      const [a, b] = horizontalFirst ? [pointOnH, pointOnV] : [pointOnV, pointOnH];
      vertices.push(a, b);
      return;
    }
    // cutout : redan rentrant avec rayons de raccord A / intérieur / B.
    const rA = Number(corner.outerRadiusAmm || 0);
    const rI = Number(corner.innerRadiusMm || 0);
    const rB = Number(corner.outerRadiusBmm || 0);
    const inner = { x: cx + signX * dx, y: cy + signY * dy, r: rI };
    const first = horizontalFirst ? { ...pointOnH, r: rA } : { ...pointOnV, r: rA };
    const last = horizontalFirst ? { ...pointOnV, r: rB } : { ...pointOnH, r: rB };
    vertices.push(first, inner, last);
  };

  pushCorner("topLeft", 0, 0, 1, 1);
  pushCorner("topRight", L, 0, -1, 1);
  pushCorner("bottomRight", L, W, -1, -1);
  pushCorner("bottomLeft", 0, W, 1, -1);
  return vertices;
}

// Chemin SVG fermé avec raccords en quadratique (rayon par sommet).
export function roundedPath(vertices, ox = 0, oy = 0, scale = 1) {
  const points = vertices.map((p) => ({ x: ox + p.x * scale, y: oy + p.y * scale, r: (p.r || 0) * scale }));
  if (points.length < 3) return "";
  const count = points.length;
  const parts = [];
  for (let i = 0; i < count; i += 1) {
    const prev = points[(i - 1 + count) % count];
    const cur = points[i];
    const next = points[(i + 1) % count];
    const inLen = Math.hypot(prev.x - cur.x, prev.y - cur.y);
    const outLen = Math.hypot(next.x - cur.x, next.y - cur.y);
    const radius = Math.min(cur.r, inLen / 2, outLen / 2);
    if (!radius) {
      parts.push(`${i === 0 ? "M" : "L"} ${round(cur.x)} ${round(cur.y)}`);
      continue;
    }
    const entry = {
      x: cur.x + (prev.x - cur.x) * radius / inLen,
      y: cur.y + (prev.y - cur.y) * radius / inLen,
    };
    const exit = {
      x: cur.x + (next.x - cur.x) * radius / outLen,
      y: cur.y + (next.y - cur.y) * radius / outLen,
    };
    if (i === 0) parts.push(`M ${round(entry.x)} ${round(entry.y)}`);
    else parts.push(`L ${round(entry.x)} ${round(entry.y)}`);
    parts.push(`Q ${round(cur.x)} ${round(cur.y)} ${round(exit.x)} ${round(exit.y)}`);
  }
  return `${parts.join(" ")} Z`;
}

export function slabPath(piece, ox = 0, oy = 0, scale = 1) {
  return roundedPath(slabVertices(piece), ox, oy, scale);
}

const round = (v) => Math.round(v * 100) / 100;

// Rectangle englobant d'une découpe (mm, repère pièce).
export function cutoutBounds(cut) {
  const w = Number(cut.diameterMm || cut.widthMm || 0);
  const h = Number(cut.shape === "circle" ? (cut.diameterMm || cut.heightMm) : cut.heightMm || 0);
  return { x: Number(cut.xMm || 0), y: Number(cut.yMm || 0), width: w, height: h };
}

// Position d'une encoche ouverte sur un bord : recolle la découpe au bord choisi.
export function clampEdgeNotch(piece, cut) {
  const b = cutoutBounds(cut);
  if (cut.edgeSide === "top") cut.yMm = 0;
  else if (cut.edgeSide === "bottom") cut.yMm = Math.max(0, piece.widthMm - b.height);
  else if (cut.edgeSide === "left") cut.xMm = 0;
  else if (cut.edgeSide === "right") cut.xMm = Math.max(0, piece.lengthMm - b.width);
}
