// Moteur de chiffrage Marbexa.
// Calcule le devis complet d'un projet : matière, chants, découpes, angles,
// livraison, marge revendeur, TVA et remise. Utilisé à l'identique par le
// navigateur (aperçu temps réel) et le serveur (montants de référence).
//
// Règles héritées d'e-marbrier (validées par 15 cas de test) :
// - la surface n'est JAMAIS arrondie : L × l / 1 000 000 en pleine précision ;
// - DOUBLE ARRONDI : le prix unitaire de vente est arrondi à 2 décimales AVANT
//   la multiplication par la quantité, puis le montant est arrondi.
//   Ex : 120,06 × 2,10 = 252,126 → 252,13 ; × 1,3 = 327,769 → 327,77
//   (et non 327,76 avec un seul arrondi final) ;
// - SNAPSHOT : les prix sont figés à la création du devis (options.snapshot).
//   Un changement de tarif catalogue n'affecte que les nouveaux devis.

import { MANUFACTURED_KINDS, EDGE_SIDES, CORNER_KEYS, FINISH_SURCHARGE_KEYWORDS } from "./constants.js";

const round2 = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
const round3 = (value) => Math.round((Number(value) + Number.EPSILON) * 1000) / 1000;

function findMaterial(catalog, materialId) {
  return (catalog?.materials || []).find((item) => item.id === materialId) || null;
}

function findService(catalog, serviceId) {
  return (catalog?.services || []).find((item) => item.id === serviceId) || null;
}

function servicePrice(service, family) {
  if (!service) return 0;
  return Number(service.prices?.[family === "ultra" ? "ultra" : "stone"] || 0);
}

function serviceCode(service, family) {
  if (!service) return "";
  return service.codes?.[family === "ultra" ? "ultra" : "stone"] || "";
}

// Sélectionne la variante (finition × épaisseur) d'un matériau ; à défaut,
// même finition avec l'épaisseur la plus proche, sinon la moins chère.
export function findVariant(material, finish, thicknessMm) {
  const variants = material?.variants || [];
  if (!variants.length) return null;
  const thickness = Number(thicknessMm || 0);
  const exact = variants.find((v) => v.finish === finish && v.thicknessMm === thickness);
  if (exact) return exact;
  const sameFinish = variants.filter((v) => v.finish === finish);
  if (sameFinish.length) {
    return sameFinish.reduce((best, v) =>
      Math.abs(v.thicknessMm - thickness) < Math.abs(best.thicknessMm - thickness) ? v : best);
  }
  const sameThickness = variants.filter((v) => v.thicknessMm === thickness);
  if (sameThickness.length) return sameThickness.reduce((a, b) => (a.priceM2 <= b.priceM2 ? a : b));
  return variants.reduce((a, b) => (a.priceM2 <= b.priceM2 ? a : b));
}

// Prix d'achat matière au m² (avant marge). Nouveau modèle : variantes ;
// ancien modèle (prices par épaisseur + majoration finition) conservé en repli.
function materialUnitPrice(material, thicknessMm, finish, finishSurchargePct) {
  if (!material) return 0;
  const variant = findVariant(material, finish, thicknessMm);
  if (variant) return Number(variant.priceM2 || 0);
  const prices = material.prices || {};
  let base = Number(prices[thicknessMm] ?? prices[String(thicknessMm)] ?? 0);
  if (!base) {
    const available = Object.keys(prices).map(Number).filter(Boolean).sort((a, b) => a - b);
    if (available.length) {
      const closest = available.reduce((best, item) => (Math.abs(item - thicknessMm) < Math.abs(best - thicknessMm) ? item : best), available[0]);
      base = Number(prices[closest] || 0);
    }
  }
  const finishLower = String(finish || "").toLowerCase();
  if (FINISH_SURCHARGE_KEYWORDS.some((keyword) => finishLower.includes(keyword))) {
    base *= 1 + Number(finishSurchargePct || 0) / 100;
  }
  return round2(base);
}

function pieceMaterial(catalog, project, piece) {
  const materialId = piece.materialId || project.materialId;
  return findMaterial(catalog, materialId);
}

