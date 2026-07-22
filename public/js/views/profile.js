// Profil revendeur : identité, documents commerciaux, logo, mot de passe.

import { state } from "../state.js";
import { request, refresh, fileToDataUrl } from "../api.js";
import { esc, toast } from "../ui.js";
import { register } from "../actions.js";

export function renderProfile() {
  const reseller = state.data.reseller;
  if (!reseller) return `<div class="empty"><p>Profil réservé aux revendeurs.</p></div>`;
  return `
  <div class="page-head"><div><h2>Profil revendeur</h2>
    <p>Ces informations figurent sur vos devis et bons de commande.</p></div>
    <div class="page-actions"><button class="btn btn-primary" data-action="save-profile">Enregistrer</button></div></div>
  <div class="profile-layout dashboard-grid">
    <section class="card"><div class="card-head"><h3>Identité du revendeur</h3></div>
      <div class="card-body form-grid" id="profile-form">
        <div class="logo-editor wide">
          ${reseller.logoDataUrl ? `<img src="${esc(reseller.logoDataUrl)}" alt="logo" style="max-height:64px">` : `<div class="logo-placeholder">Votre logo</div>`}
          <label>Logo PNG, JPEG ou WebP<input type="file" id="profile-logo" accept="image/png,image/jpeg,image/webp"><small>Taille maximale : 800 Ko.</small></label>
        </div>
        <label>Société<input name="company" value="${esc(reseller.company)}"></label>
        <label>Raison sociale<input name="legalName" value="${esc(reseller.legalName || "")}"></label>
        <label>Forme juridique<input name="legalForm" value="${esc(reseller.legalForm || "")}" placeholder="SARL, SAS…"></label>
        <label>Capital social<input name="capital" value="${esc(reseller.capital || "")}" placeholder="10 000 €"></label>
        <label>SIRET<input name="siret" value="${esc(reseller.siret || "")}"></label>
        <label>N° TVA intracommunautaire<input name="vatNumber" value="${esc(reseller.vatNumber || "")}"></label>
        <label>RCS / RM<input name="rcs" value="${esc(reseller.rcs || "")}" placeholder="RCS Bergerac 000 000 000"></label>
        <label>Site internet<input name="website" value="${esc(reseller.website || "")}"></label>
        <label>E-mail<input name="email" value="${esc(reseller.email)}"></label>
        <label>Téléphone<input name="phone" value="${esc(reseller.phone || "")}"></label>
        <label class="wide">Adresse de facturation<input name="billingAddress" value="${esc(reseller.billingAddress || "")}"></label>
        <label class="wide">Adresse de livraison<input name="deliveryAddress" value="${esc(reseller.deliveryAddress || "")}"></label>
        <label>Marge par défaut (%)<input type="number" step="0.1" name="defaultMarginPct" value="${esc(reseller.defaultMarginPct)}"></label>
        <label>TVA par défaut (%)<input type="number" step="0.1" name="defaultVatPct" value="${esc(reseller.defaultVatPct)}"></label>
        <label>Nouveau mot de passe<input type="password" name="newPassword" autocomplete="new-password" placeholder="Laisser vide pour conserver"></label>
      </div>
    </section>
    <aside class="card"><div class="card-head"><h3>Documents commerciaux</h3></div>
      <div class="card-body stack" id="profile-docs">
        <label>Validité par défaut des devis (jours)<input type="number" min="1" name="quoteValidityDays" value="${esc(reseller.quoteValidityDays || 30)}"></label>
        <label>Conditions de règlement<textarea name="paymentTerms" rows="3">${esc(reseller.paymentTerms || "")}</textarea></label>
        <label>Pénalités de retard<textarea name="latePenalties" rows="3">${esc(reseller.latePenalties || "")}</textarea></label>
        <label>Conditions générales de vente<textarea name="salesTerms" rows="6" placeholder="Collez ici vos conditions générales de vente…">${esc(reseller.salesTerms || "")}</textarea></label>
      </div>
    </aside>
  </div>`;
}

register({
  "save-profile": async () => {
    const reseller = state.data.reseller;
    const body = {};
    document.querySelectorAll("#profile-form [name], #profile-docs [name]").forEach((input) => {
      if (input.name === "newPassword") { if (input.value) body.newPassword = input.value; return; }
      body[input.name] = input.type === "number" ? Number(input.value) : input.value;
    });
    const logoFile = document.querySelector("#profile-logo")?.files?.[0];
    if (logoFile) {
      if (logoFile.size > 800 * 1024) { toast("Logo trop lourd (800 Ko max).", "error"); return; }
      body.logoDataUrl = await fileToDataUrl(logoFile);
    }
    try {
      await request(`/api/resellers/${reseller.id}`, { method: "PATCH", body });
      await refresh();
      toast("Profil enregistré.");
      window.dispatchEvent(new Event("marbexa:render"));
    } catch (error) { toast(error.message, "error"); }
  },
});
