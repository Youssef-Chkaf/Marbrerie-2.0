// Étape 1 · Matière : cascade Produit → Coloris → Finition → Épaisseur,
// branchée sur le catalogue à variantes (import e-marbrier).

import { state, currentProject } from "../state.js";
import { esc, money, number } from "../ui.js";
import { saveProject } from "./index.js";
import { register } from "../actions.js";

const activeMaterials = () => state.data.catalog.materials.filter((m) => m.active);

export const materialFinishes = (material) =>
  [...new Map((material?.variants || []).map((v) => [v.finish, v.finishLabel || v.finish])).entries()];

export const finishThicknesses = (material, finish) =>
  (material?.variants || []).filter((v) => v.finish === finish).map((v) => v.thicknessMm).sort((a, b) => a - b);

export const findVariantLocal = (material, finish, thickness) =>
  (material?.variants || []).find((v) => v.finish === finish && v.thicknessMm === Number(thickness));

export function renderMaterialStep(project) {
  const materials = activeMaterials();
  const brands = [...new Set(materials.map((m) => m.brand))];
  const selected = materials.find((m) => m.id === project.materialId) || materials[0];
  const brand = selected?.brand || brands[0];
  const query = (state.materialSearch || "").toLowerCase();
  const colors = materials.filter((m) => m.brand === brand)
    .filter((m) => !query || `${m.color} ${m.collection}`.toLowerCase().includes(query));
  const finishes = materialFinishes(selected);
  const currentFinish = finishes.some(([code]) => code === project.finish) ? project.finish : finishes[0]?.[0];
  const thicknesses = finishThicknesses(selected, currentFinish);
  const variant = findVariantLocal(selected, currentFinish, project.thicknessMm)
    || findVariantLocal(selected, currentFinish, thicknesses[0]);

  return `
  <div class="workspace" style="padding:22px">
    <div class="page-head"><div><h2>Matière principale du projet</h2>
      <p>Ce choix s'applique à toutes les pièces ; chaque élément peut ensuite avoir sa propre matière.</p></div>
      <div class="filters"><input type="search" data-material-search value="${esc(state.materialSearch || "")}" placeholder="Rechercher un coloris…"></div></div>
    <div class="material-strip" style="display:flex;gap:7px;flex-wrap:wrap">
      ${brands.map((b) => `<button class="material-chip ${brand === b ? "active" : ""}" data-action="pick-brand" data-brand="${esc(b)}" style="${brand === b ? "outline:2px solid #c75b39;" : ""}cursor:pointer">${esc(b)}</button>`).join("")}
    </div>
    <div class="material-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px;margin-top:16px;max-height:430px;overflow:auto;padding:3px">
      ${colors.map((material) => {
        const cheapest = Math.min(...material.variants.map((v) => v.priceM2));
        return `
        <button class="card" data-action="pick-material" data-id="${material.id}"
          style="text-align:left;padding:12px;cursor:pointer;${material.id === project.materialId ? "outline:2px solid #c75b39" : ""}">
          <span class="swatch" style="display:block;height:48px;border-radius:8px;background:${esc(material.tone)}"></span>
          <strong style="display:block;margin-top:8px">${esc(material.color)}</strong>
          <small>${esc(material.brand)} · ${material.variants.length} variante(s)</small><br>
          <small>dès ${money(cheapest)} /m² (achat)</small>
        </button>`;
      }).join("") || `<div class="empty"><p>Aucun coloris ne correspond.</p></div>`}
    </div>
    <div class="form-grid" style="margin-top:18px;max-width:680px">
      <label>Finition<select data-action-change="set-finish">
        ${finishes.map(([code, label]) => `<option value="${esc(code)}" ${currentFinish === code ? "selected" : ""}>${esc(label)}</option>`).join("")}</select></label>
      <label>Épaisseur<select data-action-change="set-thickness">
        ${thicknesses.map((t) => `<option value="${t}" ${Number(project.thicknessMm) === t ? "selected" : ""}>${t} mm</option>`).join("")}</select></label>
      <div class="kpi" style="align-self:end"><small>Variante retenue</small>
        <strong>${variant ? `${money(variant.priceM2)} /m²` : "—"}</strong>
        <span>${variant ? `plaque ${number(variant.maxLengthMm)} × ${number(variant.maxWidthMm)} mm${variant.format ? ` · ${esc(variant.format)}` : ""}` : "choisissez finition et épaisseur"}</span></div>
    </div>
  </div>`;
}

function ensureConsistency(project) {
  const material = activeMaterials().find((m) => m.id === project.materialId);
  if (!material) return;
  const finishes = materialFinishes(material);
  if (!finishes.some(([code]) => code === project.finish)) project.finish = finishes[0]?.[0] || project.finish;
  const thicknesses = finishThicknesses(material, project.finish);
  if (!thicknesses.includes(Number(project.thicknessMm))) project.thicknessMm = thicknesses[0] || project.thicknessMm;
}

register({
  "pick-brand": (el) => {
    const project = currentProject();
    const first = activeMaterials().find((m) => m.brand === el.dataset.brand);
    if (first) { project.materialId = first.id; ensureConsistency(project); saveProject(false); }
    window.dispatchEvent(new Event("marbexa:render"));
  },
  "pick-material": (el) => {
    const project = currentProject();
    project.materialId = el.dataset.id;
    ensureConsistency(project);
    saveProject(false);
    window.dispatchEvent(new Event("marbexa:render"));
  },
});

export function handleMaterialChange(select) {
  const project = currentProject();
  if (!project) return false;
  if (select.dataset.actionChange === "set-thickness") {
    project.thicknessMm = Number(select.value);
    saveProject(false, { rerender: true });
    return true;
  }
  if (select.dataset.actionChange === "set-finish") {
    project.finish = select.value;
    ensureConsistency(project);
    saveProject(false, { rerender: true });
    return true;
  }
  return false;
}
