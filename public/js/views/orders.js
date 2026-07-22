// Commandes usine : liste filtrable, détail avec corrections, commentaires,
// pièces jointes, étapes de fabrication, regroupement de livraison.

import { state } from "../state.js";
import { request, refresh, fileToDataUrl } from "../api.js";
import { esc, money, dateFr, statusBadge, toast, showModal, closeModal, materialLabel, weekLabel } from "../ui.js";
import { register } from "../actions.js";
import { previewPieces } from "./preview.js";
import { openConfigurator } from "../configurator/index.js";

const orderAmount = (order) => order.project?.quote?.purchaseHT || 0;

export function filterOrders(orders) {
  const f = state.filters;
  return orders.filter((order) => {
    const project = order.project || {};
    if (f.search) {
      const haystack = `${order.number} ${project.customer?.name || ""} ${project.title || ""}`.toLowerCase();
      if (!haystack.includes(f.search.toLowerCase())) return false;
    }
    if (f.status && order.status !== f.status) return false;
    if (f.reseller && order.resellerId !== f.reseller) return false;
    if (f.material && project.materialId !== f.material) return false;
    if (f.week && order.deliveryWeek !== f.week) return false;
    if (f.from && (order.createdAt || "") < f.from) return false;
    if (f.to && (order.createdAt || "") > `${f.to}T23:59:59`) return false;
    return true;
  });
}

export function ordersTable(orders, { compact = false, selectable = false } = {}) {
  if (!orders.length) return `<div class="empty"><p>Aucune commande.</p></div>`;
  const isFactory = state.data.user.role === "factory";
  return `<div class="table-wrap"><table>
    <thead><tr>${selectable ? "<th></th>" : ""}<th>Commande</th><th>Client final</th><th>Revendeur</th><th>Matériau</th><th>Semaine</th><th>Montant usine</th>${compact ? "" : "<th>Statut</th><th></th>"}</tr></thead>
    <tbody>${orders.map((order) => `<tr>
      ${selectable ? `<td class="check-cell"><input type="checkbox" data-select-order="${order.id}" ${state.selectedOrderIds.includes(order.id) ? "checked" : ""}></td>` : ""}
      <td><div class="table-title">${esc(order.number)}</div><div class="table-sub">${dateFr(order.createdAt)}</div></td>
      <td>${esc(order.project?.customer?.name || "—")}</td>
      <td>${esc(order.reseller?.company || "—")}</td>
      <td>${esc(materialLabel(order.project?.materialId))}</td>
      <td>${esc(order.deliveryWeek || "—")}${order.project?.consolidatedDelivery ? ` <span class="delivery-group-badge" title="Livraison groupée">⧉</span>` : ""}</td>
      <td>${money(orderAmount(order))}</td>
      ${compact ? "" : `<td>${statusBadge(order.status)}</td>
      <td><button class="btn btn-small" data-action="open-order" data-id="${order.id}">Ouvrir</button></td>`}
    </tr>`).join("")}</tbody></table></div>`;
}

export function renderOrdersPage() {
  const isFactory = state.data.user.role === "factory";
  const orders = filterOrders(state.data.orders.filter((o) => !o.archived));
  const weeks = [...new Set(state.data.orders.map((o) => o.deliveryWeek).filter(Boolean))].sort();
  return `
  <div class="page-head"><div><h2>Commandes</h2>
    <p>Filtrez, contrôlez, regroupez les livraisons et archivez les commandes terminées.</p></div>
    <div class="page-actions">
      <button class="btn btn-dark" data-action="group-delivery">Regrouper la livraison</button>
      <button class="btn btn-ghost" data-action="archive-selection">Archiver la sélection</button>
      ${isFactory ? "" : `<button class="btn btn-primary" data-action="new-project-choice">+ Nouveau devis</button>`}
    </div></div>
  <section class="card">
    <div class="card-head"><div class="filters">
      <input type="search" data-filter="search" value="${esc(state.filters.search)}" placeholder="Client, commande…">
      <select data-filter="status"><option value="">Tous les statuts</option>
        ${Object.entries(state.data.system.statusLabels).filter(([key]) => !["draft", "quote", "submitted"].includes(key))
          .map(([key, label]) => `<option value="${key}" ${state.filters.status === key ? "selected" : ""}>${esc(label)}</option>`).join("")}</select>
      ${isFactory ? `<select data-filter="reseller"><option value="">Tous les revendeurs</option>
        ${state.data.resellers.map((r) => `<option value="${r.id}" ${state.filters.reseller === r.id ? "selected" : ""}>${esc(r.company)}</option>`).join("")}</select>` : ""}
      <select data-filter="material"><option value="">Tous les produits</option>
        ${state.data.catalog.materials.map((m) => `<option value="${m.id}" ${state.filters.material === m.id ? "selected" : ""}>${esc(m.brand)} · ${esc(m.color)}</option>`).join("")}</select>
      <select data-filter="week"><option value="">Toutes les semaines</option>
        ${weeks.map((w) => `<option ${state.filters.week === w ? "selected" : ""}>${esc(w)}</option>`).join("")}</select>
      <input type="date" data-filter="from" value="${esc(state.filters.from)}">
      <input type="date" data-filter="to" value="${esc(state.filters.to)}">
    </div></div>
    ${ordersTable(orders, { selectable: true })}
  </section>`;
}

