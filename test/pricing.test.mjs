// Tests du moteur de chiffrage — portage des règles e-marbrier validées.
// TOUS les montants attendus sont calculés À LA MAIN (jamais repris du code).
// Cas de référence du brief : 120,06 × 2,10 = 252,126 → 252,13 ;
// 252,13 × 1,3 = 327,769 → 327,77 (et NON 327,76 avec un seul arrondi final).

import test from "node:test";
import assert from "node:assert/strict";
import { computeQuote } from "../shared/pricing.js";

// Catalogue minimal : Silestone Arden Blue (variantes réelles de l'import) +
// grille de façonnage e-marbrier (28,00 / 34,19 / 67,77) + chant Bazin à 8 €.
const catalog = {
  materials: [{
    id: "silestone-arden-blue",
    brand: "Silestone",
    color: "Arden Blue",
    family: "stone",
    active: true,
    variants: [
      { finish: "POLI", finishLabel: "Poli lisse et brillant", thicknessMm: 12, priceM2: 120.06, maxLengthMm: 3200, maxWidthMm: 1600 },
      { finish: "POLI", finishLabel: "Poli lisse et brillant", thicknessMm: 20, priceM2: 140.04, maxLengthMm: 3200, maxWidthMm: 1600 },
      { finish: "SUEDE", finishLabel: "Suède", thicknessMm: 12, priceM2: 132.07, maxLengthMm: 3200, maxWidthMm: 1600 },
    ],
  }],
  services: [
    { id: "edge-straight", category: "edge", label: "Chant droit chanfreiné", codes: { stone: "C1", ultra: "C1D" }, prices: { stone: 8, ultra: 13 }, unit: "ml", active: true },
    { id: "corner-90", category: "shape", label: "Découpe d'angle 90°", codes: { stone: "90G/90D", ultra: "90G/90D" }, prices: { stone: 28, ultra: 28 }, unit: "un", active: true },
    { id: "corner-bevel", category: "shape", label: "Pan coupé", codes: { stone: "PCG/PCD", ultra: "PCG/PCD" }, prices: { stone: 34.19, ultra: 34.19 }, unit: "un", active: true },
    { id: "corner-round-end", category: "shape", label: "Extrémité arrondie", codes: { stone: "ARR", ultra: "ARR" }, prices: { stone: 67.77, ultra: 67.77 }, unit: "un", active: true },
    { id: "cut-tap", category: "cutout", label: "Perçage robinet / prise", codes: { stone: "FT", ultra: "FTD" }, prices: { stone: 17, ultra: 21 }, unit: "un", active: true },
  ],
};

const settings = {
  deliveryTiers: [
    { maxKm: 100, price: 95 },
    { maxKm: 200, price: 160 },
  ],
};

// Projet de base : marge 110 % (= coef e-marbrier 2,10), TVA 20 %, sans livraison.
function makeProject(overrides = {}) {
  return {
    materialId: "silestone-arden-blue",
    thicknessMm: 12,
    finish: "POLI",
    marginPct: 110,
    vatPct: 20,
    deliveryDistanceKm: 0,
    manualQuoteLines: [],
    commercialDiscount: { mode: "percent", value: 0 },
    pieces: [],
    ...overrides,
  };
}

const worktop = (lengthMm, widthMm, extra = {}) => ({
  id: "p1", kind: "worktop", name: "Plan 1", lengthMm, widthMm,
  cutouts: [], edges: [], corners: {}, ...extra,
});

const materialLine = (quote) => quote.lines.find((l) => l.category === "Matière");

test("1. P.U. vente = round(achat × 2,10) : 120,06 → 252,13", () => {
  const quote = computeQuote(makeProject({ pieces: [worktop(2000, 650)] }), catalog, settings);
  assert.equal(materialLine(quote).customerUnitPrice, 252.13);
});

