// Génération du DXF 2D machine (format ASCII R12, lisible par tous les logiciels
// de FAO / CNC du marché). Calques : CONTOUR, DECOUPES, PERCAGES, RAINURES,
// DEFONCAGE (poses à fleur et décaissés, usinage en profondeur), CHANTS, COTES.

import { edgeSegmentMm } from "../../shared/slab.js";

const LAYERS = [
  { name: "CONTOUR", color: 7 },
  { name: "DECOUPES", color: 1 },
  { name: "PERCAGES", color: 3 },
  { name: "RAINURES", color: 5 },
  { name: "DEFONCAGE", color: 4 },
  { name: "CHANTS", color: 2 },
  { name: "COTES", color: 8 },
];

class DxfBuilder {
  constructor() {
    this.entities = [];
    this.rotation = null;
  }

  // Rotation appliquée aux entités émises ensuite (repère DXF, sens trigo).
  pushRotation(cx, cy, deg) {
    this.rotation = deg % 360 ? { cx, cy, deg } : null;
  }

  popRotation() {
    this.rotation = null;
  }

  transformPoint(x, y) {
    if (!this.rotation) return [x, y];
    const { cx, cy, deg } = this.rotation;
    const a = (deg * Math.PI) / 180;
    const dx = x - cx;
    const dy = y - cy;
    return [cx + dx * Math.cos(a) - dy * Math.sin(a), cy + dx * Math.sin(a) + dy * Math.cos(a)];
  }

  line(layer, x1, y1, x2, y2) {
    const [ax, ay] = this.transformPoint(x1, y1);
    const [bx, by] = this.transformPoint(x2, y2);
    this.entities.push(["LINE", ["8", layer], ["10", ax], ["20", ay], ["11", bx], ["21", by]]);
  }

  circle(layer, cx, cy, radius) {
    const [tx, ty] = this.transformPoint(cx, cy);
    this.entities.push(["CIRCLE", ["8", layer], ["10", tx], ["20", ty], ["40", radius]]);
  }

  arc(layer, cx, cy, radius, startDeg, endDeg) {
    const [tx, ty] = this.transformPoint(cx, cy);
    const shift = this.rotation ? this.rotation.deg : 0;
    const norm = (deg) => ((deg + shift) % 360 + 360) % 360;
    this.entities.push(["ARC", ["8", layer], ["10", tx], ["20", ty], ["40", radius], ["50", norm(startDeg)], ["51", norm(endDeg)]]);
  }

  // Arc quart de cercle défini par ses deux extrémités (le sens mineur est choisi).
  arcBetween(layer, cx, cy, radius, [x1, y1], [x2, y2]) {
    const a1 = ((Math.atan2(y1 - cy, x1 - cx) * 180) / Math.PI + 360) % 360;
    const a2 = ((Math.atan2(y2 - cy, x2 - cx) * 180) / Math.PI + 360) % 360;
    if ((a2 - a1 + 360) % 360 <= 180) this.arc(layer, cx, cy, radius, a1, a2);
    else this.arc(layer, cx, cy, radius, a2, a1);
  }

