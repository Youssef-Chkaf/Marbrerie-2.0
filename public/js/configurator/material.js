// Étape 1 · Matière : choix du produit, coloris, épaisseur et finition du projet.

import { state, currentProject } from "../state.js";
import { esc, money, number } from "../ui.js";
import { saveProject } from "./index.js";
import { register } from "../actions.js";

const activeMaterials = () => state.data.catalog.materials.filter((m) => m.active);

export function renderMaterialStep(project) {
  const materials = activeMaterials();
  const brands = [...new Set(materials.map((m) => m.brand))];
  const selected = materials.find((m) => m.id === project.materialId) || materials[0];
  const colors = materials.filter((m) => m.brand === (selected?.brand || brands[0]));
  return `
  <div class="workspace" style="padding:22px">
    <div class="page-head"><div><h2>Matière principale du projet</h2>
      <p>Ce choix s'applique à toutes les pièces ; chaque élément peut ensuite avoir sa propre matière.</p></div></div>
    <div class="material-strip">
      ${brands.map((brand) => `<button class="material-chip ${selected?.brand === brand ? "active" : ""}" data-action="pick-brand" data-brand="${esc(brand)}">${esc(brand)}</button>`).join("")}
    </div>
    <div class="material-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:12px;margin-top:16px">
      ${colors.map((material) => `
        <button class="card material-card ${material.id === project.materialId ? "active" : ""}" data-action="pick-material" data-id="${material.id}"
          style="text-align:left;padding:13px;cursor:pointer;${material.id === project.materialId ? "outline:2px solid var(--accent, #c75b39)" : ""}">
          <span class="swatch" style="display:block;height:56px;border-radius:8px;background:${esc(material.tone)}"></span>
          <strong style="display:block;margin-top:9px">${esc(material.color)}</strong>
          <small>${esc(material.collection)} · Groupe ${esc(material.group)}</small><br>
          <small>dès ${money(Math.min(...Object.values(material.prices)))} /m² · maxi ${number(material.maxLengthMm)} × ${number(material.maxWidthMm)} mm</small>
        </button>`).join("")}
    </div>
    <div class="form-grid" style="margin-top:18px;max-width:520px">
      <label>Épaisseur<select data-action-change="set-thickness">
        ${Object.keys(selected?.prices || { 20: 0 }).map(Number).sort((a, b) => a - b)
          .map((t) => `<option value="${t}" ${Number(project.thicknessMm) === t ? "selected" : ""}>${t} mm</option>`).join("")}</select></label>
      <label>Finition<select data-action-change="set-finish">
        ${(selected?.finish || ["Poli"]).map((f) => `<option ${project.finish === f ? "selected" : ""}>${esc(f)}</option>`).join("")}</select></label>
    </div>
  </div>`;
}

register({
  "pick-brand": (el) => {
    const project = currentProject();
    const first = activeMaterials().find((m) => m.brand === el.dataset.brand);
    if (first) { project.materialId = first.id; saveProject(false); }
    window.dispatchEvent(new Event("marbexa:render"));
  },
  "pick-material": (el) => {
    const project = currentProject();
    project.materialId = el.dataset.id;
    const material = activeMaterials().find((m) => m.id === el.dataset.id);
    if (material && !material.finish.includes(project.finish)) project.finish = material.finish[0];
    saveProject(false);
    window.dispatchEvent(new Event("marbexa:render"));
  },
});

export function handleMaterialChange(select) {
  const project = currentProject();
  if (!project) return false;
  if (select.dataset.actionChange === "set-thickness") { project.thicknessMm = Number(select.value); saveProject(); return true; }
  if (select.dataset.actionChange === "set-finish") { project.finish = select.value; saveProject(); return true; }
  return false;
}
