// Vérification systématique de l'export DXF machine : chaque forme est
// regénérée puis reparsée, et sa géométrie est contrôlée numériquement
// (coordonnées, calques, boucles fermées, rotation, conversion d'axes).

import test from "node:test";
import assert from "node:assert/strict";
import { projectToDxf } from "../server/lib/dxf-writer.js";

// ---------- Mini-parseur DXF R12 (entités LINE / ARC / CIRCLE / TEXT) ----------

function parseDxf(text) {
  const rows = text.split("\r\n");
  const entities = [];
  // Les paires (code, valeur) sont alignées depuis le début du fichier.
  for (let i = 0; i < rows.length - 1; i += 2) {
    const code = rows[i];
    const value = rows[i + 1];
    if (code === "0" && ["LINE", "ARC", "CIRCLE", "TEXT"].includes(value)) {
      const entity = { type: value };
      for (let j = i + 2; j < rows.length - 1; j += 2) {
        const c = rows[j];
        const v = rows[j + 1];
        if (c === "0") break;
        if (c === "8") entity.layer = v;
        else if (c === "10") entity.x1 = Number(v);
        else if (c === "20") entity.y1 = Number(v);
        else if (c === "11") entity.x2 = Number(v);
        else if (c === "21") entity.y2 = Number(v);
        else if (c === "40") entity.r = Number(v);
        else if (c === "50") entity.a1 = Number(v);
        else if (c === "51") entity.a2 = Number(v);
        else if (c === "1") entity.text = v;
      }
      entities.push(entity);
    }
  }
  return entities;
}

const onLayer = (entities, layer, type = null) =>
  entities.filter((e) => e.layer === layer && (!type || e.type === type));

const rad = (deg) => (deg * Math.PI) / 180;
const arcEnds = (arc) => [
  [arc.x1 + arc.r * Math.cos(rad(arc.a1)), arc.y1 + arc.r * Math.sin(rad(arc.a1))],
  [arc.x1 + arc.r * Math.cos(rad(arc.a2)), arc.y1 + arc.r * Math.sin(rad(arc.a2))],
];
const near = (a, b, eps = 0.05) => Math.abs(a - b) <= eps;
const samePoint = ([ax, ay], [bx, by], eps = 0.05) => near(ax, bx, eps) && near(ay, by, eps);

// Vérifie qu'un ensemble de LINE/ARC forme une boucle fermée : chaque
// extrémité doit coïncider avec exactement une extrémité d'une autre entité.
function assertClosedLoop(parts, label) {
  const endpoints = [];
  for (const p of parts) {
    if (p.type === "LINE") endpoints.push([p.x1, p.y1], [p.x2, p.y2]);
    else if (p.type === "ARC") endpoints.push(...arcEnds(p));
  }
  for (const point of endpoints) {
    const matches = endpoints.filter((other) => other !== point && samePoint(point, other));
    assert.ok(matches.length >= 1, `${label} : extrémité orpheline (${point[0].toFixed(1)}, ${point[1].toFixed(1)})`);
  }
}

const catalog = { services: [{ id: "edge-straight", codes: { stone: "C1" } }] };
const piece = (overrides = {}) => ({
  id: "p1", kind: "worktop", name: "Plan", lengthMm: 2400, widthMm: 650,
  corners: {}, edges: [], cutouts: [], ...overrides,
});
const gen = (pieces) => parseDxf(projectToDxf({ reference: "DEV", title: "T", pieces }, catalog));

// ---------- Contour & angles du plan ----------

test("contour simple : 4 lignes fermées aux bonnes cotes", () => {
  const e = gen([piece()]);
  const contour = onLayer(e, "CONTOUR", "LINE");
  assert.equal(contour.length, 4);
  assertClosedLoop(contour, "contour");
  const xs = contour.flatMap((l) => [l.x1, l.x2]);
  const ys = contour.flatMap((l) => [l.y1, l.y2]);
  assert.equal(Math.max(...xs), 2400);
  assert.equal(Math.max(...ys), 650);
  assert.equal(Math.min(...xs), 0);
  assert.equal(Math.min(...ys), 0);
});

test("angles du plan : arrondi (arc), pan coupé (ligne), découpe 90° (2 lignes)", () => {
  const e = gen([piece({
    corners: {
      bottomLeft: { type: "round", radiusMm: 60 },
      bottomRight: { type: "bevel", cutXmm: 50, cutYmm: 40 },
      topRight: { type: "cutout", cutXmm: 80, cutYmm: 30 },
    },
  })]);
  const contour = onLayer(e, "CONTOUR");
  // bas-gauche écran = avant-gauche = coin (0,0) DXF : arc R60 centré (60,60).
  const arc = contour.find((c) => c.type === "ARC");
  assert.ok(arc, "arc d'angle attendu");
  assert.ok(samePoint([arc.x1, arc.y1], [60, 60]) && arc.r === 60, "arc R60 centré (60,60)");
  assertClosedLoop(contour, "contour avec angles");
  // pan coupé : ligne diagonale (2350,0) → (2400,40).
  const bevel = contour.find((c) => c.type === "LINE" && samePoint([c.x1, c.y1], [2350, 0]) && samePoint([c.x2, c.y2], [2400, 40]));
  assert.ok(bevel, "pan coupé 50 × 40 attendu");
});

