// Import du catalogue e-marbrier (export Supabase CSV) vers le format Marbexa.
//
// Règles reprises du brief e-marbrier :
// - marque = gamme ; coloris = « Produit » ; fournisseur ignoré
// - anti-doublons de casse : Title Case vs MAJUSCULES (accents/ponctuation
//   ignorés) → fusion vers le libellé Title Case en gardant, pour chaque
//   variante (finition × épaisseur), le prix LE MOINS CHER
// - un seul prix par variante = prix_achat_m2 (le coef revendeur fait la vente)
//
// Usage : node scripts/import-emarbrier.mjs
// Produit : server/data-seed/catalog-emarbrier.json

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const sourceDir = path.join(here, "..", "server", "data-seed", "source");
const outFile = path.join(here, "..", "server", "data-seed", "catalog-emarbrier.json");

function parseCsv(file) {
  const text = fs.readFileSync(path.join(sourceDir, file), "utf8").replace(/^﻿/, "");
  const lines = text.split(/\r\n|\n/).filter((line) => line.length);
  const parseLine = (line) => {
    const cells = [];
    let cell = "";
    let quoted = false;
    for (let i = 0; i < line.length; i += 1) {
      const char = line[i];
      if (quoted) {
        if (char === '"' && line[i + 1] === '"') { cell += '"'; i += 1; }
        else if (char === '"') quoted = false;
        else cell += char;
      } else if (char === '"') quoted = true;
      else if (char === ",") { cells.push(cell); cell = ""; }
      else cell += char;
    }
    cells.push(cell);
    return cells;
  };
  const header = parseLine(lines[0]);
  return lines.slice(1).map((line) => Object.fromEntries(parseLine(line).map((value, i) => [header[i], value])));
}

const stripAccents = (value) => value.normalize("NFD").replace(/[̀-ͯ]/g, "");
const normKey = (value) => stripAccents(String(value)).toLowerCase().replace(/[^a-z0-9]/g, "");
const slugify = (value) => stripAccents(String(value)).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
// Un libellé « Title Case » contient des minuscules ; tout-MAJUSCULES n'en a pas.
const looksTitleCase = (value) => /[a-zà-ÿ]/.test(value);

function parseFormat(format) {
  const match = /(\d+)\s*[x×]\s*(\d+)\s*(mm|cm)?/i.exec(String(format || ""));
  if (!match) return { maxLengthMm: 3200, maxWidthMm: 1600 };
  const factor = (match[3] || "mm").toLowerCase() === "cm" ? 10 : 1;
  const a = Number(match[1]) * factor;
  const b = Number(match[2]) * factor;
  return { maxLengthMm: Math.max(a, b), maxWidthMm: Math.min(a, b) };
}

// Familles tarifaires des prestations : quartz → stone, céramique/frittés → ultra.
const ULTRA_BRANDS = new Set(["dekton", "classtone", "arklam", "colorfeel", "fusion", "iron", "steel", "timber", "eclos"]);

// ---------- Tri du catalogue (décision usine) ----------
// On ne garde que Cosentino (Silestone, Dekton) et Neolith — dont les
// collections sont stockées comme des « marques » dans l'export e-marbrier
// et sont regroupées ici sous la marque Neolith — en 12 et 20 mm uniquement.
// Écartés : Arklam et Eclos (ni Cosentino ni Neolith).
const NEOLITH_COLLECTIONS = new Set(["classtone", "colorfeel", "fusion", "iron", "steel", "timber"]);
const KEPT_BRANDS = new Set(["silestone", "dekton", "neolith", ...NEOLITH_COLLECTIONS]);
const KEPT_THICKNESSES = new Set([12, 20]);
const titleCase = (value) => String(value).toLowerCase().replace(/(^|[\s-])([a-zà-ÿ])/g, (m, sep, c) => sep + c.toUpperCase());

// Teinte d'aperçu déterministe (visuel uniquement).
function toneFor(name) {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const lower = name.toLowerCase();
  if (/(black|noir|nero|marquina|domoos|charcoal|jurassic)/.test(lower)) return "#26262a";
  if (/(white|blanc|bianco|estatuario|calacatta|polar|zeus|arctic)/.test(lower)) return "#ece7dd";
  if (/(grey|gris|grigio|cement|beton|basalt)/.test(lower)) return "#9a9a94";
  if (/(beige|cream|creme|sand|marfil|avorio|ivory)/.test(lower)) return "#d9c9a8";
  if (/(gold|amber|copper|cooper|brass|corten)/.test(lower)) return "#c19a5b";
  if (/(green|emerald|jade|verde)/.test(lower)) return "#5f7d6b";
  if (/(blue|bleu|azure|lagoon|aqua)/.test(lower)) return "#5b7c96";
  if (/(brown|marron|oak|wood|walnut|laurent)/.test(lower)) return "#7a5c42";
  const palette = ["#b9b2a6", "#a89f92", "#c4bbae", "#8f8a80", "#d1c8ba", "#7e7a72"];
  return palette[hash % palette.length];
}

// ---------- Lecture ----------

