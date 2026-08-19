// Configurateur : enchaîne les trois étapes 1·Matière → 2·Dessin → 3·Chiffrage.

import { state, resetConfigurator, currentProject } from "../state.js";
import { request, refresh } from "../api.js";
import { esc, toast } from "../ui.js";
import { register } from "../actions.js";
import { renderDesignStep } from "./canvas.js";
import { renderCredenceView } from "./credence.js";
import { renderQuoteStep } from "./quote.js";
import { renderDetailEditor } from "./details.js";

let saveTimer = null;
let pendingSave = false;

export function openConfigurator(projectId, step) {
  const project = state.data.projects.find((p) => p.id === projectId);
  if (!project) { toast("Projet introuvable.", "error"); return; }
  // Comme dans l'app d'origine : on arrive directement sur l'étape Dessin,
  // la matière se règle dans le bandeau au-dessus du plan.
  resetConfigurator(projectId, step || "design");
  state.view = "configurator";
  window.dispatchEvent(new Event("marbexa:render"));
}

export function closeConfigurator() {
  state.configurator = null;
  state.view = state.data.user.role === "factory" ? "orders" : "projects";
  window.dispatchEvent(new Event("marbexa:render"));
}

// Sauvegarde différée : le serveur recalcule le devis et renvoie le projet.
export function saveProject(immediate = false, { rerender = false } = {}) {
  const project = currentProject();
  if (!project) return;
  pendingSave = true;
  clearTimeout(saveTimer);
  const doSave = async () => {
    pendingSave = false;
    try {
      const body = {
        title: project.title, roomType: project.roomType, customer: project.customer,
        materialId: project.materialId, thicknessMm: project.thicknessMm, finish: project.finish,
        marginPct: project.marginPct, vatPct: project.vatPct,
        manualQuoteLines: project.manualQuoteLines || [],
        commercialDiscount: project.commercialDiscount,
        deliveryWeek: project.deliveryWeek, deliveryDistanceKm: project.deliveryDistanceKm,
        notes: project.notes, pieces: project.pieces,
        quoteDate: project.quoteDate, validityDate: project.validityDate, customerOrderDate: project.customerOrderDate,
        customStoneLabel: project.customStoneLabel || "", customStonePriceM2: Number(project.customStonePriceM2 || 0),
      };
      const result = await request(`/api/projects/${project.id}`, { method: "PATCH", body });
      const index = state.data.projects.findIndex((p) => p.id === project.id);
      if (index !== -1) state.data.projects[index] = result.project;
      state.lastIssues = result.issues || [];
      const saveState = document.querySelector(".save-state");
      if (saveState) saveState.textContent = "Projet enregistré";
      if (rerender) window.dispatchEvent(new Event("marbexa:render"));
    } catch (error) {
      toast(error.message, "error");
    }
  };
  const saveState = document.querySelector(".save-state");
  if (saveState) saveState.textContent = "Modifications non enregistrées…";
  if (immediate) return doSave();
  saveTimer = setTimeout(doSave, 600);
}

export function renderConfigurator() {
  const project = currentProject();
  const cfg = state.configurator;
  if (!project || !cfg) return `<div class="empty"><p>Projet introuvable.</p></div>`;

  const steps = `
    <div class="steps">
      <button class="step ${cfg.step === "design" || cfg.step === "credence" ? "active" : ""}" data-action="cfg-step" data-step="design">1 · Dessin</button>
      <button class="step ${cfg.step === "quote" ? "active" : ""}" data-action="cfg-step" data-step="quote">2 · Chiffrage</button>
    </div>`;

  const head = `
    <div class="flow-head">
      <div class="flow-title">
        <button class="icon-btn" data-action="cfg-back">←</button>
        <div><h2>${esc(project.title)}</h2><small>${esc(project.reference)} · ${esc(project.customer?.name || "")}</small></div>
      </div>
      ${steps}
      <div class="page-actions">
        <button class="btn btn-ghost" data-action="cfg-save">Enregistrer</button>
        <button class="btn btn-primary" data-action="cfg-step" data-step="quote">Chiffrer →</button>
      </div>
    </div>`;

  const body = cfg.step === "credence" ? renderCredenceView(project)
    : cfg.step === "quote" ? renderQuoteStep(project)
    : cfg.detailPieceId ? renderDetailEditor()
    : renderDesignStep(project);

  const nextAction = cfg.step === "quote"
    ? ""
    : `<button class="btn btn-primary" data-action="cfg-step" data-step="quote">Passer au chiffrage →</button>`;
  const footer = `
    <div class="flow-footer">
      <span class="save-state">${pendingSave ? "Modifications non enregistrées…" : "Projet enregistré"}</span>
      <div style="display:flex;gap:8px">
        ${cfg.step === "credence" ? `<button class="btn btn-ghost" data-action="cfg-step" data-step="design">← Vue d'ensemble</button>` : ""}
        ${cfg.detailPieceId ? `<button class="btn btn-ghost" data-action="close-details">← Vue d'ensemble</button>` : ""}
        <button class="btn btn-dark" data-action="cfg-save">Enregistrer</button>
        ${nextAction}
      </div>
    </div>`;

  return `<div class="project-flow" style="margin-top:-10px">${head}${body}${footer}</div>`;
}

register({
  "cfg-back": () => closeConfigurator(),
  "cfg-save": () => { saveProject(true, { rerender: true }); toast("Projet enregistré."); },
  "cfg-step": (el) => {
    state.configurator.step = el.dataset.step;
    state.configurator.detailPieceId = null;
    saveProject(true, { rerender: true });
  },
  "cfg-credence-view": (el) => {
    state.configurator.step = "credence";
    if (el.dataset.wall) state.configurator.wallViewId = el.dataset.wall;
    window.dispatchEvent(new Event("marbexa:render"));
  },
});