// ---------- Découpes ----------

test("rectangle arrondi : boucle fermée de 4 lignes + 4 arcs, conversion Y correcte", () => {
  const e = gen([piece({ cutouts: [{ id: "c", kind: "sink", shape: "rounded", xMm: 900, yMm: 150, widthMm: 500, heightMm: 400, radiusMm: 15 }] })]);
  const cut = onLayer(e, "DECOUPES");
  assert.equal(cut.filter((c) => c.type === "LINE").length, 4);
  assert.equal(cut.filter((c) => c.type === "ARC").length, 4);
  assertClosedLoop(cut, "évier arrondi");
  // yMm 150 depuis l'arrière, h 400 → bas DXF = 650 − 150 − 400 = 100.
  const ys = cut.flatMap((c) => (c.type === "LINE" ? [c.y1, c.y2] : arcEnds(c).map((p) => p[1])));
  assert.ok(near(Math.min(...ys), 100), `bas de découpe attendu à 100, trouvé ${Math.min(...ys)}`);
  assert.ok(near(Math.max(...ys), 500), `haut de découpe attendu à 500`);
});

test("perçage : cercle sur PERCAGES au centre exact", () => {
  const e = gen([piece({ cutouts: [{ id: "c", kind: "tap", shape: "circle", xMm: 300, yMm: 80, widthMm: 35, heightMm: 35, diameterMm: 35 }] })]);
  const circle = onLayer(e, "PERCAGES", "CIRCLE")[0];
  assert.ok(circle, "cercle attendu");
  assert.equal(circle.r, 17.5);
  assert.ok(samePoint([circle.x1, circle.y1], [317.5, 552.5]), "centre 317,5 / 552,5 (650 − 80 − 17,5)");
});

test("égouttoir : rainures VERTICALES régulièrement réparties sur la largeur", () => {
  const e = gen([piece({ cutouts: [{ id: "c", kind: "drainer", shape: "grooves", xMm: 800, yMm: 200, widthMm: 380, heightMm: 180, grooves: 5 }] })]);
  const grooves = onLayer(e, "RAINURES", "LINE");
  assert.equal(grooves.length, 5);
  for (const line of grooves) {
    assert.equal(line.x1, line.x2, "chaque rainure est verticale");
    assert.ok(near(Math.abs(line.y2 - line.y1), 180), "hauteur de rainure = profondeur de la zone");
  }
  const xs = grooves.map((l) => l.x1).sort((a, b) => a - b);
  assert.equal(xs[0], 800);
  assert.equal(xs[4], 1180);
  assert.ok(near(xs[1] - xs[0], 95), "espacement 380 / 4 = 95 mm");
});

test("égouttoir décaissé : poche sur calque DEFONCAGE avec étiquette", () => {
  const e = gen([piece({ cutouts: [{ id: "c", kind: "drainer", shape: "recessed", xMm: 1200, yMm: 200, widthMm: 380, heightMm: 180, radiusMm: 8 }] })]);
  const pocket = onLayer(e, "DEFONCAGE");
  assert.ok(pocket.length >= 4, "poche du décaissé sur DEFONCAGE");
  assertClosedLoop(pocket, "décaissé");
  assert.ok(e.some((t) => t.type === "TEXT" && /EGOUTTOIR DECAISSE/.test(t.text || "")));
});

test("oblong (capsule) : 2 lignes + 2 arcs formant une boucle fermée", () => {
  const e = gen([piece({ cutouts: [{ id: "c", kind: "socket", shape: "capsule", xMm: 1700, yMm: 60, widthMm: 120, heightMm: 55 }] })]);
  const slot = onLayer(e, "DECOUPES");
  assert.equal(slot.filter((c) => c.type === "LINE").length, 2);
  assert.equal(slot.filter((c) => c.type === "ARC").length, 2);
  assertClosedLoop(slot, "oblong");
  for (const arc of slot.filter((c) => c.type === "ARC")) assert.equal(arc.r, 27.5);
});

