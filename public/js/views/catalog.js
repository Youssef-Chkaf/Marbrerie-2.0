// Tarifs & catalogue : matières/coloris et prestations, éditables par l'usine.

import { state } from "../state.js";
import { request, refresh } from "../api.js";
import { esc, number, dateFr, toast } from "../ui.js";
import { register } from "../actions.js";

export function renderCatalog() {
  const catalog = state.data.catalog;
  if (!catalog) return `<div class="empty"><p>Aucun catalogue disponible.</p></div>`;
  const isFactory = state.data.user.role === "factory";
  return `
  <div class="page-head"><div><h2>Tarifs & catalogue</h2>
    <p>${esc(catalog.source)} · dernière modification ${dateFr(catalog.updatedAt)}</p></div>
    <span class="badge status-factory_review">● ${isFactory ? "Modifiable par l'usine" : "Lecture seule"}</span></div>
  <div class="catalog-tabs">
    <button data-catalog-tab="materials" class="${state.catalogTab === "materials" ? "active" : ""}">Matières & coloris</button>
    <button data-catalog-tab="services" class="${state.catalogTab === "services" ? "active" : ""}">Découpes & chants</button>
  </div>
  ${state.catalogTab === "materials" ? renderMaterials(catalog, isFactory) : renderServices(catalog, isFactory)}`;
}

function renderMaterials(catalog, editable) {
  const query = state.catalogSearch.toLowerCase();
  const materials = catalog.materials
    .filter((item) => !query || `${item.brand} ${item.collection} ${item.color}`.toLowerCase().includes(query));
  const shown = materials.slice(0, 120);
  const rows = shown.map((item) => {
    const variants = item.variants || [];
    const summary = `${variants.length} variante(s) · dès ${number(Math.min(...variants.map((v) => v.priceM2)), 2)} €/m²`;
    return `<details class="card" style="margin:8px 0;padding:0">
      <summary style="display:flex;align-items:center;gap:10px;padding:10px 14px;cursor:pointer;list-style:none">
        <span class="swatch" style="background:${esc(item.tone)}"></span>
        <span style="flex:1"><span class="table-title">${esc(item.brand)} · ${esc(item.color)}</span>
          <span class="table-sub" style="display:block">${summary} · ${item.family === "ultra" ? "grille Ultra" : "grille Stone"}</span></span>
        <button class="toggle ${item.active ? "on" : ""}" data-catalog-toggle="material" data-id="${item.id}" ${editable ? "" : "disabled"} aria-label="Activer ou désactiver" onclick="event.preventDefault()"></button>
      </summary>
      <div class="table-wrap" style="border-top:1px solid #e7e2da"><table>
        <thead><tr><th>Finition</th><th>Épaisseur</th><th>Format plaque</th><th>Prix achat HT / m²</th></tr></thead>
        <tbody>${variants.map((v) => `<tr>
          <td>${esc(v.finishLabel || v.finish)}</td>
          <td>${v.thicknessMm} mm</td>
          <td>${number(v.maxLengthMm)} × ${number(v.maxWidthMm)} mm</td>
          <td><input class="price-input" type="number" min="0" step="0.01" value="${esc(v.priceM2)}"
            data-catalog-variant="${esc(`${v.finish}|${v.thicknessMm}`)}" data-id="${item.id}" ${editable ? "" : "disabled"}></td>
        </tr>`).join("")}</tbody></table></div>
    </details>`;
  }).join("");
  return `<section>
    <div class="card"><div class="card-head"><div class="filters">
      <input type="search" data-catalog-search value="${esc(state.catalogSearch)}" placeholder="Rechercher marque ou coloris…"></div>
      <span class="help">${materials.length} produit(s) · prix d'achat usine HT au m² · les tarifs modifiés ne s'appliquent qu'aux nouveaux devis (snapshot)</span></div></div>
    ${rows || `<div class="empty"><p>Aucun produit ne correspond.</p></div>`}
    ${materials.length > shown.length ? `<p class="help" style="padding:10px">${materials.length - shown.length} produit(s) masqué(s) — affinez la recherche.</p>` : ""}
  </section>`;
}

function renderServices(catalog, editable) {
  return `<section class="card">
    <div class="card-head"><h3>Prestations issues du tarif d'essai</h3>
      <span class="help">Stone : Silestone, pierre naturelle · Ultra : Dekton, Neolith</span></div>
    <div class="table-wrap"><table>
      <thead><tr><th>Prestation</th><th>Catégorie</th><th>Codes</th><th>Prix Stone</th><th>Prix Ultra</th><th>Unité</th><th>Actif</th></tr></thead>
      <tbody>${catalog.services.map((item) => `<tr>
        <td class="table-title">${esc(item.label)}</td><td>${esc(item.category)}</td>
        <td>${esc(item.codes.stone)} / ${esc(item.codes.ultra)}</td>
        <td><input class="price-input" type="number" min="0" value="${esc(item.prices.stone)}" data-catalog-price="service" data-id="${item.id}" data-family="stone" ${editable ? "" : "disabled"}></td>
        <td><input class="price-input" type="number" min="0" value="${esc(item.prices.ultra)}" data-catalog-price="service" data-id="${item.id}" data-family="ultra" ${editable ? "" : "disabled"}></td>
        <td>${esc(item.unit)}</td>
        <td><button class="toggle ${item.active ? "on" : ""}" data-catalog-toggle="service" data-id="${item.id}" ${editable ? "" : "disabled"}></button></td>
      </tr>`).join("")}</tbody></table></div></section>`;
}

export async function saveCatalogPrice(input) {
  try {
    if (input.dataset.catalogVariant !== undefined) {
      await request("/api/catalog", {
        method: "PATCH",
        body: { type: "material", id: input.dataset.id, variantKey: input.dataset.catalogVariant, price: Number(input.value) },
      });
    } else {
      const type = input.dataset.catalogPrice;
      const prices = type === "material"
        ? { [input.dataset.thickness]: input.value }
        : { [input.dataset.family]: input.value };
      await request("/api/catalog", { method: "PATCH", body: { type, id: input.dataset.id, prices } });
    }
    await refresh();
  } catch (error) { toast(error.message, "error"); }
}

export async function toggleCatalogItem(button) {
  const type = button.dataset.catalogToggle;
  const list = type === "material" ? state.data.catalog.materials : state.data.catalog.services;
  const item = list.find((entry) => entry.id === button.dataset.id);
  try {
    await request("/api/catalog", { method: "PATCH", body: { type, id: button.dataset.id, active: !item.active } });
    await refresh();
    window.dispatchEvent(new Event("marbexa:render"));
  } catch (error) { toast(error.message, "error"); }
}

register({});