// Surface facturée en m² — AUCUN arrondi (règle e-marbrier).
function pieceAreaM2(piece) {
  return (Number(piece.lengthMm || 0) * Number(piece.widthMm || 0)) / 1e6;
}

// Longueur de chant en mètres — pleine précision.
function edgeLengthM(piece, edge) {
  const sideLength = ["top", "bottom"].includes(edge.side) ? Number(piece.lengthMm || 0) : Number(piece.widthMm || 0);
  const length = Number(edge.lengthMm || sideLength || 0);
  return Math.min(length, sideLength || length) / 1000;
}

function deliveryForDistance(settings, distanceKm) {
  if (!Number(distanceKm)) return 0; // pas de distance = pas de livraison estimée
  const tiers = [...(settings?.deliveryTiers || [])].sort((a, b) => a.maxKm - b.maxKm);
  if (!tiers.length) return 0;
  const tier = tiers.find((item) => Number(distanceKm || 0) <= Number(item.maxKm)) || tiers[tiers.length - 1];
  return Number(tier.price || 0);
}

// Prestations associées aux types d'angles travaillés (grille e-marbrier).
// round = extrémité arrondie · bevel/cut = coupe à 45° · cutout/notch90 = découpe d'angle.
const CORNER_SERVICES = {
  round: "corner-round-end",
  bevel: "corner-bevel",
  cut: "corner-bevel",
  cutout: "corner-90",
  notch90: "corner-90",
};

function makeLine({ category, code, description, quantity, unit, factoryUnitPrice, marginPct, vatPct, piece }) {
  const unitPrice = round2(factoryUnitPrice);
  const amount = round2(unitPrice * quantity);
  // Double arrondi : P.U. client arrondi AVANT multiplication par la quantité.
  const customerUnitPrice = round2(unitPrice * (1 + Number(marginPct || 0) / 100));
  const customerAmount = round2(customerUnitPrice * quantity);
  const customerVatAmount = round2(customerAmount * Number(vatPct || 0) / 100);
  return {
    category,
    code,
    description,
    quantity: round3(quantity), // valeur affichée ; les montants utilisent la quantité exacte
    unit,
    factoryUnitPrice: unitPrice,
    unitPrice,
    amount,
    factoryAmount: amount,
    customerUnitPrice,
    customerAmount,
    customerVatPct: Number(vatPct || 0),
    customerVatAmount,
    customerTTC: round2(customerAmount + customerVatAmount),
    ...(piece ? { pieceId: piece.id, pieceName: piece.name, pieceKind: piece.kind } : {}),
  };
}