test("2. DOUBLE ARRONDI : 252,13 × 1,3 = 327,77 (pas 327,76)", () => {
  // Un seul arrondi final donnerait round(120,06 × 2,1 × 1,3) = round(327,7638) = 327,76.
  const quote = computeQuote(makeProject({ pieces: [worktop(2000, 650)] }), catalog, settings);
  assert.equal(materialLine(quote).customerAmount, 327.77);
  assert.notEqual(materialLine(quote).customerAmount, 327.76);
});

test("3. Montant achat usine : 120,06 × 1,3 = 156,078 → 156,08", () => {
  const quote = computeQuote(makeProject({ pieces: [worktop(2000, 650)] }), catalog, settings);
  assert.equal(materialLine(quote).factoryAmount, 156.08);
});

test("4. Surface JAMAIS arrondie : 1234 × 567 mm = 0,699678 m²", () => {
  // achat : 120,06 × 0,699678 = 84,0033… → 84,00 (avec surface arrondie à 0,7 : 84,04)
  const quote = computeQuote(makeProject({ pieces: [worktop(1234, 567)] }), catalog, settings);
  assert.equal(materialLine(quote).factoryAmount, 84.00);
});

test("5. Surface exacte côté client : 252,13 × 0,699678 = 176,41 (pas 176,49)", () => {
  const quote = computeQuote(makeProject({ pieces: [worktop(1234, 567)] }), catalog, settings);
  assert.equal(materialLine(quote).customerAmount, 176.41);
});

test("6. Chant au ml : 1,8 ml à 8 € → achat 14,40 ; vente 16,80 × 1,8 = 30,24", () => {
  const piece = worktop(1800, 650, { edges: [{ side: "bottom", serviceId: "edge-straight", lengthMm: 1800 }] });
  const quote = computeQuote(makeProject({ pieces: [piece] }), catalog, settings);
  const edge = quote.lines.find((l) => l.category === "Chant");
  assert.equal(edge.factoryAmount, 14.4);
  assert.equal(edge.customerUnitPrice, 16.8);
  assert.equal(edge.customerAmount, 30.24);
});

test("7. Extrémité arrondie : forfait 67,77 → vente round(142,317) = 142,32", () => {
  const piece = worktop(2000, 650, { corners: { bottomRight: { type: "round", radiusMm: 300 } } });
  const quote = computeQuote(makeProject({ pieces: [piece] }), catalog, settings);
  const corner = quote.lines.find((l) => l.category === "Façonnage");
  assert.equal(corner.factoryUnitPrice, 67.77);
  assert.equal(corner.customerUnitPrice, 142.32);
});

test("8. Pan coupé : forfait 34,19 → vente round(71,799) = 71,80", () => {
  const piece = worktop(2000, 650, { corners: { topLeft: { type: "cut", cutMm: 40 } } });
  const quote = computeQuote(makeProject({ pieces: [piece] }), catalog, settings);
  const corner = quote.lines.find((l) => l.category === "Façonnage");
  assert.equal(corner.factoryUnitPrice, 34.19);
  assert.equal(corner.customerUnitPrice, 71.8);
});

test("9. Découpe d'angle 90° : forfait 28,00 → vente 58,80", () => {
  const piece = worktop(2000, 650, { corners: { bottomLeft: { type: "notch90", cutMm: 200 } } });
  const quote = computeQuote(makeProject({ pieces: [piece] }), catalog, settings);
  const corner = quote.lines.find((l) => l.category === "Façonnage");
  assert.equal(corner.factoryUnitPrice, 28);
  assert.equal(corner.customerUnitPrice, 58.8);
});

test("10. SNAPSHOT : un changement de tarif catalogue ne change pas un devis existant", () => {
  const snapshot = {};
  const project = makeProject({ pieces: [worktop(2000, 650)] });
  const before = computeQuote(project, catalog, settings, { snapshot });
  const expensive = structuredClone(catalog);
  expensive.materials[0].variants[0].priceM2 = 999;
  const after = computeQuote(project, expensive, settings, { snapshot });
  assert.equal(after.purchaseHT, before.purchaseHT);
  assert.equal(materialLine(after).factoryUnitPrice, 120.06);
});

