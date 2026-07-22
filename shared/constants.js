// Constantes métier partagées entre le serveur et le client.

export const STATUS_LABELS = {
  draft: "Brouillon",
  quote: "Devis",
  submitted: "Commande envoyée",
  factory_review: "Contrôle usine",
  changes_requested: "Corrections demandées",
  factory_proposal: "Proposition usine",
  reseller_accepted: "Accepté par le revendeur",
  approved: "Validée",
  in_production: "En fabrication",
  shipped: "Envoyée",
  delivered: "Livrée",
  cancelled: "Annulée",
};

// Transitions autorisées pour une commande usine.
export const ORDER_TRANSITIONS = {
  factory_review: ["approved", "changes_requested", "factory_proposal", "cancelled"],
  changes_requested: ["factory_review", "cancelled"],
  factory_proposal: ["reseller_accepted", "changes_requested", "cancelled"],
  reseller_accepted: ["approved", "cancelled"],
  approved: ["in_production", "changes_requested", "cancelled"],
  in_production: ["shipped", "cancelled"],
  shipped: ["delivered"],
  delivered: [],
  cancelled: [],
};

// Étapes de fabrication suivies par l'usine une fois la commande validée.
export const PRODUCTION_STEPS = [
  { id: "programming", label: "Programmation machine" },
  { id: "slab", label: "Choix de la tranche" },
  { id: "cutting", label: "Découpe" },
  { id: "machining", label: "Usinage découpes & chants" },
  { id: "finishing", label: "Finition / polissage" },
  { id: "quality", label: "Contrôle qualité" },
  { id: "packaging", label: "Emballage" },
];

export const PIECE_KINDS = {
  worktop: "Plan de travail",
  splashback: "Crédence",
  panel: "Panneau",
  wall: "Mur",
  cabinet: "Meuble (repère)",
};

// Les murs et meubles sont des repères de dessin : ils ne sont pas fabriqués.
export const MANUFACTURED_KINDS = ["worktop", "splashback", "panel"];

export const CUT_KINDS = {
  sink: "Évier",
  hob: "Table de cuisson",
  tap: "Perçage robinet / prise",
  socket: "Prise escamotable",
  drainer: "Égouttoir rainuré",
  notch: "Encoche / réservation",
  custom: "Découpe personnalisée",
};

export const EDGE_SIDES = {
  top: "chant arrière",
  bottom: "chant avant",
  left: "chant gauche",
  right: "chant droit",
};

export const CORNER_KEYS = {
  topLeft: "angle haut gauche",
  topRight: "angle haut droit",
  bottomLeft: "angle bas gauche",
  bottomRight: "angle bas droit",
};

export const FINISH_SURCHARGE_KEYWORDS = ["suede", "suède", "spécial", "special", "cuir", "velvet"];

export const DEFAULT_FACTORY_SETTINGS = {
  minLeadWeeks: 3,
  finishSurchargePct: 13,
  wasteUseTargetPct: 85,
  consolidatedDeliveryDiscountPct: 0,
  deliveryTiers: [
    { maxKm: 100, price: 95 },
    { maxKm: 200, price: 160 },
    { maxKm: 350, price: 245 },
    { maxKm: 600, price: 390 },
  ],
  notifications: { inApp: true, email: false, reminderHours: 24 },
  smtp: { host: "", port: 587, user: "", configured: false },
};

export const ROLE_NAMES = {
  factory: "Usine / marbrier",
  reseller: "Revendeur",
};

export function isoWeekOf(date = new Date()) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export function addWeeksToIsoWeek(isoWeek, weeks) {
  const [year, w] = String(isoWeek || "").split("-W").map(Number);
  if (!year || !w) return isoWeek;
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - (jan4.getUTCDay() || 7) + 1 + (w - 1 + weeks) * 7);
  return isoWeekOf(monday);
}