const produits = parseCsv("produits.csv");
const variantes = parseCsv("produit_variantes.csv");
const finitionsRows = parseCsv("finitions.csv");
const params = parseCsv("revendeur_parametres.csv")[0] || {};

const finitionById = new Map(finitionsRows.map((row) => [row.id, { code: row.code, label: row.libelle }]));

// ---------- Fusion anti-doublons ----------

const byKey = new Map(); // normKey(marque)+normKey(coloris) → produit fusionné
const stats = { merged: [], products: 0, variants: 0, variantsDeduped: 0, excluded: 0, variantsExcluded: 0 };

for (const row of produits) {
  if (!KEPT_BRANDS.has(normKey(row.marque))) { stats.excluded += 1; continue; }
  const key = `${normKey(row.marque)}|${normKey(row.coloris)}`;
  const existing = byKey.get(key);
  if (!existing) {
    byKey.set(key, { ...row, sourceIds: [row.id] });
    continue;
  }
  // Doublon de casse : on garde le libellé Title Case, on fusionnera les variantes.
  stats.merged.push(`${row.marque} : « ${existing.coloris} » + « ${row.coloris} »`);
  if (looksTitleCase(row.coloris) && !looksTitleCase(existing.coloris)) {
    existing.coloris = row.coloris;
    existing.slug = row.slug;
    existing.image = row.image || existing.image;
  }
  existing.sourceIds.push(row.id);
}

const variantsByProduct = new Map();
for (const row of variantes) {
  if (String(row.actif) === "false") continue;
  if (!variantsByProduct.has(row.produit_id)) variantsByProduct.set(row.produit_id, []);
  variantsByProduct.get(row.produit_id).push(row);
}

const materials = [];
for (const produit of byKey.values()) {
  const variantMap = new Map(); // finitionCode|épaisseur → variante la moins chère
  for (const sourceId of produit.sourceIds) {
    for (const row of variantsByProduct.get(sourceId) || []) {
      const finition = finitionById.get(row.finition_id);
      if (!finition) continue;
      if (!KEPT_THICKNESSES.has(Number(row.epaisseur_mm))) { stats.variantsExcluded += 1; continue; }
      const key = `${finition.code}|${Number(row.epaisseur_mm)}`;
      const price = Number(row.prix_achat_m2);
      const current = variantMap.get(key);
      stats.variants += 1;
      if (current && current.priceM2 <= price) { stats.variantsDeduped += 1; continue; }
      if (current) stats.variantsDeduped += 1;
      variantMap.set(key, {
        finish: finition.code,
        finishLabel: finition.label,
        thicknessMm: Number(row.epaisseur_mm),
        priceM2: price,
        format: row.format || "",
        ...parseFormat(row.format),
      });
    }
  }
  if (!variantMap.size) continue;
  const variants = [...variantMap.values()].sort((a, b) => a.finish.localeCompare(b.finish) || a.thicknessMm - b.thicknessMm);
  // Les collections Neolith sont regroupées sous la marque Neolith ;
  // la collection d'origine reste visible (Classtone, Fusion, Iron…).
  const isNeolith = NEOLITH_COLLECTIONS.has(normKey(produit.marque));
  const brand = isNeolith ? "Neolith" : produit.marque.trim();
  const collection = isNeolith ? titleCase(produit.marque.trim()) : produit.gamme.trim();
  materials.push({
    id: `${slugify(brand)}-${isNeolith ? `${slugify(collection)}-` : ""}${slugify(produit.coloris)}`,
    brand,
    collection,
    color: produit.coloris.trim(),
    tone: toneFor(produit.coloris),
    family: ULTRA_BRANDS.has(normKey(produit.marque)) ? "ultra" : "stone",
    active: String(produit.actif) !== "false",
    image: produit.image || "",
    variants,
  });
  stats.products += 1;
}

materials.sort((a, b) => a.brand.localeCompare(b.brand) || a.color.localeCompare(b.color));

const output = {
  source: `Catalogue e-marbrier (import Supabase du ${new Date().toISOString().slice(0, 10)})`,
  resellerDefaults: {
    coefMatiere: Number(params.coef_matiere || 2.1),
    coefPrestations: Number(params.coef_prestations || 2.1),
    tvaPct: Number(params.tva_matiere || 20),
    prixArrondi: Number(params.prix_arrondi || 67.77),
  },
  finitions: finitionsRows.map((row) => ({ id: Number(row.id), code: row.code, label: row.libelle })),
  materials,
};

fs.writeFileSync(outFile, JSON.stringify(output, null, 1));
console.log(`Produits sources : ${produits.length} → gardés après tri : ${stats.products} (écartés hors Cosentino/Neolith : ${stats.excluded})`);
console.log(`Variantes sources : ${stats.variants} → doublons résolus : ${stats.variantsDeduped} · hors 12/20 mm écartées : ${stats.variantsExcluded}`);
console.log(`Fusions de casse (${stats.merged.length}) :`);
for (const line of stats.merged) console.log(`  - ${line}`);
console.log(`Écrit : ${outFile}`);
