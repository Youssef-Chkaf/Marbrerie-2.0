// Données initiales : une usine de démonstration, un revendeur, le catalogue
// (tarif d'essai) et la base d'appareils encastrables.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scryptSync, randomBytes } from "node:crypto";
import { DEFAULT_FACTORY_SETTINGS } from "../shared/constants.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const readSeed = (name) => JSON.parse(fs.readFileSync(path.join(here, "data-seed", name), "utf8"));

export function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 32).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  const [salt, hash] = String(stored || "").split(":");
  if (!salt || !hash) return false;
  return scryptSync(password, salt, 32).toString("hex") === hash;
}

// Prestations d'angle issues du chiffrage e-marbrier (prix d'achat, hors marge).
// Grille extraite du code historique — à faire valider par l'usine :
// découpe 90° = 28,00 € · pan coupé = 34,19 € · extrémité arrondie = 67,77 €.
// Pierre naturelle (granit, marbre, quartzite…) : pas de prix catalogue —
// le prix d'achat au m² est saisi sur le devis, après consultation de l'usine.
const STONE_ON_REQUEST = {
  id: "pierre-naturelle-sur-demande",
  brand: "Pierre naturelle",
  collection: "Sur demande",
  color: "Sur demande",
  tone: "#8f8a80",
  family: "stone",
  onRequest: true,
  active: true,
  image: "",
  variants: [
    { finish: "POLI", finishLabel: "Poli", thicknessMm: 20, priceM2: 0, format: "", maxLengthMm: 3200, maxWidthMm: 1600 },
    { finish: "POLI", finishLabel: "Poli", thicknessMm: 30, priceM2: 0, format: "", maxLengthMm: 3200, maxWidthMm: 1600 },
  ],
};

const EMARBRIER_CORNER_SERVICES = [
  { id: "corner-90", category: "shape", label: "Découpe d'angle 90°", codes: { stone: "90G/90D", ultra: "90G/90D" }, prices: { stone: 28, ultra: 28 }, unit: "un", active: true },
  { id: "corner-bevel", category: "shape", label: "Pan coupé", codes: { stone: "PCG/PCD", ultra: "PCG/PCD" }, prices: { stone: 34.19, ultra: 34.19 }, unit: "un", active: true },
  { id: "corner-round-end", category: "shape", label: "Extrémité arrondie (jusqu'à 785 mm)", codes: { stone: "ARR", ultra: "ARR" }, prices: { stone: 67.77, ultra: 67.77 }, unit: "un", active: true },
];

export function buildSeed() {
  const now = new Date().toISOString();
  const catalogSeed = readSeed("catalog.json");            // prestations (tarif d'essai Bazin)
  const emarbrier = readSeed("catalog-emarbrier.json");    // matières réelles (import Supabase)
  const appliancesSeed = readSeed("appliances.json");

  const factory = {
    id: "factory-demo",
    name: "Marbrerie de France DEMO",
    city: "Bergerac",
    legalName: "Marbrerie de France DEMO SAS",
    siret: "900 000 000 00042",
    managerName: "Dupont Paul",
    email: "atelier@marbexa.fr",
    phone: "05 53 00 00 00",
    address: "12 avenue de l'Industrie, 24100 Bergerac",
    settings: structuredClone(DEFAULT_FACTORY_SETTINGS),
    createdAt: now,
    active: true,
  };

  const reseller = {
    id: "reseller-demo",
    factoryId: factory.id,
    company: "Cuisine & Harmonie",
    siret: "901 000 000 00031",
    managerName: "Sophie Durand",
    salespersonName: "Lucas Morel",
    email: "cuisine@marbexa.fr",
    phone: "05 53 10 20 30",
    deliveryAddress: "18 rue de la République, 24100 Bergerac",
    distanceKm: 42,
    // coef_matiere e-marbrier = 2,10 → marge de 110 % appliquée ligne à ligne.
    defaultMarginPct: Math.round(((emarbrier.resellerDefaults?.coefMatiere || 2.1) - 1) * 100),
    defaultVatPct: emarbrier.resellerDefaults?.tvaPct || 20,
    active: true,
    createdAt: now,
    legalName: "Cuisine & Harmonie",
    legalForm: "",
    capital: "",
    vatNumber: "",
    rcs: "",
    billingAddress: "18 rue de la République, 24100 Bergerac",
    website: "",
    logoDataUrl: "",
    quoteValidityDays: 30,
    paymentTerms: "Paiement selon les conditions indiquées au devis.",
    latePenalties: "Pénalités de retard exigibles au taux légal en vigueur et indemnité forfaitaire de recouvrement de 40 €.",
    salesTerms: "",
  };

  const users = [
    {
      id: "user-factory-demo",
      role: "factory",
      factoryId: factory.id,
      resellerId: null,
      name: "Dupont Paul",
      email: "atelier@marbexa.fr",
      password: hashPassword("usine2026"),
      active: true,
    },
    {
      id: "user-reseller-demo",
      role: "reseller",
      factoryId: factory.id,
      resellerId: reseller.id,
      name: "Cuisine & Harmonie",
      email: "cuisine@marbexa.fr",
      password: hashPassword("revendeur2026"),
      active: true,
    },
  ];

  return {
    version: "2.0.0",
    factories: [factory],
    resellers: [reseller],
    users,
    sessions: {},
    projects: [],
    orders: [],
    notifications: [],
    counters: { project: 1, order: 1 },
    catalogs: {
      [factory.id]: {
        source: emarbrier.source,
        updatedAt: now,
        materials: [...emarbrier.materials, STONE_ON_REQUEST],
        finitions: emarbrier.finitions,
        services: [...catalogSeed.services, ...EMARBRIER_CORNER_SERVICES],
      },
    },
    appliances: appliancesSeed.appliances,
    applianceNote: appliancesSeed.note,
  };
}