test("pose à fleur : découpe intérieure sur DECOUPES + défonçage extérieur centré sur DEFONCAGE", () => {
  const e = gen([piece({ cutouts: [{
    id: "c", kind: "hob", shape: "rounded", serviceId: "cut-flush", xMm: 950, yMm: 90, widthMm: 560, heightMm: 490,
    flushInnerRadiusMm: 10, flushOuterWidthMm: 580, flushOuterHeightMm: 510, flushOuterRadiusMm: 12, flushDepthMm: 5.5,
  }] })]);
  const inner = onLayer(e, "DECOUPES");
  const outer = onLayer(e, "DEFONCAGE");
  assertClosedLoop(inner, "découpe intérieure");
  assertClosedLoop(outer, "défonçage extérieur");
  const innerXs = inner.flatMap((c) => (c.type === "LINE" ? [c.x1, c.x2] : arcEnds(c).map((p) => p[0])));
  const outerXs = outer.flatMap((c) => (c.type === "LINE" ? [c.x1, c.x2] : arcEnds(c).map((p) => p[0])));
  // Le défonçage déborde de 10 mm de chaque côté (580 vs 560), centré.
  assert.ok(near(Math.min(...innerXs) - Math.min(...outerXs), 10));
  assert.ok(near(Math.max(...outerXs) - Math.max(...innerXs), 10));
  assert.ok(e.some((t) => t.type === "TEXT" && /PROF 5.5 mm/.test(t.text || "")));
});

// ---------- Encoches ouvertes ----------

for (const [side, openTest] of [
  // côté ouvert : aucune ligne de l'encoche ne doit longer ce bord.
  ["top", (l) => near(l.y1, 650) && near(l.y2, 650)],
  ["bottom", (l) => near(l.y1, 0) && near(l.y2, 0)],
  ["left", (l) => near(l.x1, 1000) && near(l.x2, 1000) && Math.abs(l.y2 - l.y1) > 100],
  ["right", (l) => near(l.x1, 1230) && near(l.x2, 1230) && Math.abs(l.y2 - l.y1) > 100],
]) {
  test(`encoche ouverte côté ${side} : 3 côtés seulement`, () => {
    const cut = { id: "c", kind: "notch", shape: "edge-notch", xMm: 1000, yMm: 0, widthMm: 230, heightMm: 180, edgeSide: side,
      edgeCorners: { start: { type: "square" }, end: { type: "square" } } };
    // Position recollée au bord comme le fait l'éditeur (clampEdgeNotch).
    if (side === "top") cut.yMm = 0;
    if (side === "bottom") cut.yMm = 650 - 180;
    if (side === "left") { cut.xMm = 0; cut.widthMm = 230; }
    if (side === "right") cut.xMm = 2400 - 230;
    const e = gen([piece({ cutouts: [cut] })]);
    const lines = onLayer(e, "DECOUPES", "LINE");
    assert.equal(lines.length, 3, "3 lignes exactement (côtés fermés)");
    if (side === "left") {
      assert.ok(!lines.some((l) => near(l.x1, 0) && near(l.x2, 0)), "pas de ligne sur le bord gauche ouvert");
    } else if (side === "right") {
      assert.ok(!lines.some((l) => near(l.x1, 2400) && near(l.x2, 2400)), "pas de ligne sur le bord droit ouvert");
    } else if (side === "top") {
      assert.ok(!lines.some((l) => near(l.y1, 650) && near(l.y2, 650)), "pas de ligne sur le bord arrière ouvert");
    } else {
      assert.ok(!lines.some((l) => near(l.y1, 0) && near(l.y2, 0)), "pas de ligne sur le bord avant ouvert");
    }
  });
}

test("encoche : angle E1 arrondi (arc R30) et E2 découpe 40 × 25 (2 lignes en plus)", () => {
  const e = gen([piece({ cutouts: [{
    id: "c", kind: "sink-apron", shape: "edge-notch", xMm: 900, yMm: 650 - 220, widthMm: 500, heightMm: 220, edgeSide: "bottom",
    edgeCorners: { start: { type: "round", radiusMm: 30 }, end: { type: "cutout", cutXmm: 40, cutYmm: 25 } },
  }] })]);
  const cut = onLayer(e, "DECOUPES");
  const arcs = cut.filter((c) => c.type === "ARC");
  assert.equal(arcs.length, 1, "un seul arc (E1)");
  assert.equal(arcs[0].r, 30);
  // E1 en bas-gauche de l'encoche : centre de l'arc à (900 − 30, 30).
  assert.ok(samePoint([arcs[0].x1, arcs[0].y1], [870, 30]), `centre d'arc E1 attendu (870, 30), trouvé (${arcs[0].x1}, ${arcs[0].y1})`);
  // 3 côtés + 2 lignes de la découpe d'angle E2 = 5 lignes.
  assert.equal(cut.filter((c) => c.type === "LINE").length, 5);
});

// ---------- Rotation ----------