function pieceLines(catalog, project, piece, settings, marginPct, vatPct, snap) {
  const lines = [];
  const material = pieceMaterial(catalog, project, piece);
  const family = material?.family || "stone";
  const thickness = Number(piece.thicknessMm || project.thicknessMm || 20);
  const finish = piece.finish || project.finish;
  const area = pieceAreaM2(piece);

  const snappedService = (service) => snap(`srv:${service.id}|${family}`, () => servicePrice(service, family));

  if (material && area > 0) {
    const variant = findVariant(material, finish, thickness);
    const finishLabel = variant?.finishLabel || finish || "";
    lines.push(makeLine({
      category: "Matière",
      code: material.group || variant?.finish || "",
      description: `${piece.name} - ${material.brand} ${material.color}, ${finishLabel}, ${thickness} mm`,
      quantity: area,
      unit: "m²",
      factoryUnitPrice: snap(`mat:${material.id}|${variant?.finish || finish}|${variant?.thicknessMm || thickness}`,
        () => materialUnitPrice(material, thickness, finish, settings?.finishSurchargePct)),
      marginPct, vatPct, piece,
    }));
  }

  for (const edge of piece.edges || []) {
    const service = findService(catalog, edge.serviceId);
    if (!service || !service.active) continue;
    const quantity = edgeLengthM(piece, edge);
    if (quantity <= 0) continue;
    lines.push(makeLine({
      category: "Chant",
      code: serviceCode(service, family),
      description: `${service.label} - ${EDGE_SIDES[edge.side] || edge.side}`,
      quantity,
      unit: "ml",
      factoryUnitPrice: snappedService(service),
      marginPct, vatPct, piece,
    }));
  }

  for (const cut of piece.cutouts || []) {
    const service = findService(catalog, cut.serviceId);
    if (!service) continue;
    const reference = cut.brand || cut.reference ? ` - ${[cut.brand, cut.reference].filter(Boolean).join(" ")}` : "";
    // Pose à fleur : les cotes de défonçage figurent sur le devis et le BC usine.
    const flushDetail = cut.serviceId === "cut-flush"
      ? ` — Défonçage : découpe intérieure ${Math.round(cut.flushInnerWidthMm || cut.widthMm)} × ${Math.round(cut.flushInnerHeightMm || cut.heightMm)} mm, défonçage extérieur ${Math.round(cut.flushOuterWidthMm || cut.widthMm)} × ${Math.round(cut.flushOuterHeightMm || cut.heightMm)} mm`
      : "";
    lines.push(makeLine({
      category: "Découpe",
      code: serviceCode(service, family),
      description: `${service.label}${reference}${flushDetail}`,
      quantity: 1,
      unit: "un",
      factoryUnitPrice: snappedService(service),
      marginPct, vatPct, piece,
    }));
    // Rainures supplémentaires d'un égouttoir au-delà des 5 incluses.
    if (cut.kind === "drainer" && Number(cut.grooves || 5) > 5) {
      const extra = findService(catalog, "drainer-extra");
      if (extra) {
        lines.push(makeLine({
          category: "Découpe",
          code: serviceCode(extra, family),
          description: extra.label,
          quantity: Number(cut.grooves) - 5,
          unit: "un",
          factoryUnitPrice: snappedService(extra),
          marginPct, vatPct, piece,
        }));
      }
    }
  }

  for (const [cornerKey, corner] of Object.entries(piece.corners || {})) {
    if (!corner || corner.type === "square" || !corner.type) continue;
    const service = findService(catalog, CORNER_SERVICES[corner.type])
      || findService(catalog, corner.type === "cut" ? "cut-outside" : "cut-rounded-end");
    if (!service) continue;
    const detail = corner.type === "round"
      ? `, rayon ${Number(corner.radiusMm || 0)} mm`
      : ` ${Number(corner.cutXmm || corner.cutMm || 0)} × ${Number(corner.cutYmm || corner.cutMm || 0)} mm`;
    lines.push(makeLine({
      category: "Façonnage",
      code: serviceCode(service, family),
      description: `${service.label} - ${CORNER_KEYS[cornerKey] || cornerKey}${detail}`,
      quantity: 1,
      unit: "un",
      factoryUnitPrice: snappedService(service),
      marginPct, vatPct, piece,
    }));
  }

  for (const extra of piece.extraServices || []) {
    const service = findService(catalog, extra.serviceId);
    if (!service) continue;
    lines.push(makeLine({
      category: "Prestation",
      code: serviceCode(service, family),
      description: service.label,
      quantity: Number(extra.quantity || 1),
      unit: service.unit,
      factoryUnitPrice: snappedService(service),
      marginPct, vatPct, piece,
    }));
  }

  return lines;
}

