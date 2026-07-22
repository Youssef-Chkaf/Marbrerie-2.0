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
  const rows = catalog.materials
    .filter((item) => !query || `${item.brand} ${item.collection} ${item.color}`.toLowerCase().includes(query))
    .map((item) => `<tr>
      <td><div style="display:flex;align-items:center;gap:9px"><span class="swatch" style="background:${esc(item.tone)}"></span>
        <div><div class="table-title">${esc(item.brand)} · ${esc(item.color)}</div><div class="table-sub">${esc((item.finish || []).join(" / "))}</div></div></div></td>
      <td>${esc(item.collection)}</td><td>${esc(item.group)}</td>
      <td>${number(item.maxLengthMm)} × ${number(item.maxWidthMm)} mm</td>
      ${[12, 20, 30].map((thickness) => `<td><input class="price-input" type="number" min="0" step="1"
        value="${esc(item.prices[thickness] ?? (thickness === 12 ? item.prices[8] ?? "" : ""))}"
        data-catalog-price="material" data-id="${item.id}" data-thickness="${thickness}" ${editable ? "" : "disabled"}></td>`).join("")}
      <td><button class="toggle ${item.active ? "on" : ""}" data-catalog-toggle="material" data-id="${item.id}" ${editable ? "" : "disabled"} aria-label="Activer ou désactiver"></button></td>
    </tr>`).join("");
  return `<section class="card">
    <div class="card-head"><div class="filters"><input type="search" data-catalog-search value="${esc(state.catalogSearch)}" placeholder="Rechercher marque ou coloris…"></div>
      <span class="help">Prix d'achat usine HT au m²</span></div>
    <div class="table-wrap"><table>
      <thead><tr><th>Produit</th><th>Collection</th><th>Groupe</th><th>Dimensions maxi</th><th>8/12 mm</th><th>20 mm</th><th>30 mm</th><th>Actif</th></tr></thead>
      <tbody>${rows}</tbody></table></div></section>`;
}

function renderServices(catalog, editable) {
  return `<section class="card">
    <div class="card-head"><h3>Prestations issues du tarif d'essai</h3>
      <span class="help">Stone : granit, Silestone, Topzstone · Ultra : Dekton, Neolith</span></div>
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
  const type = input.dataset.catalogPrice;
  const prices = type === "material"
    ? { [input.dataset.thickness]: input.value }
    : { [input.dataset.family]: input.value };
  try {
    await request("/api/catalog", { method: "PATCH", body: { type, id: input.dataset.id, prices } });
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
