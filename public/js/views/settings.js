// Réglages usine : délais, majoration, tranches de livraison, alertes, SMTP.

import { state } from "../state.js";
import { request, refresh } from "../api.js";
import { esc, toast } from "../ui.js";
import { register } from "../actions.js";

export function renderFactorySettings() {
  const factory = state.data.factory;
  const settings = factory.settings;
  return `
  <div class="page-head"><div><h2>Réglages usine</h2>
    <p>Délais, livraison et notifications de ${esc(factory.name)}.</p></div>
    <div class="page-actions"><button class="btn btn-primary" data-action="save-settings">Enregistrer</button></div></div>
  <div class="dashboard-grid">
    <section class="stack">
      <div class="card"><div class="card-head"><h3>Délais & transport</h3></div>
        <div class="card-body form-grid" id="settings-form">
          <label>Délai minimum avant livraison (semaines)<input type="number" min="0" name="minLeadWeeks" value="${esc(settings.minLeadWeeks)}"></label>
          <label>Majoration finition Suede / spéciale (%)<input type="number" min="0" step="0.5" name="finishSurchargePct" value="${esc(settings.finishSurchargePct)}"></label>
          <label>Utilisation matière cible (%)<input type="number" min="0" max="100" name="wasteUseTargetPct" value="${esc(settings.wasteUseTargetPct)}"></label>
        </div>
        <div class="card-body">
          <h3 style="margin-bottom:8px">Tranches de livraison</h3>
          <div class="tier-grid" id="delivery-tiers">
            ${settings.deliveryTiers.map((tier, index) => `
              <div class="tier-row form-grid">
                <label>Jusqu'à (km)<input type="number" min="1" data-tier="${index}" data-tier-field="maxKm" value="${esc(tier.maxKm)}"></label>
                <label>Forfait HT (€)<input type="number" min="0" data-tier="${index}" data-tier-field="price" value="${esc(tier.price)}"></label>
              </div>`).join("")}
          </div>
          <button class="btn btn-small btn-ghost" data-action="add-delivery-tier">+ Ajouter une tranche</button>
        </div>
      </div>
      <div class="card"><div class="card-head"><h3>Identité de l'usine</h3></div>
        <div class="card-body form-grid" id="factory-identity">
          <label>Nom commercial<input name="name" value="${esc(factory.name)}"></label>
          <label>Ville<input name="city" value="${esc(factory.city)}"></label>
          <label>Raison sociale<input name="legalName" value="${esc(factory.legalName)}"></label>
          <label>SIRET<input name="siret" value="${esc(factory.siret)}"></label>
          <label>Responsable<input name="managerName" value="${esc(factory.managerName)}"></label>
          <label>Téléphone<input name="phone" value="${esc(factory.phone)}"></label>
          <label class="wide">Adresse<input name="address" value="${esc(factory.address)}"></label>
        </div>
      </div>
    </section>
    <aside class="stack">
      <div class="card"><div class="card-head"><h3>Alertes</h3></div>
        <div class="card-body stack" id="alerts-form">
          <label style="display:flex;gap:8px;align-items:center"><input type="checkbox" name="notifInApp" ${settings.notifications.inApp ? "checked" : ""}> Notifications dans Marbexa</label>
          <label style="display:flex;gap:8px;align-items:center"><input type="checkbox" name="notifEmail" ${settings.notifications.email ? "checked" : ""}> Alertes e-mail</label>
          <label>Relance sans réponse après (heures)<input type="number" min="1" name="reminderHours" value="${esc(settings.notifications.reminderHours)}"></label>
          <div class="warning">Les alertes internes sont actives. L'envoi e-mail s'active après saisie d'un serveur SMTP.</div>
        </div>
      </div>
      <div class="card"><div class="card-head"><h3>Serveur e-mail</h3></div>
        <div class="card-body form-grid" id="smtp-form">
          <label class="wide">Hôte SMTP<input name="smtpHost" value="${esc(settings.smtp.host)}" placeholder="smtp.votre-domaine.fr"></label>
          <label>Port<input type="number" name="smtpPort" value="${esc(settings.smtp.port)}"></label>
          <label>Utilisateur<input name="smtpUser" value="${esc(settings.smtp.user)}"></label>
        </div>
      </div>
      <div class="card"><div class="card-head"><h3>Mot de passe de connexion</h3></div>
        <div class="card-body form-grid" id="password-form">
          <label class="wide">Mot de passe actuel<input type="password" name="currentPassword" autocomplete="current-password"></label>
          <label class="wide">Nouveau mot de passe<input type="password" name="newPassword" autocomplete="new-password" placeholder="8 caractères minimum"></label>
          <label class="wide">Confirmer le nouveau mot de passe<input type="password" name="newPasswordConfirm" autocomplete="new-password"></label>
          <button class="btn btn-soft wide" data-action="change-factory-password">Changer le mot de passe</button>
        </div>
      </div>
    </aside>
  </div>`;
}