// Calcule le devis complet d'un projet.
// options.snapshot : objet mutable { clé → prix d'achat } qui fige les tarifs
//   au premier calcul (source de vérité pour toute la vie du devis).
// options.groupSize / options.groupDeliveryTotal : livraisons regroupées.
export function computeQuote(project, catalog, factorySettings, options = {}) {
  const marginPct = Number(project.marginPct || 0);
  const vatPct = Number(project.vatPct ?? 20);
  const manufactured = (project.pieces || []).filter((piece) => MANUFACTURED_KINDS.includes(piece.kind));

  const snapshot = options.snapshot || null;
  const snap = (key, compute) => {
    if (!snapshot) return compute();
    if (snapshot[key] === undefined || snapshot[key] === null) snapshot[key] = compute();
    return Number(snapshot[key]);
  };

  const lines = [];
  for (const piece of manufactured) {
    lines.push(...pieceLines(catalog, project, piece, factorySettings, marginPct, vatPct, snap));
  }

  const materialSubtotal = round2(lines.filter((l) => l.category === "Matière").reduce((sum, l) => sum + l.amount, 0));
  const serviceSubtotal = round2(lines.filter((l) => l.category !== "Matière").reduce((sum, l) => sum + l.amount, 0));

  // Livraison : forfait par tranche kilométrique (figé aussi), partageable.
  const distanceKm = Number(project.deliveryDistanceKm || 0);
  const baseDelivery = snap(`del:${distanceKm}`, () => deliveryForDistance(factorySettings, distanceKm));
  const groupSize = Math.max(1, Number(options.groupSize || project.deliveryGroupSize || 1));
  const groupDeliveryTotal = Number(options.groupDeliveryTotal ?? baseDelivery);
  const delivery = round2(groupDeliveryTotal / groupSize);
  if (delivery > 0) {
    lines.push(makeLine({
      category: "Livraison",
      code: "T",
      description: groupSize > 1
        ? `Livraison groupée (${groupSize} commandes) - ${distanceKm} km`
        : `Livraison estimée - ${distanceKm} km`,
      quantity: 1,
      unit: "forfait",
      factoryUnitPrice: delivery,
      marginPct, vatPct,
    }));
  }

  const purchaseHT = round2(materialSubtotal + serviceSubtotal + delivery);
  const customerStoneHT = round2(lines.reduce((sum, l) => sum + l.customerAmount, 0));

  // Lignes commerciales du revendeur (pose, accessoires…), privées vis-à-vis de l'usine.
  const manualLines = (project.manualQuoteLines || []).map((line) => {
    const amount = round2(Number(line.priceHT || 0) * Number(line.quantity || 1));
    const lineVatPct = Number(line.vatPct ?? vatPct);
    const vatAmount = round2(amount * lineVatPct / 100);
    return { ...line, amount, vatPct: lineVatPct, vatAmount, ttc: round2(amount + vatAmount) };
  });
  const manualHT = round2(manualLines.reduce((sum, l) => sum + l.amount, 0));

  const customerHT = round2(customerStoneHT + manualHT);

  // Ventilation de TVA par taux (lignes pierre + lignes manuelles).
  const vatMap = new Map();
  const addVat = (rate, baseHT, amount) => {
    const entry = vatMap.get(rate) || { rate, baseHT: 0, amount: 0 };
    entry.baseHT = round2(entry.baseHT + baseHT);
    entry.amount = round2(entry.amount + amount);
    vatMap.set(rate, entry);
  };
  for (const line of lines) addVat(line.customerVatPct, line.customerAmount, line.customerVatAmount);
  for (const line of manualLines) addVat(line.vatPct, line.amount, line.vatAmount);
  const vatBreakdown = [...vatMap.values()].sort((a, b) => a.rate - b.rate);
  const vatAmount = round2(vatBreakdown.reduce((sum, entry) => sum + entry.amount, 0));

  const customerSubtotalTTC = round2(customerHT + vatAmount);
  const discount = project.commercialDiscount || { mode: "percent", value: 0 };
  const discountTTC = discount.mode === "amount"
    ? round2(Math.min(Number(discount.value || 0), customerSubtotalTTC))
    : round2(customerSubtotalTTC * Number(discount.value || 0) / 100);
  const customerTTC = round2(customerSubtotalTTC - discountTTC);

  return {
    currency: "EUR",
    lines,
    manualLines,
    totalAreaM2: round3(manufactured.reduce((sum, piece) => sum + pieceAreaM2(piece), 0)),
    materialSubtotal,
    serviceSubtotal,
    baseDelivery,
    groupDeliveryTotal,
    deliveryGroupSize: groupSize,
    delivery,
    purchaseHT,
    marginPct,
    customerHT,
    vatPct,
    vatAmount,
    vatBreakdown,
    customerSubtotalTTC,
    discountMode: discount.mode,
    discountValue: Number(discount.value || 0),
    discountTTC,
    customerTTC,
    calculatedAt: new Date().toISOString(),
  };
}

export { pieceAreaM2, deliveryForDistance, materialUnitPrice };