function productionChecklist(order) {
  const steps = state.data.system.productionSteps || [];
  const editable = state.data.user.role === "factory" && ["approved", "in_production"].includes(order.status);
  return `<div class="card" style="margin-top:12px"><div class="card-head"><h3>Étapes de fabrication</h3></div>
    <div class="card-body"><ul class="checklist" style="list-style:none;padding:0;margin:0;display:grid;gap:6px;text-align:left">
    ${steps.map((step) => {
      const done = order.productionSteps?.[step.id];
      return `<li style="display:flex;align-items:center;justify-content:flex-start;gap:9px;text-align:left">
        <input type="checkbox" data-production-step="${step.id}" data-order="${order.id}" ${done ? "checked" : ""} ${editable ? "" : "disabled"}>
        <span>${esc(step.label)}</span>
        ${done ? `<small class="help">${dateFr(done.at)} · ${esc(done.by || "")}</small>` : ""}
      </li>`;
    }).join("")}</ul></div></div>`;
}

export function openOrderModal(orderId) {
  const order = state.data.orders.find((o) => o.id === orderId);
  if (!order) return;
  const project = order.project;
  const role = state.data.user.role;
  const isFactory = role === "factory";
  const correctionRequested = order.status === "changes_requested";

  const actionButtons = [];
  if (isFactory) {
    if (order.status === "factory_review") {
      actionButtons.push(`<button class="btn btn-danger btn-ghost" data-action="order-status" data-id="${order.id}" data-status="changes_requested">Demander correction</button>`);
      actionButtons.push(`<button class="btn btn-dark" data-action="order-status" data-id="${order.id}" data-status="approved">Lancer en fabrication</button>`);
      actionButtons.push(`<button class="btn btn-soft" data-action="order-status" data-id="${order.id}" data-status="factory_proposal">Proposer une autre semaine</button>`);
    }
    if (order.status === "approved") actionButtons.push(`<button class="btn btn-primary" data-action="order-status" data-id="${order.id}" data-status="in_production">Démarrer la fabrication</button>`);
    if (order.status === "in_production") actionButtons.push(`<button class="btn btn-primary" data-action="order-status" data-id="${order.id}" data-status="shipped">Marquer envoyée</button>`);
    if (order.status === "shipped") actionButtons.push(`<button class="btn btn-primary" data-action="order-status" data-id="${order.id}" data-status="delivered">Marquer livrée</button>`);
  } else {
    if (order.status === "factory_proposal") {
      actionButtons.push(`<button class="btn btn-primary" data-action="order-status" data-id="${order.id}" data-status="reseller_accepted">Accepter la proposition</button>`);
    }
    if (correctionRequested) {
      actionButtons.push(`<button class="btn btn-primary" data-action="order-status" data-id="${order.id}" data-status="factory_review">Renvoyer pour contrôle usine</button>`);
    }
    if (order.status === "shipped") actionButtons.push(`<button class="btn btn-primary" data-action="order-status" data-id="${order.id}" data-status="delivered">Confirmer la réception</button>`);
  }
  if (["factory_review", "changes_requested", "approved"].includes(order.status)) {
    actionButtons.push(`<button class="btn btn-ghost btn-danger" data-action="order-status" data-id="${order.id}" data-status="cancelled">Annuler</button>`);
  }

  const canEditPlan = (isFactory && !["shipped", "delivered", "cancelled"].includes(order.status))
    || (!isFactory && correctionRequested);
  const dxfAvailable = isFactory || ["approved", "in_production", "shipped", "delivered"].includes(order.status);

  const documents = `
    ${canEditPlan ? `<button class="btn btn-small btn-dark" data-action="edit-order-plan" data-id="${order.id}">${correctionRequested && !isFactory ? "Corriger le plan demandé" : "Modifier le plan"}</button>` : ""}
    <a class="btn btn-small ${isFactory ? "btn-ghost" : "btn-soft"}" href="/print/${project.id}?type=factory-order" target="_blank">Bon de commande usine</a>
    <a class="btn btn-small btn-ghost" href="/print/${project.id}?type=technical" target="_blank">Fiche technique</a>
    ${dxfAvailable ? `<a class="btn btn-small btn-dark" href="/api/orders/${order.id}/dxf">Télécharger le DXF 2D machine</a>` : ""}
    ${!isFactory ? `<a class="btn btn-small btn-ghost" href="/print/${project.id}?type=quote" target="_blank">Devis client</a>` : ""}`;

  const correctionPanel = correctionRequested
    ? `<div class="urgent-edit-banner"><strong>Corrections demandées par l'usine.</strong> Modifiez le plan puis renvoyez la commande pour contrôle.</div>`
    : "";

  const attachments = (order.attachments || []).length
    ? `<div class="attachment-list">${order.attachments.map((file) => `<a href="${esc(file.dataUrl)}" download="${esc(file.name)}">${esc(file.name)}</a>`).join("")}</div>` : "";

  showModal(`
    <div class="modal-head"><div><h2>${esc(order.number)} · ${esc(project.customer?.name || project.title)}</h2>
      <p>${esc(order.reseller?.company || "")} · semaine ${esc(order.deliveryWeek || "—")} · révision ${order.revision || 1}</p></div>
      <button class="icon-btn" data-action="close-modal">×</button></div>
    <div class="modal-body">${correctionPanel}
      <div class="order-detail-grid">
        <div>
          <div class="plan-preview">${previewPieces(project)}</div>
          <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">${documents}</div>
          ${attachments}
          ${productionChecklist(order)}
        </div>
        <div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:13px">
            ${statusBadge(order.status)}<strong>${money(orderAmount(order))} HT</strong></div>
          <div class="comment-thread">${(order.comments || []).length
            ? order.comments.map((comment) => `<div class="comment"><time>${dateFr(comment.at)}</time><strong>${esc(comment.author)}</strong><p>${esc(comment.text)}</p></div>`).join("")
            : `<div class="empty" style="padding:20px"><p>Aucun commentaire.</p></div>`}</div>
          <label style="margin-top:12px">Commentaire / remarque<textarea id="order-comment" placeholder="Précisez la correction ou votre réponse…"></textarea></label>
          <label class="attachment-picker">Joindre un ou plusieurs fichiers
            <input id="order-attachments" type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.webp,.dxf,.txt">
            <small>PDF, image, DXF ou texte · 5 fichiers maximum · 5 Mo par fichier</small></label>
          <label style="margin-top:10px">Semaine proposée<input id="order-week" type="week" value="${esc(order.deliveryWeek || "")}"></label>
          <button class="btn btn-soft" style="margin-top:9px" data-action="send-comment" data-id="${order.id}">Envoyer le commentaire</button>
        </div>
      </div>
    </div>
    <div class="modal-actions" style="flex-wrap:wrap">
      <button class="btn btn-ghost" data-action="close-modal">Fermer</button>
      ${actionButtons.join("")}
    </div>`, true);
}

