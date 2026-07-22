// Génération du DXF 2D machine (format ASCII R12, lisible par tous les logiciels
// de FAO / CNC du marché). Calques : CONTOUR, DECOUPES, PERCAGES, RAINURES,
// CHANTS, COTES.

const LAYERS = [
  { name: "CONTOUR", color: 7 },
  { name: "DECOUPES", color: 1 },
  { name: "PERCAGES", color: 3 },
  { name: "RAINURES", color: 5 },
  { name: "CHANTS", color: 2 },
  { name: "COTES", color: 8 },
];

class DxfBuilder {
  constructor() {
    this.entities = [];
  }

  line(layer, x1, y1, x2, y2) {
    this.entities.push(["LINE", ["8", layer], ["10", x1], ["20", y1], ["11", x2], ["21", y2]]);
  }

  circle(layer, cx, cy, radius) {
    this.entities.push(["CIRCLE", ["8", layer], ["10", cx], ["20", cy], ["40", radius]]);
  }

  arc(layer, cx, cy, radius, startDeg, endDeg) {
    this.entities.push(["ARC", ["8", layer], ["10", cx], ["20", cy], ["40", radius], ["50", startDeg], ["51", endDeg]]);
  }

  text(layer, x, y, height, value) {
    this.entities.push(["TEXT", ["8", layer], ["10", x], ["20", y], ["40", height], ["1", value]]);
  }

  // Rectangle avec rayons d'angle optionnels (repère : origine en bas à gauche).
  roundedRect(layer, x, y, width, height, radii = {}) {
    const r = {
      bl: Math.max(0, Math.min(radii.bl || 0, width / 2, height / 2)),
      br: Math.max(0, Math.min(radii.br || 0, width / 2, height / 2)),
      tr: Math.max(0, Math.min(radii.tr || 0, width / 2, height / 2)),
      tl: Math.max(0, Math.min(radii.tl || 0, width / 2, height / 2)),
    };
    this.line(layer, x + r.bl, y, x + width - r.br, y);
    if (r.br) this.arc(layer, x + width - r.br, y + r.br, r.br, 270, 360);
    this.line(layer, x + width, y + r.br, x + width, y + height - r.tr);
    if (r.tr) this.arc(layer, x + width - r.tr, y + height - r.tr, r.tr, 0, 90);
    this.line(layer, x + width - r.tr, y + height, x + r.tl, y + height);
    if (r.tl) this.arc(layer, x + r.tl, y + height - r.tl, r.tl, 90, 180);
    this.line(layer, x, y + height - r.tl, x, y + r.bl);
    if (r.bl) this.arc(layer, x + r.bl, y + r.bl, r.bl, 180, 270);
  }

  toString() {
    const rows = [];
    const push = (code, value) => rows.push(String(code), String(value));
    push(0, "SECTION"); push(2, "HEADER");
    push(9, "$INSUNITS"); push(70, 4); // millimètres
    push(0, "ENDSEC");
    push(0, "SECTION"); push(2, "TABLES");
    push(0, "TABLE"); push(2, "LAYER"); push(70, LAYERS.length);
    for (const layer of LAYERS) {
      push(0, "LAYER"); push(2, layer.name); push(70, 0); push(62, layer.color); push(6, "CONTINUOUS");
    }
    push(0, "ENDTAB"); push(0, "ENDSEC");
    push(0, "SECTION"); push(2, "ENTITIES");
    for (const [type, ...pairs] of this.entities) {
      push(0, type);
      for (const [code, value] of pairs) push(code, typeof value === "number" ? round(value) : value);
    }
    push(0, "ENDSEC"); push(0, "EOF");
    return rows.join("\r\n") + "\r\n";
  }
}

const round = (value) => Math.round(value * 100) / 100;

