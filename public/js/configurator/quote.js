// Étape 3 · Chiffrage : détail ligne par ligne, lignes commerciales du
// revendeur, remise, livraison groupée et envoi de la commande à l'usine.

import { state, currentProject } from "../state.js";
import { request, refresh } from "../api.js";
import { esc, money, number, toast, weekLabel } from "../ui.js";
import { register } from "../actions.js";
import { computeQuote } from "/shared/pricing.js";
import { saveProject, closeConfigurator } from "./index.js";
import { makeId } from "/shared/plan.js";

// Recalcule localement pour un affichage immédiat (le serveur reste la référence).
function liveQuote(project) {
  return computeQuote(project, state.data.catalog, state.data.factory?.settings, {
    groupSize: project.quote?.deliveryGroupSize,
    groupDeliveryTotal: project.quote?.groupDeliveryTotal,
  });
}

export function renderQuoteStep(project) {
  const quote = project.quote || liveQuote(project);
  const isReseller = state.data.user.role === "reseller";
  const discount = project.commercialDiscount || { mode: "percent", value: 0 };
  const manufactured = (project.pieces || []).filter((p) => ["worktop", "splashback", "panel"].includes(p.kind));
  const order = state.data.orders.find((o) => o.projectId === project.id && o.status !== "cancelled");

  // Lignes groupées par pièce.
  const groups = new Map();
  for (const line of quote.lines || []) {
    const key = line.pieceId || "_global";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(line);
  }
  let lineRows = "";
  for (const [pieceId, lines] of groups) {
    const piece = manufactured.find((p) => p.id === pieceId);
    if (piece) {
      lineRows += `<tr><td colspan="7" style="background:#eef2ec;font-weight:600;text-align:right">Élément — ${esc(piece.name)}<br><small class="help">${esc(piece.kind === "worktop" ? "Plan de travail" : piece.kind === "splashback" ? "Crédence" : "Panneau")} · élément principal et ses découpes / finitions</small></td></tr>`;
    }
    const subtotal = lines.reduce((sum, l) => sum + l.factoryAmount, 0);
    lineRows += lines.map((line) => `<tr>
      <td>${esc(line.code)}</td>
      <td class="${line.category === "Matière" ? "table-title" : ""}">${esc(line.description)}</td>
      <td>${number(line.quantity, 3)} ${esc(line.unit)}</td>
      <td>${money(line.factoryUnitPrice)}</td>
      <td>${money(line.factoryAmount)}</td>
      <td>${isReseller ? money(line.customerUnitPrice) : "—"}</td>
      <td>${isReseller ? money(line.customerAmount) : "—"}</td>
    </tr>`).join("");
    if (piece) lineRows += `<tr><td colspan="4" style="text-align:right"><strong>Sous-total de ce groupe</strong><br><small class="help">Déjà inclus dans le total du devis — ce n'est pas un supplément.</small></td><td><strong>${money(subtotal)}</strong></td><td colspan="2">${isReseller ? `<strong>${money(lines.reduce((s, l) => s + l.customerAmount, 0))}</strong>` : ""}</td></tr>`;
  }

  const manualRows = (project.manualQuoteLines || []).map((line, index) => `<tr>
    <td>${esc(line.type === "installation" ? "Pose" : "Libre")}</td>
    <td><input data-manual-line="${index}" data-manual-field="label" value="${esc(line.label)}"></td>
    <td><input type="number" step="0.01" data-manual-line="${index}" data-manual-field="priceHT" value="${esc(line.priceHT)}" style="width:100px"></td>
    <td><input type="number" step="0.1" data-manual-line="${index}" data-manual-field="vatPct" value="${esc(line.vatPct ?? 20)}" style="width:70px"> %</td>
    <td>${money((Number(line.priceHT || 0)) * (1 + Number(line.vatPct ?? 20) / 100))}</td>
    <td><button class="icon-btn" data-action="remove-manual-line" data-index="${index}">×</button></td>
  </tr>`).join("");

  const otherOrders = state.data.orders.filter((o) => o.id !== order?.id
    && !o.archived && !["delivered", "cancelled", "shipped"].includes(o.status));
  const groupSelector = otherOrders.length ? `
    <div class="delivery-order-list" style="display:grid;gap:6px">
      ${otherOrders.map((o) => `<label style="display:flex;gap:8px;align-items:center">
        <input type="checkbox" data-group-order="${o.id}" ${(project.groupedOrderIds || []).includes(o.id) ? "checked" : ""}>
        <span>${esc(o.number)} · ${esc(o.project?.customer?.name || "")} · semaine ${esc(o.deliveryWeek || "—")}</span></label>`).join("")}
      <button class="btn btn-small btn-soft" data-action="apply-delivery-group">Appliquer le regroupement</button>
    </div>` : `<p class="help">Aucune autre commande en cours à regrouper.</p>`;

  return `<div class="workspace quote-page" style="padding:20px">
    <div class="page-head"><div><h2>Chiffrage du projet</h2>
      <p>${number(quote.totalAreaM2, 3)} m² · ${manufactured.length} élément(s) fabriqué(s)</p></div>
      ${order ? `<span class="badge status-factory_review">● Commande ${esc(order.number)} envoyée</span>` : ""}</div>
    <div class="quote-grid">
      <section class="stack">
        <div class="card"><div class="card-head"><h3>Client & dates du document</h3>
          <span class="help">Ces informations figurent sur le devis et le bon de commande</span></div>
          <div class="card-body form-grid">
            <label>Client<input data-customer-field="name" value="${esc(project.customer?.name || "")}"></label>
            <label>E-mail<input type="email" data-customer-field="email" value="${esc(project.customer?.email || "")}"></label>
            <label>Téléphone<input data-customer-field="phone" value="${esc(project.customer?.phone || "")}"></label>
            <label class="wide">Adresse<input data-customer-field="address" value="${esc(project.customer?.address || "")}"></label>
            <label>Date du devis<input type="date" data-project-field="quoteDate" value="${esc(project.quoteDate || "")}"></label>
            <label>Date limite de validité<input type="date" data-project-field="validityDate" value="${esc(project.validityDate || "")}"></label>
            <label>Date du bon de commande<input type="date" data-project-field="customerOrderDate" value="${esc(project.customerOrderDate || "")}"></label>
          </div></div>

        <div class="card"><div class="card-head"><h3>Détail ligne par ligne</h3>
          <span class="help">La marge est appliquée et arrondie sur chaque ligne</span></div>
          <div class="table-wrap"><table class="quote-lines commercial-lines">
            <thead><tr><th>Code</th><th>Désignation</th><th>Qté</th><th>P.U. usine</th><th>Total usine</th><th>P.U. client</th><th>Total client</th></tr></thead>
            <tbody>${lineRows || `<tr><td colspan="7"><div class="empty"><p>Dessinez au moins une pièce pour chiffrer.</p></div></td></tr>`}</tbody></table></div></div>

        ${isReseller ? `<div class="card"><div class="card-head"><div><h3>Lignes commerciales du revendeur</h3>
          <span class="help">Ces lignes, leur TVA et la remise restent privées entre vous et votre client.</span></div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn btn-small btn-soft" data-action="add-manual-line" data-type="installation">+ Ligne pose</button>
            <button class="btn btn-small btn-ghost" data-action="add-manual-line" data-type="custom">+ Ligne libre</button></div></div>
          <div class="table-wrap"><table class="manual-quote-lines">
            <thead><tr><th>Type</th><th>Désignation</th><th>Prix HT</th><th>TVA</th><th>Total TTC</th><th></th></tr></thead>
            <tbody>${manualRows || `<tr><td colspan="6"><div class="empty" style="padding:16px"><p>Aucune ligne manuelle ajoutée.</p></div></td></tr>`}</tbody></table></div>
          <div class="card-body"><div class="discount-editor">
            <div><strong>Remise client sur le TTC</strong><p class="help">Montant en euros ou pourcentage, calculé sur le sous-total TTC.</p></div>
            <label>Type<select data-discount-field="mode">
              <option value="percent" ${discount.mode !== "amount" ? "selected" : ""}>Pourcentage</option>
              <option value="amount" ${discount.mode === "amount" ? "selected" : ""}>Montant TTC</option></select></label>
            <label>Valeur<input type="number" min="0" step="0.01" data-discount-field="value" value="${esc(discount.value || 0)}"></label>
          </div></div></div>` : ""}

        <div class="card"><div class="card-head"><h3>Livraison & remarques</h3></div>
          <div class="card-body form-grid">
            <label>Semaine souhaitée<input type="week" data-project-field="deliveryWeek" min="${esc(state.data.system.minimumDeliveryWeek)}" value="${esc(project.deliveryWeek || "")}"></label>
            <label>Distance estimée (km)<input type="number" data-project-field="deliveryDistanceKm" value="${esc(project.deliveryDistanceKm)}"></label>
            <label class="wide">Remarques importantes<textarea data-project-field="notes">${esc(project.notes || "")}</textarea></label>
            <div class="wide delivery-group-box"><strong>Regrouper cette livraison</strong>
              <p>Le forfait groupé est partagé entre les commandes cochées et les devis recalculés ensemble.</p>
              ${groupSelector}
              <div class="group-summary">${Number(quote.deliveryGroupSize || 1) > 1
                ? `Livraison répartie entre ${quote.deliveryGroupSize} commandes · part de ce devis : ${money(quote.delivery)}`
                : "Livraison non groupée"}</div></div>
          </div></div>
        <div class="warning">Les cotes d'encastrement et la faisabilité restent soumises au contrôle technique de l'usine avant lancement en fabrication.</div>
        ${(state.lastIssues || []).length ? `<div class="warning"><strong>Points de contrôle du plan</strong><ul>${state.lastIssues.map((issue) => `<li>${esc(issue)}</li>`).join("")}</ul></div>` : ""}
      </section>

      <aside><div class="summary-card">
        <h3>Résumé commercial</h3>
        <div class="summary-line"><span>Prix d'achat usine HT</span><strong>${money(quote.purchaseHT)}</strong></div>
        ${isReseller ? `
        <div class="form-grid" style="margin:14px 0">
          <label>Marge revendeur (%)<input type="number" min="0" step="0.1" data-live-commercial="marginPct" value="${esc(project.marginPct)}"></label>
          <label>TVA des lignes pierre (%)<input type="number" min="0" step="0.1" data-live-commercial="vatPct" value="${esc(project.vatPct)}"></label>
        </div>
        <div class="summary-line"><span>Prix de vente HT</span><strong>${money(quote.customerHT)}</strong></div>
        <div class="summary-line"><span>TVA totale</span><strong>${money(quote.vatAmount)}</strong></div>
        <div class="summary-line"><span>Sous-total TTC</span><strong>${money(quote.customerSubtotalTTC)}</strong></div>
        <div class="summary-line discount-summary"><span>Remise TTC</span><strong>− ${money(quote.discountTTC || 0)}</strong></div>
        <div class="summary-total"><span>Total TTC</span><strong>${money(quote.customerTTC)}</strong></div>
        <div class="automatic-price-note">Les montants s'actualisent immédiatement et sont enregistrés automatiquement.</div>` : `
        <div class="summary-total"><span>Total achat usine HT</span><strong>${money(quote.purchaseHT)}</strong></div>`}
        <div style="display:grid;gap:8px;margin-top:18px">
          ${isReseller ? `
          <a class="btn btn-ghost" style="color:white;border-color:rgba(255,255,255,.25)" href="/print/${project.id}?type=quote" target="_blank">Imprimer le devis client</a>
          <a class="btn btn-ghost" style="color:white;border-color:rgba(255,255,255,.25)" href="/print/${project.id}?type=customer-order" target="_blank">Imprimer le bon de commande</a>` : ""}
          <a class="btn btn-ghost" style="color:white;border-color:rgba(255,255,255,.25)" href="/print/${project.id}?type=factory-order" target="_blank">Bon de commande usine</a>
          <a class="btn btn-ghost" style="color:white;border-color:rgba(255,255,255,.25)" href="/print/${project.id}?type=technical" target="_blank">Fiche technique</a>
          ${isReseller && !order ? `<button class="btn btn-dark" style="background:white;color:#20231f" data-action="submit-order">Envoyer la commande à l'usine</button>` : ""}
          ${order ? `<button class="btn btn-dark" style="background:white;color:#20231f" data-action="open-order" data-id="${order.id}">Suivre la commande ${esc(order.number)}</button>` : ""}
        </div>
      </div></aside>
    </div>
  </div>`;
}

export function handleQuoteField(input) {
  const project = currentProject();
  if (!project) return false;

  if (input.dataset.customerField !== undefined) {
    project.customer = project.customer || {};
    project.customer[input.dataset.customerField] = input.value;
    saveProject();
    return true;
  }
  if (input.dataset.projectField !== undefined) {
    const field = input.dataset.projectField;
    project[field] = field === "deliveryDistanceKm" ? Number(input.value) : input.value;
    saveProject(false, { rerender: field === "deliveryDistanceKm" });
    return true;
  }
  if (input.dataset.liveCommercial !== undefined) {
    project[input.dataset.liveCommercial] = Number(input.value);
    saveProject(false, { rerender: true });
    return true;
  }
  if (input.dataset.discountField !== undefined) {
    project.commercialDiscount = project.commercialDiscount || { mode: "percent", value: 0 };
    project.commercialDiscount[input.dataset.discountField] =
      input.dataset.discountField === "value" ? Number(input.value) : input.value;
    saveProject(false, { rerender: true });
    return true;
  }
  if (input.dataset.manualLine !== undefined) {
    const line = project.manualQuoteLines?.[Number(input.dataset.manualLine)];
    if (line) {
      const field = input.dataset.manualField;
      line[field] = ["priceHT", "vatPct"].includes(field) ? Number(input.value) : input.value;
      saveProject(false, { rerender: field !== "label" });
    }
    return true;
  }
  return false;
}

register({
  "add-manual-line": (el) => {
    const project = currentProject();
    project.manualQuoteLines = project.manualQuoteLines || [];
    project.manualQuoteLines.push({
      id: makeId("line"),
      type: el.dataset.type,
      label: el.dataset.type === "installation" ? "Pose et installation sur chantier" : "",
      quantity: 1,
      priceHT: el.dataset.type === "installation" ? 350 : 0,
      vatPct: 20,
    });
    saveProject(false, { rerender: true });
  },
  "remove-manual-line": (el) => {
    const project = currentProject();
    project.manualQuoteLines.splice(Number(el.dataset.index), 1);
    saveProject(false, { rerender: true });
  },
  "apply-delivery-group": async () => {
    const project = currentProject();
    const checked = [...document.querySelectorAll("[data-group-order]:checked")].map((i) => i.dataset.groupOrder);
    project.groupedOrderIds = checked;
    project.consolidatedDelivery = checked.length > 0;
    const order = state.data.orders.find((o) => o.projectId === project.id && o.status !== "cancelled");
    try {
      if (checked.length && order) {
        await request("/api/orders/group-delivery", { body: { orderIds: [order.id, ...checked] } });
        await refresh();
        toast("Livraison regroupée : forfait partagé entre les commandes.");
      } else {
        await saveProject(true);
        toast(checked.length ? "Regroupement enregistré : il s'appliquera à l'envoi de la commande." : "Regroupement retiré.");
      }
      window.dispatchEvent(new Event("marbexa:render"));
    } catch (error) { toast(error.message, "error"); }
  },
  "submit-order": async () => {
    const project = currentProject();
    if (!project.customer?.name) { toast("Renseignez le nom du client avant l'envoi.", "error"); return; }
    if (!(project.pieces || []).some((p) => ["worktop", "splashback", "panel"].includes(p.kind))) {
      toast("Dessinez au moins une pièce à fabriquer.", "error"); return;
    }
    if (!confirm(`Envoyer la commande à l'usine pour la semaine ${weekLabel(project.deliveryWeek)} ?\nLe plan sera verrouillé jusqu'au contrôle usine.`)) return;
    try {
      await saveProject(true);
      const result = await request(`/api/projects/${project.id}/submit`, { body: {} });
      await refresh();
      toast(`Commande ${result.order.number} envoyée à l'usine.`);
      if (result.issues?.length) toast(`À contrôler : ${result.issues[0]}`, "error");
      closeConfigurator();
    } catch (error) { toast(error.message, "error"); }
  },
});