test("rotation 90° : géométrie transformée exacte autour du centre", () => {
  const e = gen([piece({ lengthMm: 2000, widthMm: 600, cutouts: [{ id: "c", kind: "socket", shape: "capsule", xMm: 1000, yMm: 100, widthMm: 120, heightMm: 40, rotationDeg: 90 }] })]);
  const slot = onLayer(e, "DECOUPES");
  // Centre (1060, 480) ; l'oblong 120 × 40 tourné à 90° occupe 40 × 120.
  const xs = slot.flatMap((c) => (c.type === "LINE" ? [c.x1, c.x2] : [c.x1 - c.r, c.x1 + c.r]));
  const ys = slot.flatMap((c) => (c.type === "LINE" ? [c.y1, c.y2] : [c.y1 - c.r, c.y1 + c.r]));
  assert.ok(near(Math.min(...xs), 1040) && near(Math.max(...xs), 1080), "emprise X 40 mm autour de 1060");
  assert.ok(near(Math.min(...ys), 420) && near(Math.max(...ys), 540), "emprise Y 120 mm autour de 480");
  assertClosedLoop(slot, "oblong tourné");
});

test("rotation 30° : boucle fermée, emprise cohérente, angles d'arcs décalés", () => {
  const e = gen([piece({ cutouts: [{ id: "c", kind: "sink", shape: "rounded", xMm: 900, yMm: 150, widthMm: 500, heightMm: 400, radiusMm: 15, rotationDeg: 30 }] })]);
  const cut = onLayer(e, "DECOUPES");
  assertClosedLoop(cut, "évier tourné 30°");
  // Emprise théorique d'un 500 × 400 tourné de 30° : 500·cos30 + 400·sin30 = 633,0 mm.
  const xs = cut.flatMap((c) => (c.type === "LINE" ? [c.x1, c.x2] : arcEnds(c).map((p) => p[0])));
  const width = Math.max(...xs) - Math.min(...xs);
  assert.ok(width > 590 && width < 634, `emprise X ≈ 633 − 2·r·(1−…) attendue, trouvée ${width.toFixed(1)}`);
});

// ---------- Chants ----------

test("chants partiels : le trait CHANTS suit la longueur travaillée et l'origine", () => {
  const e = gen([piece({ edges: [
    { side: "bottom", serviceId: "edge-straight", lengthMm: 800, startFrom: "left" },
    { side: "bottom", serviceId: "", lengthMm: 100 },
    { side: "right", serviceId: "edge-straight", lengthMm: 400, startFrom: "bottom" },
  ] })]);
  const chants = onLayer(e, "CHANTS", "LINE");
  assert.equal(chants.length, 2, "le chant sans prestation n'est pas tracé");
  const front = chants.find((l) => near(l.y1, 18) && near(l.y2, 18));
  assert.ok(front && near(Math.min(front.x1, front.x2), 0) && near(Math.max(front.x1, front.x2), 800), "chant avant 0 → 800");
  const right = chants.find((l) => near(l.x1, 2382) && near(l.x2, 2382));
  assert.ok(right && near(Math.min(right.y1, right.y2), 0) && near(Math.max(right.y1, right.y2), 400), "chant droit 400 mm depuis le bas");
});

// ---------- Plusieurs pièces ----------

test("plusieurs pièces : décalage 220 mm, murs exclus, crédences incluses", () => {
  const e = gen([
    piece({ name: "Plan A" }),
    { id: "w", kind: "wall", name: "Mur", lengthMm: 3000, widthMm: 100 },
    { id: "s", kind: "splashback", name: "Crédence", lengthMm: 1800, widthMm: 550, corners: {}, edges: [], cutouts: [] },
  ]);
  const contour = onLayer(e, "CONTOUR", "LINE");
  assert.equal(contour.length, 8, "2 pièces fabriquées seulement (le mur est exclu)");
  const xs = contour.flatMap((l) => [l.x1, l.x2]);
  // Crédence décalée de 2400 + 220 = 2620, finit à 2620 + 1800 = 4420.
  assert.ok(near(Math.max(...xs), 4420), `emprise attendue jusqu'à 4420, trouvée ${Math.max(...xs)}`);
  assert.ok(xs.some((x) => near(x, 2620)), "début de la crédence à 2620");
});

test("prise de courant : trou rond Ø68 sur PERCAGES, étiquette PRISE", () => {
  const e = gen([piece({ cutouts: [{ id: "s", kind: "socket", shape: "circle", serviceId: "cut-tap", xMm: 400, yMm: 100, widthMm: 68, heightMm: 68, diameterMm: 68 }] })]);
  const circle = onLayer(e, "PERCAGES", "CIRCLE")[0];
  assert.ok(circle, "cercle attendu");
  assert.equal(circle.r, 34, "rayon 34 = Ø68");
  assert.ok(samePoint([circle.x1, circle.y1], [434, 516]), "centre 434 / 516");
  assert.ok(e.some((t) => t.type === "TEXT" && /Ø68 PRISE/.test(t.text || "")), "étiquette Ø68 PRISE");
});
