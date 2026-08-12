// Modèle de plan partagé : fabrique des pièces, découpes et chants normalisés.

export function makeId(prefix) {
  const rand = globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}-${rand}`;
}

export const DEFAULT_PIECE_SIZES = {
  worktop: { lengthMm: 2400, widthMm: 650 },
  splashback: { lengthMm: 2400, widthMm: 550 },
  panel: { lengthMm: 900, widthMm: 700 },
  wall: { lengthMm: 3000, widthMm: 100 },
  cabinet: { lengthMm: 600, widthMm: 560 },
};

export function makePiece(kind, overrides = {}) {
  const size = DEFAULT_PIECE_SIZES[kind] || DEFAULT_PIECE_SIZES.worktop;
  return {
    id: makeId("piece"),
    kind,
    name: overrides.name || "",
    x: 80,
    y: 80,
    lengthMm: size.lengthMm,
    widthMm: size.widthMm,
    rotationDeg: 0,
    cutouts: [],
    edges: [],
    corners: {},
    // Position en vue crédence (mur associé) pour crédences et panneaux.
    wallId: null,
    wallOffsetMm: 0,
    heightFromFloorMm: kind === "splashback" ? 900 : 0,
    ...overrides,
  };
}

export function makeCutout(kind, overrides = {}) {
  const defaults = {
    sink: { shape: "rounded", serviceId: "cut-polished", widthMm: 520, heightMm: 420, radiusMm: 12 },
    hob: { shape: "rounded", serviceId: "cut-rough", widthMm: 560, heightMm: 490, radiusMm: 10 },
    tap: { shape: "circle", serviceId: "cut-tap", widthMm: 35, heightMm: 35, diameterMm: 35 },
    socket: { shape: "circle", serviceId: "cut-tap", widthMm: 80, heightMm: 80, diameterMm: 80 },
    drainer: { shape: "grooves", serviceId: "drainer-5", widthMm: 450, heightMm: 400, grooves: 5 },
    notch: { shape: "rect", serviceId: "cut-inside", widthMm: 100, heightMm: 100, radiusMm: 0 },
    custom: { shape: "rect", serviceId: "cut-rough", widthMm: 300, heightMm: 300, radiusMm: 0 },
  };
  const base = defaults[kind] || defaults.custom;
  return {
    id: makeId("cut"),
    kind,
    xMm: 100,
    yMm: 80,
    rotationDeg: 0,
    brand: "",
    reference: "",
    verified: false,
    ...base,
    ...overrides,
  };
}

// Convertit une fiche appareil (base d'encastrement) en découpe prête à placer.
export function cutoutFromAppliance(appliance, mounting = null) {
  const kind = appliance.type === "hob" ? "hob" : "sink";
  const mount = mounting || appliance.mounting?.[0] || "top";
  const serviceId = kind === "hob"
    ? (mount === "flush" ? "cut-flush" : "cut-rough")
    : (mount === "undermount" ? "cut-polished" : mount === "flush" ? "cut-flush" : mount === "apron" ? "cut-apron-sink" : "cut-rough");
  return makeCutout(kind, {
    widthMm: appliance.cutoutWidthMm,
    heightMm: appliance.cutoutDepthMm,
    radiusMm: appliance.cornerRadiusMm ?? 10,
    brand: appliance.brand,
    reference: appliance.reference,
    applianceId: appliance.id,
    mounting: mount,
    minFrontMm: appliance.minFrontMm ?? 50,
    verified: true,
    serviceId,
  });
}

export function normalizeAngle(value) {
  return ((Number(value || 0) % 360) + 360) % 360;
}

export function rotatedBox(width, height, rotationDeg) {
  const radians = normalizeAngle(rotationDeg) * Math.PI / 180;
  return {
    width: Math.abs(width * Math.cos(radians)) + Math.abs(height * Math.sin(radians)),
    height: Math.abs(width * Math.sin(radians)) + Math.abs(height * Math.cos(radians)),
  };
}

// Format de plaque applicable à une pièce (variante finition × épaisseur,
// avec repli sur les champs historiques du matériau).
export function plateDims(material, finish, thicknessMm) {
  if (!material) return null;
  const variant = (material.variants || []).find((v) => v.finish === finish && v.thicknessMm === Number(thicknessMm))
    || (material.variants || [])[0];
  return {
    maxLengthMm: Number(variant?.maxLengthMm || material.maxLengthMm || 3200),
    maxWidthMm: Number(variant?.maxWidthMm || material.maxWidthMm || 1600),
  };
}

// Contrôles de faisabilité effectués avant l'envoi à l'usine.
export function validatePiece(piece, material, projectFinish, projectThickness) {
  const issues = [];
  const isCredence = piece.kind === "splashback";
  const dims = plateDims(material, piece.finish || projectFinish, piece.thicknessMm || projectThickness);
  if (dims) {
    if (piece.lengthMm > dims.maxLengthMm || piece.widthMm > dims.maxWidthMm) {
      issues.push(`${piece.name} : dépasse la plaque maxi ${dims.maxLengthMm} × ${dims.maxWidthMm} mm — prévoir un joint.`);
    }
  }
  for (const cut of piece.cutouts || []) {
    const inX = cut.xMm >= 0 && cut.xMm + cut.widthMm <= piece.lengthMm;
    const inY = cut.yMm >= 0 && cut.yMm + cut.heightMm <= piece.widthMm;
    if (!inX || !inY) issues.push(`${piece.name} : la découpe ${cut.reference || cut.kind} sort de la pièce.`);
    const frontDistance = piece.widthMm - (cut.yMm + cut.heightMm);
    const minFront = Number(cut.minFrontMm || 50);
    if (["sink", "hob"].includes(cut.kind) && frontDistance < minFront && !isCredence) {
      issues.push(`${piece.name} : ${cut.reference || cut.kind} à ${Math.max(0, Math.round(frontDistance))} mm du chant avant (minimum ${minFront} mm).`);
    }
    if (isCredence && ["hob", "sink", "tap", "drainer"].includes(cut.kind)) {
      issues.push(`Crédence ${piece.name} : les découpes cuisson, évier, robinet et égouttoir sont réservées aux plans de travail.`);
    }
  }
  return issues;
}

export function validateProject(project, catalog) {
  const issues = [];
  for (const piece of project.pieces || []) {
    if (!["worktop", "splashback", "panel"].includes(piece.kind)) continue;
    const material = (catalog?.materials || []).find((m) => m.id === (piece.materialId || project.materialId));
    if (material?.onRequest && !(Number(project.customStonePriceM2) > 0)) {
      issues.push("Pierre naturelle sur demande : renseignez le prix d'achat au m² transmis par l'usine avant l'envoi.");
    }
    issues.push(...validatePiece(piece, material, project.finish, project.thicknessMm));
  }
  return [...new Set(issues)];
}