  text(layer, x, y, height, value) {
    const [tx, ty] = this.transformPoint(x, y);
    this.entities.push(["TEXT", ["8", layer], ["10", tx], ["20", ty], ["40", height], ["1", value]]);
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

// Encoche ouverte sur un bord : trois côtés seulement (le côté `edgeSide` reste
// ouvert), avec traitement des nouveaux angles E1 / E2 (arrondi, coupe 45°,
// découpe d'angle). Repère : (x, y) bas-gauche de l'emprise en coordonnées DXF.
function edgeNotchOutline(dxf, cut, x, y, width, height) {
  const side = cut.edgeSide || "top";
  // Repère local : origine sur E1, u le long du bord ouvert (vers E2),
  // v vers l'intérieur de l'encoche. À l'écran comme en DXF : E1 = extrémité
  // gauche (côtés haut/bas) ou arrière (côtés gauche/droite).
  const frames = {
    top: { origin: [x, y + height], u: [1, 0], v: [0, -1], span: width, depth: height },
    bottom: { origin: [x, y], u: [1, 0], v: [0, 1], span: width, depth: height },
    left: { origin: [x, y + height], u: [0, -1], v: [1, 0], span: height, depth: width },
    right: { origin: [x + width, y + height], u: [0, -1], v: [-1, 0], span: height, depth: width },
  };
  const { origin, u, v, span, depth } = frames[side] || frames.top;
  const pt = (a, b) => [origin[0] + a * u[0] + b * v[0], origin[1] + a * u[1] + b * v[1]];
  const lineTo = (p1, p2) => dxf.line("DECOUPES", p1[0], p1[1], p2[0], p2[1]);

  // Traitement d'un angle ouvert. `dir` = +1 pour E1 (matière côté a<0),
  // -1 pour E2 (matière côté a>span). Retourne la profondeur b où démarre la
  // paroi verticale de l'encoche.
  const cornerStart = (treatment, edgeA, dir) => {
    const type = treatment?.type;
    if (type === "round") {
      const r = Math.max(0, Math.min(Number(treatment.radiusMm || 0), depth));
      if (!r) return 0;
      const center = pt(edgeA - dir * r, r);
      dxf.arcBetween("DECOUPES", center[0], center[1], r, pt(edgeA - dir * r, 0), pt(edgeA, r));
      return r;
    }
    if (type === "bevel") {
      const ax = Math.max(0, Number(treatment.cutXmm || 0));
      const ay = Math.max(0, Math.min(Number(treatment.cutYmm || 0), depth));
      if (!ax && !ay) return 0;
      lineTo(pt(edgeA - dir * ax, 0), pt(edgeA, ay));
      return ay;
    }
    if (type === "cutout") {
      const ax = Math.max(0, Number(treatment.cutXmm || 0));
      const ay = Math.max(0, Math.min(Number(treatment.cutYmm || 0), depth));
      if (!ax && !ay) return 0;
      lineTo(pt(edgeA - dir * ax, 0), pt(edgeA - dir * ax, ay));
      lineTo(pt(edgeA - dir * ax, ay), pt(edgeA, ay));
      return ay;
    }
    return 0;
  };

  const startDepth = cornerStart(cut.edgeCorners?.start, 0, 1);
  const endDepth = cornerStart(cut.edgeCorners?.end, span, -1);
  // Parois latérales puis fond fermé.
  lineTo(pt(0, startDepth), pt(0, depth));
  lineTo(pt(0, depth), pt(span, depth));
  lineTo(pt(span, depth), pt(span, endDepth));
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
      const wMm = Number(cut.widthMm || 0);
      const hMm = Number(cut.heightMm || 0);
      const cx = offsetX + Number(cut.xMm || 0);
      // Le modèle écran a Y vers le bas depuis l'arrière ; on convertit.
      const cy = W - Number(cut.yMm || 0) - hMm;
      const labelParts = [cut.brand, cut.reference].filter(Boolean).join(" ");
      // La rotation écran est horaire (Y vers le bas) : en repère DXF elle s'inverse.
      const rotationDeg = Number(cut.rotationDeg || 0);
      if (rotationDeg) dxf.pushRotation(cx + wMm / 2, cy + hMm / 2, -rotationDeg);

      if (cut.shape === "circle") {
        const radius = Number(cut.diameterMm || cut.widthMm || 35) / 2;
        dxf.circle("PERCAGES", cx + radius, W - Number(cut.yMm || 0) - radius, radius);
        dxf.popRotation();
        dxf.text("COTES", cx, W - Number(cut.yMm || 0) + 12, 25, `Ø${round(radius * 2)} ${cut.kind === "tap" ? "ROBINET" : cut.kind === "socket" ? "PRISE" : (cut.kind || "percage").toUpperCase()}`);
      } else if (cut.shape === "grooves") {
        // Rainures verticales réparties sur la largeur (identique à l'éditeur).
        const grooves = Math.max(3, Number(cut.grooves || 5));
        const spacing = wMm / (grooves - 1 || 1);
        for (let i = 0; i < grooves; i += 1) {
          const gx = cx + i * spacing;
          dxf.line("RAINURES", gx, cy, gx, cy + hMm);
        }
        dxf.popRotation();
        dxf.text("COTES", cx, cy + hMm + 12, 25, `EGOUTTOIR ${grooves} RAINURES`);
      } else if (cut.shape === "recessed") {
        // Décaissé : usinage en profondeur, pas une découpe traversante.
        const radius = Number(cut.radiusMm || 8);
        dxf.roundedRect("DEFONCAGE", cx, cy, wMm, hMm, { bl: radius, br: radius, tr: radius, tl: radius });
        dxf.popRotation();
        dxf.text("COTES", cx, cy + hMm + 12, 25, `EGOUTTOIR DECAISSE ${round(wMm)}x${round(hMm)}`);
      } else if (cut.shape === "capsule") {
        // Oblong : deux demi-cercles reliés par deux droites.
        const r = Math.min(wMm, hMm) / 2;
        dxf.line("DECOUPES", cx + r, cy, cx + wMm - r, cy);
        dxf.line("DECOUPES", cx + wMm - r, cy + hMm, cx + r, cy + hMm);
        dxf.arc("DECOUPES", cx + wMm - r, cy + r, r, 270, 90);
        dxf.arc("DECOUPES", cx + r, cy + r, r, 90, 270);
        dxf.popRotation();
        dxf.text("COTES", cx, cy + hMm + 12, 25, `${labelParts || (cut.kind || "decoupe").toUpperCase()} ${round(wMm)}x${round(hMm)}`);
      } else if (cut.shape === "edge-notch") {
        edgeNotchOutline(dxf, cut, cx, cy, wMm, hMm);
        dxf.popRotation();
        dxf.text("COTES", cx, cy + hMm + 12, 25, `${labelParts || "ENCOCHE"} ${round(wMm)}x${round(hMm)}`);
      } else {
        const isFlush = cut.serviceId === "cut-flush";
        const radius = Number((isFlush ? cut.flushInnerRadiusMm ?? cut.radiusMm : cut.radiusMm) || 0);
        dxf.roundedRect("DECOUPES", cx, cy, wMm, hMm, { bl: radius, br: radius, tr: radius, tl: radius });
        if (isFlush) {
          // Pose à fleur : défonçage extérieur centré sur la découpe.
          const ow = Number(cut.flushOuterWidthMm || wMm);
          const oh = Number(cut.flushOuterHeightMm || hMm);
          const orad = Math.max(0, Math.min(Number(cut.flushOuterRadiusMm || 0), ow / 2, oh / 2));
          const mx = cx + wMm / 2;
          const my = cy + hMm / 2;
          dxf.roundedRect("DEFONCAGE", mx - ow / 2, my - oh / 2, ow, oh, { bl: orad, br: orad, tr: orad, tl: orad });
          dxf.popRotation();
          dxf.text("COTES", cx, cy + hMm + 44, 25, `DEFONCAGE ${round(ow)}x${round(oh)} PROF ${round(Number(cut.flushDepthMm || 0))} mm`);
        } else {
          dxf.popRotation();
        }
        dxf.text("COTES", cx, cy + hMm + 12, 25, `${labelParts || (cut.kind || "decoupe").toUpperCase()} ${round(wMm)}x${round(hMm)}`);
      }
    }

    // Trait de repérage des chants travaillés + code. La longueur partielle
    // (« Longueur travaillée » + origine) est respectée : le trait ne couvre
    // que la portion réellement façonnée et facturée.
    for (const edge of piece.edges || []) {
      if (!edge.serviceId) continue;
      const service = (catalog?.services || []).find((item) => item.id === edge.serviceId);
      const code = service?.codes?.stone || "CHANT";
      const inset = 18;
      // Segment en repère écran (Y vers le bas depuis l'arrière) → repère DXF.
      const [sx1, sy1, sx2, sy2] = edgeSegmentMm(piece, edge);
      const midX = offsetX + (sx1 + sx2) / 2;
      const midY = W - (sy1 + sy2) / 2;
      if (edge.side === "bottom") {
        dxf.line("CHANTS", offsetX + sx1, inset, offsetX + sx2, inset);
        dxf.text("COTES", midX - 60, inset + 8, 22, code);
      } else if (edge.side === "top") {
        dxf.line("CHANTS", offsetX + sx1, W - inset, offsetX + sx2, W - inset);
        dxf.text("COTES", midX - 60, W - inset - 30, 22, code);
      } else if (edge.side === "left") {
        dxf.line("CHANTS", offsetX + inset, W - sy1, offsetX + inset, W - sy2);
        dxf.text("COTES", offsetX + inset + 8, midY, 22, code);
      } else if (edge.side === "right") {
        dxf.line("CHANTS", offsetX + L - inset, W - sy1, offsetX + L - inset, W - sy2);
        dxf.text("COTES", offsetX + L - inset - 90, midY, 22, code);
      }
    }

    dxf.text("COTES", offsetX, W + 55, 35, `${piece.name || piece.kind} ${round(L)} x ${round(W)} mm ep.${Number(piece.thicknessMm || project.thicknessMm || 20)}`);
    offsetX += L + GAP;
  }

  dxf.text("COTES", 0, -95, 40, `${project.reference || ""} ${project.title || ""} - ${project.customer?.name || ""}`.trim());
  return dxf.toString();
}