register({
  "add-delivery-tier": () => {
    state.data.factory.settings.deliveryTiers.push({ maxKm: 800, price: 490 });
    window.dispatchEvent(new Event("marbexa:render"));
  },

  "change-factory-password": async () => {
    const read = (name) => document.querySelector(`#password-form [name=${name}]`)?.value || "";
    const current = read("currentPassword");
    const next = read("newPassword");
    if (next.length < 8) { toast("Le nouveau mot de passe doit faire 8 caractères minimum.", "error"); return; }
    if (next !== read("newPasswordConfirm")) { toast("La confirmation ne correspond pas.", "error"); return; }
    try {
      await request("/api/settings", { method: "PATCH", body: { currentPassword: current, newPassword: next } });
      toast("Mot de passe mis à jour.");
      window.dispatchEvent(new Event("marbexa:render"));
    } catch (error) { toast(error.message, "error"); }
  },

  "save-settings": async () => {
    const read = (selector, name) => document.querySelector(`${selector} [name=${name}]`)?.value;
    const tiers = [];
    document.querySelectorAll("#delivery-tiers [data-tier][data-tier-field=maxKm]").forEach((input) => {
      const index = input.dataset.tier;
      const price = document.querySelector(`#delivery-tiers [data-tier="${index}"][data-tier-field=price]`);
      if (Number(input.value) > 0) tiers.push({ maxKm: Number(input.value), price: Number(price?.value || 0) });
    });
    const body = {
      name: read("#factory-identity", "name"),
      city: read("#factory-identity", "city"),
      legalName: read("#factory-identity", "legalName"),
      siret: read("#factory-identity", "siret"),
      managerName: read("#factory-identity", "managerName"),
      phone: read("#factory-identity", "phone"),
      address: read("#factory-identity", "address"),
      settings: {
        minLeadWeeks: Number(read("#settings-form", "minLeadWeeks")),
        finishSurchargePct: Number(read("#settings-form", "finishSurchargePct")),
        wasteUseTargetPct: Number(read("#settings-form", "wasteUseTargetPct")),
        deliveryTiers: tiers.sort((a, b) => a.maxKm - b.maxKm),
        notifications: {
          inApp: document.querySelector("#alerts-form [name=notifInApp]")?.checked ?? true,
          email: document.querySelector("#alerts-form [name=notifEmail]")?.checked ?? false,
          reminderHours: Number(read("#alerts-form", "reminderHours") || 24),
        },
        smtp: {
          host: read("#smtp-form", "smtpHost") || "",
          port: Number(read("#smtp-form", "smtpPort") || 587),
          user: read("#smtp-form", "smtpUser") || "",
          configured: Boolean(read("#smtp-form", "smtpHost")),
        },
      },
    };
    try {
      await request("/api/settings", { method: "PATCH", body });
      await refresh();
      toast("Réglages enregistrés.");
      window.dispatchEvent(new Event("marbexa:render"));
    } catch (error) { toast(error.message, "error"); }
  },
});
