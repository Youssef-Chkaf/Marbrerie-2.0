// Devis & projets (revendeur) : liste, création manuelle, import DXF/PDF
// (moteur IA Marbexa) et écran de vérification du brouillon proposé.

import { state, resetConfigurator } from "../state.js";
import { request, refresh, fileToBase64 } from "../api.js";
import { esc, money, dateFr, statusBadge, toast, showModal, closeModal, materialLabel } from "../ui.js";
import { register } from "../actions.js";
import { openConfigurator } from "../configurator/index.js";
import { openOrderModal } from "./orders.js";

const activeMaterials = () => state.data.catalog.materials.filter((m) => m.active);
const brands = () => [...new Set(activeMaterials().map((m) => m.brand))];
const finishesOf = (material) => [...new Map((material?.variants || []).map((v) => [v.finish, v.finishLabel || v.finish])).entries()];
const thicknessesOf = (material, finish) => (material?.variants || []).filter((v) => v.finish === finish).map((v) => v.thicknessMm).sort((a, b) => a - b);

// Cascade Produit → Coloris → Finition → Épaisseur (catalogue à variantes).
export function materialSelectors(prefix, selected = {}) {
  const first = activeMaterials()[0];
  const brand = selected.brand || first?.brand;
  const colors = activeMaterials().filter((m) => m.brand === brand);
  const material = colors.find((m) => m.id === selected.materialId) || colors[0];
  const finishes = finishesOf(material);
  const finish = finishes.some(([code]) => code === selected.finish) ? selected.finish : finishes[0]?.[0];
  const thicknesses = thicknessesOf(material, finish);
  return `
    <label>Produit<select data-ms="${prefix}" data-ms-field="brand" required>
      ${brands().map((b) => `<option ${b === brand ? "selected" : ""}>${esc(b)}</option>`).join("")}</select></label>
    <label>Coloris<select name="materialId" data-ms="${prefix}" data-ms-field="color" required>
      ${colors.map((m) => `<option value="${m.id}" ${m.id === material?.id ? "selected" : ""}>${esc(m.color)}</option>`).join("")}</select></label>
    <label>Finition<select name="finish" data-ms="${prefix}" data-ms-field="finish" required>
      ${finishes.map(([code, label]) => `<option value="${esc(code)}" ${finish === code ? "selected" : ""}>${esc(label)}</option>`).join("")}</select></label>
    <label>Épaisseur<select name="thicknessMm" required>
      ${thicknesses.map((t) => `<option value="${t}" ${Number(selected.thicknessMm) === t ? "selected" : ""}>${t} mm</option>`).join("")}</select></label>`;
}

// Reconstruit les selects dépendants quand marque / coloris / finition changent.
export function handleMaterialCascade(select) {
  if (select.dataset.ms === undefined) return false;
  const form = select.closest("form");
  if (!form) return true;
  const container = form.querySelector(`[data-ms="${select.dataset.ms}"]`)?.closest(".form-grid") || form;
  const brandSel = container.querySelector('[data-ms-field="brand"]');
  const colorSel = container.querySelector('[name="materialId"]');
  const finishSel = container.querySelector('[name="finish"]');
  const thickSel = container.querySelector('[name="thicknessMm"]');
  const brand = brandSel?.value;
  const colors = activeMaterials().filter((m) => m.brand === brand);
  if (select.dataset.msField === "brand" && colorSel) {
    colorSel.innerHTML = colors.map((m) => `<option value="${m.id}">${esc(m.color)}</option>`).join("");
  }
  const material = colors.find((m) => m.id === colorSel?.value) || colors[0];
  const finishes = finishesOf(material);
  if (["brand", "color"].includes(select.dataset.msField) && finishSel) {
    finishSel.innerHTML = finishes.map(([code, label]) => `<option value="${esc(code)}">${esc(label)}</option>`).join("");
  }
  const finish = finishSel?.value || finishes[0]?.[0];
  if (thickSel) {
    thickSel.innerHTML = thicknessesOf(material, finish).map((t) => `<option value="${t}">${t} mm</option>`).join("");
  }
  return true;
}