test("11. Sans snapshot, le nouveau tarif s'applique (nouveau devis)", () => {
  const expensive = structuredClone(catalog);
  expensive.materials[0].variants[0].priceM2 = 999;
  const quote = computeQuote(makeProject({ pieces: [worktop(2000, 650)] }), expensive, settings);
  assert.equal(materialLine(quote).factoryUnitPrice, 999);
});

test("12. Livraison par tranche : 42 km → 95 € ; 150 km → 160 €", () => {
  const q42 = computeQuote(makeProject({ pieces: [worktop(2000, 650)], deliveryDistanceKm: 42 }), catalog, settings);
  const q150 = computeQuote(makeProject({ pieces: [worktop(2000, 650)], deliveryDistanceKm: 150 }), catalog, settings);
  assert.equal(q42.delivery, 95);
  assert.equal(q150.delivery, 160);
});

test("13. Livraison groupée : forfait 95 partagé entre 2 commandes → 47,50", () => {
  const quote = computeQuote(makeProject({ pieces: [worktop(2000, 650)], deliveryDistanceKm: 42 }), catalog, settings,
    { groupSize: 2, groupDeliveryTotal: 95 });
  assert.equal(quote.delivery, 47.5);
});

test("14. TVA 20 % ligne à ligne : 327,77 → TVA 65,55 → TTC 393,32", () => {
  const quote = computeQuote(makeProject({ pieces: [worktop(2000, 650)] }), catalog, settings);
  const line = materialLine(quote);
  assert.equal(line.customerVatAmount, 65.55);
  assert.equal(line.customerTTC, 393.32);
});

test("15. Remise 10 % sur le sous-total TTC", () => {
  // Matière seule : HT 327,77 ; TVA 65,55 ; TTC 393,32 ; remise 39,33 ; net 353,99.
  const quote = computeQuote(makeProject({
    pieces: [worktop(2000, 650)],
    commercialDiscount: { mode: "percent", value: 10 },
  }), catalog, settings);
  assert.equal(quote.customerSubtotalTTC, 393.32);
  assert.equal(quote.discountTTC, 39.33);
  assert.equal(quote.customerTTC, 353.99);
});

test("16. Variante par finition : Suède 12 mm → 132,07 €/m²", () => {
  const quote = computeQuote(makeProject({ finish: "SUEDE", pieces: [worktop(2000, 650)] }), catalog, settings);
  assert.equal(materialLine(quote).factoryUnitPrice, 132.07);
});

test("17. Épaisseur indisponible → repli sur la plus proche de la même finition", () => {
  // POLI 30 mm n'existe pas → 20 mm (140,04), jamais une autre finition.
  const quote = computeQuote(makeProject({ thicknessMm: 30, pieces: [worktop(2000, 650)] }), catalog, settings);
  assert.equal(materialLine(quote).factoryUnitPrice, 140.04);
});

test("18. purchaseHT = matière + prestations + livraison", () => {
  const piece = worktop(2000, 650, {
    edges: [{ side: "bottom", serviceId: "edge-straight", lengthMm: 1800 }],
    corners: { bottomRight: { type: "round", radiusMm: 300 } },
    cutouts: [{ id: "c1", kind: "tap", shape: "circle", serviceId: "cut-tap", xMm: 100, yMm: 100, widthMm: 35, heightMm: 35 }],
  });
  const quote = computeQuote(makeProject({ pieces: [piece], deliveryDistanceKm: 42 }), catalog, settings);
  // matière 156,08 + chant 14,40 + arrondi 67,77 + perçage 17,00 + livraison 95,00 = 350,25
  assert.equal(quote.materialSubtotal, 156.08);
  assert.equal(quote.serviceSubtotal, 99.17);
  assert.equal(quote.purchaseHT, 350.25);
});

