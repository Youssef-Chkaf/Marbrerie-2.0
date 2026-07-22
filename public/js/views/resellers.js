// Gestion des revendeurs (côté usine).

import { state } from "../state.js";
import { request, refresh } from "../api.js";
import { esc, toast, showModal, closeModal } from "../ui.js";
import { register } from "../actions.js";

export function renderResellers() {
  const resellers = state.data.resellers || [];
  return `
  <div class="page-head"><div><h2>Revendeurs</h2>
    <p>Comptes clients autorisés à créer des devis et des commandes.</p></div>
    <div class="page-actions"><button class="btn btn-primary" data-action="new-reseller">+ Nouveau revendeur</button></div></div>
  <section class="card"><div class="table-wrap"><table>
    <thead><tr><th>Société</th><th>Contact</th><th>Adresse de livraison</th><th>Distance</th><th>État</th><th></th></tr></thead>
    <tbody>${resellers.map((r) => `<tr>
      <td><div class="table-title">${esc(r.company)}</div><div class="table-sub">${esc(r.siret || "")}</div></td>
      <td>${esc(r.salespersonName || r.managerName || "")}<div class="table-sub">${esc(r.email)}</div></td>
      <td>${esc(r.deliveryAddress || "—")}</td>
      <td>${esc(r.distanceKm)} km</td>
      <td><span class="badge ${r.active ? "status-approved" : "status-cancelled"}">● ${r.active ? "Actif" : "Suspendu"}</span></td>
      <td><button class="btn btn-small btn-ghost" data-action="toggle-reseller" data-id="${r.id}">${r.active ? "Suspendre" : "Réactiver"}</button></td>
    </tr>`).join("") || `<tr><td colspan="6"><div class="empty"><p>Aucun revendeur.</p></div></td></tr>`}</tbody>
  </table></div></section>`;
}

function newResellerModal() {
  showModal(`<form id="reseller-form">
    <div class="modal-head"><div><h2>Nouveau revendeur</h2><p>Créez un accès client rattaché à votre usine.</p></div>
      <button type="button" class="icon-btn" data-action="close-modal">×</button></div>
    <div class="modal-body"><div class="form-grid">
      <label>Société<input name="company" required></label>
      <label>SIRET<input name="siret"></label>
      <label>Gérant<input name="managerName"></label>
      <label>Vendeur référent<input name="salespersonName"></label>
      <label>E-mail de connexion<input name="email" type="email" required></label>
      <label>Téléphone<input name="phone"></label>
      <label class="wide">Adresse de livraison<input name="deliveryAddress"></label>
      <label>Distance usine (km)<input name="distanceKm" type="number" min="0" value="50"></label>
    </div></div>
    <div class="modal-actions"><button type="button" class="btn btn-ghost" data-action="close-modal">Annuler</button>
      <button class="btn btn-primary">Créer le revendeur</button></div></form>`);
}

export async function handleResellerForm(form) {
  if (form.id !== "reseller-form") return false;
  const data = Object.fromEntries(new FormData(form).entries());
  try {
    const result = await request("/api/resellers", { body: data });
    await refresh();
    showModal(`
      <div class="modal-head"><div><h2>Compte créé</h2><p>${esc(result.reseller.company)}</p></div>
        <button class="icon-btn" data-action="close-modal">×</button></div>
      <div class="modal-body"><div class="credential-box">
        <p>Identifiants à transmettre au revendeur :</p>
        <p><strong>E-mail :</strong> ${esc(result.reseller.email)}<br>
        <strong>Mot de passe provisoire :</strong> <code>${esc(result.temporaryPassword)}</code></p>
        <p class="help">Le revendeur pourra le changer dans « Mon profil ».</p>
      </div></div>
      <div class="modal-actions"><button class="btn btn-primary" data-action="close-modal">Terminé</button></div>`);
    window.dispatchEvent(new Event("marbexa:render"));
  } catch (error) { toast(error.message, "error"); }
  return true;
}

register({
  "new-reseller": () => newResellerModal(),
  "toggle-reseller": async (el) => {
    const reseller = state.data.resellers.find((r) => r.id === el.dataset.id);
    try {
      await request(`/api/resellers/${el.dataset.id}`, { method: "PATCH", body: { active: !reseller.active } });
      await refresh();
      window.dispatchEvent(new Event("marbexa:render"));
    } catch (error) { toast(error.message, "error"); }
  },
});