export function renderProjects() {
  const projects = state.data.projects.filter((p) => !p.archived)
    .filter((p) => !state.filters.search || `${p.title} ${p.customer?.name || ""} ${p.reference}`.toLowerCase().includes(state.filters.search.toLowerCase()))
    .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
  return `
  <div class="page-head"><div><h2>Devis & projets</h2>
    <p>Les commandes déjà envoyées sont protégées et passent par une modification urgente.</p></div>
    <div class="page-actions">
      <button class="btn btn-ghost" data-action="archive-projects">Archiver</button>
      <button class="btn btn-ghost btn-danger" data-action="delete-projects">Supprimer</button>
      <button class="btn btn-primary" data-action="new-project-choice">+ Nouveau devis</button>
    </div></div>
  <section class="card">
    <div class="card-head"><div class="filters">
      <input type="search" data-filter="search" value="${esc(state.filters.search)}" placeholder="Rechercher un client ou projet…"></div></div>
    <div class="table-wrap"><table>
      <thead><tr><th></th><th>Projet</th><th>Client</th><th>Matériau</th><th>Vente HT</th><th>Vente TTC</th><th>État</th><th>Mis à jour</th><th></th></tr></thead>
      <tbody>${projects.map((p) => {
        const order = state.data.orders.find((o) => o.projectId === p.id && o.status !== "cancelled");
        return `<tr>
        <td class="check-cell"><input type="checkbox" data-select-project="${p.id}"></td>
        <td><div class="table-title">${esc(p.title)}</div><div class="table-sub">${esc(p.reference)}</div></td>
        <td>${esc(p.customer?.name || "—")}</td>
        <td>${esc(materialLabel(p.materialId))}</td>
        <td>${money(p.quote?.customerHT)}</td><td>${money(p.quote?.customerTTC)}</td>
        <td>${statusBadge(order ? order.status : p.status === "draft" ? "quote" : p.status)}</td>
        <td>${dateFr(p.updatedAt)}</td>
        <td>${order
          ? `<button class="btn btn-small btn-soft" data-action="open-order" data-id="${order.id}">Voir la commande</button>`
          : `<button class="btn btn-small" data-action="open-project" data-id="${p.id}">Ouvrir</button>`}</td>
      </tr>`;
      }).join("") || `<tr><td colspan="9"><div class="empty"><p>Aucun projet pour l'instant.</p></div></td></tr>`}</tbody>
    </table></div>
  </section>`;
}

// ---------- Création ----------

function newProjectChoiceModal() {
  showModal(`
    <div class="modal-head"><div><h2>Nouveau devis</h2><p>Choisissez comment vous souhaitez préparer les plans.</p></div>
      <button type="button" class="icon-btn" data-action="close-modal">×</button></div>
    <div class="modal-body">
      <div class="project-choice-grid">
        <button type="button" class="project-choice featured" data-action="ai-new-project">
          <span class="project-choice-icon">✦</span>
          <span><strong>Générer vos plans automatiquement</strong>
          <small>À partir d'un DXF 2D ou d'un PDF exporté d'un autre logiciel.</small>
          <em>Import DXF 2D ou moteur IA Marbexa</em></span><b>→</b></button>
        <button type="button" class="project-choice" data-action="manual-new-project">
          <span class="project-choice-icon">⌑</span>
          <span><strong>Concevoir les plans manuellement</strong>
          <small>Créez chaque plan, puis placez vous-même les découpes, chants et angles.</small></span><b>→</b></button>
      </div>
      <div class="ai-safety-note"><strong>Principe de sécurité</strong>
        <span>Marbexa lit directement les calques et courbes des DXF 2D. Pour les PDF, le moteur IA Marbexa dessine un brouillon et marque à vérifier les éléments incertains. Vous contrôlez toujours le brouillon avant la fabrication.</span></div>
    </div>
    <div class="modal-actions"><button type="button" class="btn btn-ghost" data-action="close-modal">Annuler</button></div>`, true);
}

function projectFormFields(withFile) {
  return `
    ${withFile ? `<label class="ai-upload"><span class="ai-upload-icon">⇧</span>
      <strong>Déposez ou sélectionnez le fichier du plan</strong>
      <small>DXF 2D ou PDF vectoriel · 12 Mo maximum</small>
      <input name="planFile" type="file" accept=".dxf,.pdf,application/pdf" required></label>` : ""}
    <div class="form-grid">
      <label class="wide">Nom du projet<input name="title" placeholder="Cuisine Martin" required></label>
      <label>Client final<input name="customerName" required></label>
      <label>Type de pièce<select name="roomType"><option>Cuisine</option><option>Salle de bain</option><option>Agencement</option></select></label>
      ${materialSelectors("new-project")}
      <label>Semaine de livraison souhaitée<input name="deliveryWeek" type="week" min="${esc(state.data.system.minimumDeliveryWeek)}" value="${esc(state.data.system.minimumDeliveryWeek)}"></label>
      ${withFile ? `<label class="wide">Indications complémentaires pour l'analyse<textarea name="notes" rows="2" placeholder="Exemple : le grand rectangle est le plan principal…"></textarea></label>` : ""}
    </div>`;
}

function manualNewProjectModal() {
  showModal(`<form id="manual-project-form">
    <div class="modal-head"><div><h2>Concevoir les plans manuellement</h2><p>Le produit choisi s'applique à tout le projet ; chaque élément peut ensuite être changé.</p></div>
      <button type="button" class="icon-btn" data-action="close-modal">×</button></div>
    <div class="modal-body stack">${projectFormFields(false)}</div>
    <div class="modal-actions"><button type="button" class="btn btn-ghost" data-action="close-modal">Annuler</button>
      <button class="btn btn-primary">Créer le projet et dessiner</button></div></form>`, true);
}

function aiNewProjectModal() {
  showModal(`<form id="ai-project-form">
    <div class="modal-head"><div><h2>Générer les plans automatiquement</h2><p>DXF 2D ou PDF · dimensions, découpes et perçages détectés.</p></div>
      <button type="button" class="icon-btn" data-action="close-modal">×</button></div>
    <div class="modal-body stack">
      ${projectFormFields(true)}
      <div class="ai-privacy"><strong>Contrôle obligatoire avant fabrication.</strong> Les fichiers sont analysés sur votre serveur Marbexa et n'en sortent pas. Les éléments incertains sont marqués « à vérifier ».</div>
    </div>
    <div class="modal-actions"><button type="button" class="btn btn-ghost" data-action="close-modal">Annuler</button>
      <button class="btn btn-primary">Analyser le fichier</button></div></form>`, true);
}

function aiReviewModal(result, fields) {
  const pieces = result.pieces.map((piece, index) => `
    <div class="ai-result-piece">
      <div><strong>${esc(piece.name)}</strong> — ${piece.lengthMm} × ${piece.widthMm} mm
        ${piece.needsReview ? `<span class="ai-review-badge">à vérifier</span>` : ""}</div>
      <small>${(piece.cutouts || []).length} découpe(s) proposée(s) : ${(piece.cutouts || []).map((c) => `${c.kind} ${c.widthMm}×${c.heightMm}`).join(", ") || "aucune"}</small>
    </div>`).join("");
  showModal(`
    <div class="modal-head"><div><h2>${result.sourceType === "dxf" ? "Brouillon importé depuis le DXF 2D" : "Brouillon proposé par le moteur IA Marbexa"}</h2>
      <p>${result.pieces.length} pièce(s) détectée(s) · ${(result.issues || []).length} point(s) à contrôler</p></div>
      <button class="icon-btn" data-action="close-modal">×</button></div>
    <div class="modal-body stack">
      ${pieces ? `<div class="ai-result-list">${pieces}</div>` : `<div class="warning"><strong>Aucun plan ne peut être dessiné.</strong><br>Les dimensions principales sont absentes ou impossibles à rattacher. Essayez un fichier plus net ou passez en conception manuelle.</div>`}
      ${(result.issues || []).length ? `<section class="ai-issues"><h3>Éléments à vérifier ou non ajoutés</h3><ul>${result.issues.slice(0, 40).map((issue) => `<li>${esc(issue)}</li>`).join("")}</ul></section>` : ""}
      <div class="ai-safety-note"><strong>${result.sourceType === "dxf" ? "Le DXF 2D est un brouillon technique à contrôler avant usinage." : "Le moteur IA Marbexa prépare un brouillon, jamais un ordre de fabrication."}</strong>
        <span>Corrigez les dimensions, les axes, les rayons et les chants avant d'envoyer la commande à l'usine.</span></div>
    </div>
    <div class="modal-actions">
      <button class="btn btn-ghost" data-action="ai-new-project">Analyser un autre fichier</button>
      <button class="btn btn-soft" data-action="manual-new-project">Passer en manuel</button>
      ${result.pieces.length ? `<button class="btn btn-primary" data-action="create-ai-project">Créer le brouillon et vérifier les plans</button>` : ""}
    </div>`, true);
  state.aiProposal = { result, fields };
}

async function createProject(fields, pieces, importSource) {
  const payload = {
    title: fields.title,
    roomType: fields.roomType,
    customer: { name: fields.customerName || "" },
    materialId: fields.materialId,
    thicknessMm: Number(fields.thicknessMm),
    finish: fields.finish,
    deliveryWeek: fields.deliveryWeek,
    notes: fields.notes || "",
    pieces: pieces || [],
    importSource: importSource || null,
  };
  const { project } = await request("/api/projects", { body: payload });
  await refresh();
  closeModal();
  openConfigurator(project.id, pieces?.length ? "design" : "material");
}

export async function handleProjectForms(form) {
  const data = Object.fromEntries(new FormData(form).entries());
  if (form.id === "manual-project-form") {
    await createProject(data, []);
    return true;
  }
  if (form.id === "ai-project-form") {
    const file = form.querySelector("[name=planFile]")?.files?.[0];
    if (!file) { toast("Sélectionnez un fichier DXF ou PDF.", "error"); return true; }
    if (file.size > 12 * 1024 * 1024) { toast("Fichier trop lourd (12 Mo max).", "error"); return true; }
    const submitButton = form.querySelector(".btn-primary");
    submitButton.disabled = true;
    submitButton.textContent = "Analyse en cours…";
    try {
      const result = await request("/api/import-plan", {
        body: { fileName: file.name, dataBase64: await fileToBase64(file) },
      });
      aiReviewModal(result, data);
    } catch (error) {
      toast(error.message, "error");
      submitButton.disabled = false;
      submitButton.textContent = "Analyser le fichier";
    }
    return true;
  }
  return false;
}

register({
  "new-project-choice": () => newProjectChoiceModal(),
  "manual-new-project": () => manualNewProjectModal(),
  "ai-new-project": () => aiNewProjectModal(),

  "create-ai-project": async () => {
    const proposal = state.aiProposal;
    if (!proposal) return;
    // Positionne les pièces proposées côte à côte sur le plan de travail.
    let x = 60;
    const pieces = proposal.result.pieces.map((piece) => {
      const placed = { ...piece, x, y: piece.kind === "splashback" ? 40 : 140, edges: piece.edges || [], corners: piece.corners || {} };
      x += Math.max(90, piece.lengthMm * 0.12) + 40;
      return placed;
    });
    try {
      await createProject(proposal.fields, pieces, proposal.result.sourceType === "dxf" ? "import DXF 2D" : "moteur IA Marbexa");
      toast("Brouillon créé : vérifiez chaque cote avant l'envoi.");
    } catch (error) { toast(error.message, "error"); }
  },

  "open-project": (el) => openConfigurator(el.dataset.id),

  "archive-projects": async () => {
    const ids = [...document.querySelectorAll("[data-select-project]:checked")].map((i) => i.dataset.selectProject);
    if (!ids.length) { toast("Aucun projet sélectionné.", "error"); return; }
    for (const id of ids) await request(`/api/projects/${id}`, { method: "PATCH", body: { archived: true } }).catch((e) => toast(e.message, "error"));
    await refresh();
    toast("Projets archivés.");
    window.dispatchEvent(new Event("marbexa:render"));
  },

  "delete-projects": async () => {
    const ids = [...document.querySelectorAll("[data-select-project]:checked")].map((i) => i.dataset.selectProject);
    if (!ids.length) { toast("Aucun projet sélectionné.", "error"); return; }
    if (!confirm(`Supprimer définitivement ${ids.length} projet(s) ? Les projets avec commande doivent être archivés.`)) return;
    for (const id of ids) await request(`/api/projects/${id}`, { method: "DELETE" }).catch((e) => toast(e.message, "error"));
    await refresh();
    window.dispatchEvent(new Event("marbexa:render"));
  },
});