test("19. Encoche ouverte : angles E1/E2 travaillés facturés à la grille façonnage", () => {
  const piece = worktop(2400, 650, {
    cutouts: [{
      id: "c1", kind: "notch", shape: "edge-notch", serviceId: "cut-tap",
      xMm: 900, yMm: 430, widthMm: 400, heightMm: 220, edgeSide: "bottom",
      edgeCorners: { start: { type: "round", radiusMm: 30 }, end: { type: "cutout", cutXmm: 40, cutYmm: 25 } },
    }],
  });
  const quote = computeQuote(makeProject({ pieces: [piece] }), catalog, settings);
  const corners = quote.lines.filter((l) => l.category === "Façonnage");
  assert.equal(corners.length, 2);
  // E1 arrondi : 67,77 → vente round(142,317) = 142,32 ; E2 découpe : 28,00 → 58,80.
  assert.equal(corners[0].factoryUnitPrice, 67.77);
  assert.equal(corners[0].customerUnitPrice, 142.32);
  assert.ok(corners[0].description.includes("E1"));
  assert.equal(corners[1].factoryUnitPrice, 28);
  assert.equal(corners[1].customerUnitPrice, 58.8);
  assert.ok(corners[1].description.includes("E2"));
});

test("20. Évier timbre d'office : chant fini sur découpe = (l + 2p) au tarif du chant du côté", () => {
  const piece = worktop(2400, 650, {
    edges: [{ side: "bottom", serviceId: "edge-straight" }],
    cutouts: [{
      id: "c1", kind: "sink-apron", shape: "edge-notch", serviceId: "cut-tap",
      xMm: 900, yMm: 430, widthMm: 500, heightMm: 220, edgeSide: "bottom", finishedEdge: true,
      edgeCorners: { start: { type: "square" }, end: { type: "square" } },
    }],
  });
  const quote = computeQuote(makeProject({ pieces: [piece] }), catalog, settings);
  const finished = quote.lines.find((l) => l.category === "Chant" && l.description.includes("Chant fini sur découpe"));
  assert.ok(finished);
  // (500 + 2×220) / 1000 = 0,94 ml à 8 € → achat 7,52 ; vente 16,80 × 0,94 = 15,792 → 15,79.
  assert.equal(finished.factoryAmount, 7.52);
  assert.equal(finished.customerUnitPrice, 16.8);
  assert.equal(finished.customerAmount, 15.79);
});

test("21. Pierre naturelle sur demande : prix saisi sur le devis, marge appliquée", () => {
  const withStone = {
    ...catalog,
    materials: [...catalog.materials, {
      id: "pierre-naturelle-sur-demande", brand: "Pierre naturelle", color: "Sur demande",
      family: "stone", onRequest: true, active: true,
      variants: [{ finish: "POLI", finishLabel: "Poli", thicknessMm: 20, priceM2: 0 }],
    }],
  };
  const quote = computeQuote(makeProject({
    materialId: "pierre-naturelle-sur-demande", thicknessMm: 20,
    customStoneLabel: "Granit Noir Zimbabwe", customStonePriceM2: 250,
    pieces: [worktop(2000, 650)],
  }), withStone, settings);
  const line = materialLine(quote);
  // 1,3 m² à 250 € : achat 325,00 ; P.U. vente round(250 × 2,1) = 525 → 682,50.
  assert.equal(line.factoryUnitPrice, 250);
  assert.equal(line.factoryAmount, 325);
  assert.equal(line.customerUnitPrice, 525);
  assert.equal(line.customerAmount, 682.5);
  assert.ok(line.description.includes("Granit Noir Zimbabwe"));
  // Sans prix saisi : la ligne reste à 0 (le devis n'est pas envoyable).
  const empty = computeQuote(makeProject({
    materialId: "pierre-naturelle-sur-demande", thicknessMm: 20, pieces: [worktop(2000, 650)],
  }), withStone, settings);
  assert.equal(materialLine(empty).factoryUnitPrice, 0);
});