// Contour d'une pièce avec angles travaillés (grille e-marbrier) :
// round = arrondi (arc), cut = pan coupé (chanfrein), notch90 = découpe 90°
// (redan rentrant). `corners` : { bl, br, tr, tl } avec {type, radiusMm|cutMm}.
function pieceOutline(dxf, x, y, width, height, corners) {
  // Étendues dx (le long de la longueur) et dy (le long de la largeur) d'un angle.
  const spans = (corner) => {
    if (!corner || !corner.type || corner.type === "square") return { dx: 0, dy: 0 };
    if (corner.type === "round") {
      const r = Math.max(0, Math.min(Number(corner.radiusMm || 0), width / 2, height / 2));
      return { dx: r, dy: r };
    }
    return {
      dx: Math.max(0, Math.min(Number(corner.cutXmm ?? corner.cutMm ?? 0), width / 2)),
      dy: Math.max(0, Math.min(Number(corner.cutYmm ?? corner.cutMm ?? 0), height / 2)),
    };
  };
  const s = { bl: spans(corners.bl), br: spans(corners.br), tr: spans(corners.tr), tl: spans(corners.tl) };
  const isNotch = (corner) => ["cutout", "notch90"].includes(corner?.type);
  const isBevel = (corner) => ["bevel", "cut"].includes(corner?.type);

  // Parcours anti-horaire depuis le bas-gauche ; chaque angle est traité
  // entre la fin du segment entrant et le début du segment sortant.
  const cornerJoin = (corner, inEnd, outStart, arc, notchMid) => {
    if (!corner || corner.type === "square" || !corner.type) return;
    if (corner.type === "round") dxf.arc("CONTOUR", ...arc);
    else if (isBevel(corner)) dxf.line("CONTOUR", ...inEnd, ...outStart);
    else if (isNotch(corner)) {
      dxf.line("CONTOUR", ...inEnd, ...notchMid);
      dxf.line("CONTOUR", ...notchMid, ...outStart);
    }
  };

  // Bas (avant), de gauche à droite.
  dxf.line("CONTOUR", x + s.bl.dx, y, x + width - s.br.dx, y);
  cornerJoin(corners.br, [x + width - s.br.dx, y], [x + width, y + s.br.dy],
    [x + width - s.br.dx, y + s.br.dy, s.br.dx, 270, 360], [x + width - s.br.dx, y + s.br.dy]);
  // Droite, de bas en haut.
  dxf.line("CONTOUR", x + width, y + s.br.dy, x + width, y + height - s.tr.dy);
  cornerJoin(corners.tr, [x + width, y + height - s.tr.dy], [x + width - s.tr.dx, y + height],
    [x + width - s.tr.dx, y + height - s.tr.dy, s.tr.dx, 0, 90], [x + width - s.tr.dx, y + height - s.tr.dy]);
  // Haut (arrière), de droite à gauche.
  dxf.line("CONTOUR", x + width - s.tr.dx, y + height, x + s.tl.dx, y + height);
  cornerJoin(corners.tl, [x + s.tl.dx, y + height], [x, y + height - s.tl.dy],
    [x + s.tl.dx, y + height - s.tl.dy, s.tl.dx, 90, 180], [x + s.tl.dx, y + height - s.tl.dy]);
  // Gauche, de haut en bas.
  dxf.line("CONTOUR", x, y + height - s.tl.dy, x, y + s.bl.dy);
  cornerJoin(corners.bl, [x, y + s.bl.dy], [x + s.bl.dx, y],
    [x + s.bl.dx, y + s.bl.dy, s.bl.dx, 180, 270], [x + s.bl.dx, y + s.bl.dy]);
}