register({
  "open-order": (el) => openOrderModal(el.dataset.id),
  "close-modal": () => closeModal(),

  "edit-order-plan": (el) => {
    const order = state.data.orders.find((o) => o.id === el.dataset.id);
    if (!order) return;
    closeModal();
    openConfigurator(order.projectId, "design");
  },

  "send-comment": async (el) => {
    const text = document.querySelector("#order-comment")?.value || "";
    const input = document.querySelector("#order-attachments");
    const files = [...(input?.files || [])].slice(0, 5);
    const attachments = [];
    for (const file of files) {
      if (file.size > 5 * 1024 * 1024) { toast(`${file.name} dépasse 5 Mo.`, "error"); return; }
      attachments.push({ name: file.name, dataUrl: await fileToDataUrl(file) });
    }
    if (!text.trim() && !attachments.length) { toast("Écrivez un commentaire ou joignez un fichier.", "error"); return; }
    try {
      await request(`/api/orders/${el.dataset.id}/comment`, { body: { text, attachments } });
      await refresh();
      openOrderModal(el.dataset.id);
      toast("Commentaire envoyé.");
    } catch (error) { toast(error.message, "error"); }
  },

  "order-status": async (el) => {
    const comment = document.querySelector("#order-comment")?.value || "";
    const week = document.querySelector("#order-week")?.value || "";
    if (el.dataset.status === "changes_requested" && !comment.trim()) {
      toast("Précisez la correction attendue dans le commentaire.", "error");
      return;
    }
    try {
      await request(`/api/orders/${el.dataset.id}/status`, { body: { status: el.dataset.status, comment, week } });
      await refresh();
      openOrderModal(el.dataset.id);
      toast("Commande mise à jour.");
      window.dispatchEvent(new Event("marbexa:render"));
    } catch (error) { toast(error.message, "error"); }
  },

  "group-delivery": async () => {
    if (state.selectedOrderIds.length < 2) {
      toast("Cochez au moins deux commandes à livrer ensemble.", "error");
      return;
    }
    try {
      const result = await request("/api/orders/group-delivery", { body: { orderIds: state.selectedOrderIds } });
      await refresh();
      state.selectedOrderIds = [];
      toast(`Livraison regroupée sur ${result.count} commandes : forfait partagé.`);
      window.dispatchEvent(new Event("marbexa:render"));
    } catch (error) { toast(error.message, "error"); }
  },

  "archive-selection": async () => {
    if (!state.selectedOrderIds.length) { toast("Aucune commande sélectionnée.", "error"); return; }
    try {
      for (const id of state.selectedOrderIds) {
        await request(`/api/orders/${id}/archive`, { body: { archived: true } });
      }
      state.selectedOrderIds = [];
      await refresh();
      toast("Sélection archivée.");
      window.dispatchEvent(new Event("marbexa:render"));
    } catch (error) { toast(error.message, "error"); }
  },
});