// Écrit chaque pièce fabriquée côte à côte avec ses découpes et annotations.
export function projectToDxf(project, catalog) {
  const dxf = new DxfBuilder();
  const manufactured = (project.pieces || []).filter((piece) => ["worktop", "splashback", "panel"].includes(piece.kind));
  let offsetX = 0;
  const GAP = 220;

  for (const piece of manufactured) {
    const L = Number(piece.lengthMm || 0);
    const W = Number(piece.widthMm || 0);
    const corners = piece.corners || {};
    // En repère DXF (Y vers le haut), l'avant du plan (bottom à l'écran) est en Y=0.
    // À l'écran, top = arrière : topLeft écran = coin (x, W) en DXF.
    pieceOutline(dxf, offsetX, 0, L, W, {
      bl: corners.bottomLeft, br: corners.bottomRight,
      tr: corners.topRight, tl: corners.topLeft,
    });

    for (const cut of piece.cutouts || []) {
      const cx = offsetX + Number(cut.xMm || 0);
      // Le modèle écran a Y vers le bas depuis l'arrière ; on convertit.
      const cy = W - Number(cut.yMm || 0) - Number(cut.heightMm || 0);
      if (cut.shape === "circle") {
        const radius = Number(cut.diameterMm || cut.widthMm || 35) / 2;
        dxf.circle("PERCAGES", cx + radius, W - Number(cut.yMm || 0) - radius, radius);
        dxf.text("COTES", cx, W - Number(cut.yMm || 0) + 12, 25, `Ø${round(radius * 2)} ${cut.kind === "tap" ? "ROBINET" : cut.kind.toUpperCase()}`);
      } else if (cut.shape === "grooves") {
        const grooves = Math.max(1, Number(cut.grooves || 5));
        const spacing = Number(cut.heightMm || 400) / (grooves - 1 || 1);
        for (let i = 0; i < grooves; i += 1) {
          const y = cy + i * spacing;
          dxf.line("RAINURES", cx, y, cx + Number(cut.widthMm || 0), y);
        }
        dxf.text("COTES", cx, cy + Number(cut.heightMm || 0) + 12, 25, `EGOUTTOIR ${grooves} RAINURES`);
      } else {
        const radius = Number(cut.radiusMm || 0);
        dxf.roundedRect("DECOUPES", cx, cy, Number(cut.widthMm || 0), Number(cut.heightMm || 0), { bl: radius, br: radius, tr: radius, tl: radius });
        const label = [cut.brand, cut.reference].filter(Boolean).join(" ") || cut.kind.toUpperCase();
        dxf.text("COTES", cx, cy + Number(cut.heightMm || 0) + 12, 25, `${label} ${round(cut.widthMm)}x${round(cut.heightMm)}`);
      }
    }

    // Trait de repérage des chants travaillés + code.
    for (const edge of piece.edges || []) {
      const service = (catalog?.services || []).find((item) => item.id === edge.serviceId);
      const code = service?.codes?.stone || "CHANT";
      const inset = 18;
      if (edge.side === "bottom") {
        dxf.line("CHANTS", offsetX, inset, offsetX + L, inset);
        dxf.text("COTES", offsetX + L / 2 - 60, inset + 8, 22, code);
      } else if (edge.side === "top") {
        dxf.line("CHANTS", offsetX, W - inset, offsetX + L, W - inset);
        dxf.text("COTES", offsetX + L / 2 - 60, W - inset - 30, 22, code);
      } else if (edge.side === "left") {
        dxf.line("CHANTS", offsetX + inset, 0, offsetX + inset, W);
        dxf.text("COTES", offsetX + inset + 8, W / 2, 22, code);
      } else if (edge.side === "right") {
        dxf.line("CHANTS", offsetX + L - inset, 0, offsetX + L - inset, W);
        dxf.text("COTES", offsetX + L - inset - 90, W / 2, 22, code);
      }
    }

    dxf.text("COTES", offsetX, W + 55, 35, `${piece.name || piece.kind} ${round(L)} x ${round(W)} mm ep.${Number(piece.thicknessMm || project.thicknessMm || 20)}`);
    offsetX += L + GAP;
  }

  dxf.text("COTES", 0, -95, 40, `${project.reference || ""} ${project.title || ""} - ${project.customer?.name || ""}`.trim());
  return dxf.toString();
}
