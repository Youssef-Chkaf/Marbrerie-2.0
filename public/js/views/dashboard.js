// Tableaux de bord usine et revendeur.

import { state } from "../state.js";
import { esc, money, number, dateFr, kpi, statusBadge, materialLabel } from "../ui.js";
import { ordersTable } from "./orders.js";

function recentActivity() {
  const items = (state.data.notifications || []).slice(0, 6);
  if (!items.length) return `<div class="empty" style="padding:18px"><p>Aucune activité récente.</p></div>`;
  return `<div class="activity">${items.map((item) => `
    <div class="activity-item"><span class="activity-dot"></span>
      <div><strong>${esc(item.title)}</strong><p>${esc(item.body)} · ${dateFr(item.createdAt)}</p></div>
    </div>`).join("")}</div>`;
}

export function renderFactoryDashboard() {
  const { stats, user, orders } = state.data;
  const active = orders.filter((o) => !o.archived && !["cancelled", "delivered"].includes(o.status));
  const toReview = orders.filter((o) => o.status === "factory_review").length;
  const inProduction = orders.filter((o) => o.status === "in_production").length;
  return `
  <div class="page-head"><div><h2>Bonjour, ${esc(user.name.split(" ")[0])}</h2>
    <p>Voici les commandes qui demandent votre attention aujourd'hui.</p></div>
    <div class="page-actions">
      <button class="btn btn-dark" data-view="catalog">Mettre à jour les tarifs</button>
      <button class="btn btn-primary" data-action="new-reseller">+ Nouveau revendeur</button>
    </div></div>
  <div class="kpi-grid">
    ${kpi("C.A. total HT", money(stats.totalHT), "Commandes visibles")}
    ${kpi("À contrôler", toReview, "Validation requise")}
    ${kpi("En fabrication", inProduction, "Atelier")}
    ${kpi("Panier moyen", money(stats.average), `${stats.delivered} expédiée(s)`)}
  </div>
  <div class="dashboard-grid">
    <section class="card">
      <div class="card-head"><h3>Commandes en cours</h3><button class="link-btn" data-view="orders">Toutes les commandes</button></div>
      ${ordersTable(active.slice(0, 6), { compact: true })}
    </section>
    <aside class="card"><div class="card-head"><h3>Activité récente</h3></div>${recentActivity()}</aside>
  </div>`;
}

export function renderResellerDashboard() {
  const { user, projects, orders } = state.data;
  const activeProjects = projects.filter((p) => !p.archived);
  const inFactory = orders.filter((o) => !o.archived && !["delivered", "cancelled"].includes(o.status));
  const toValidate = orders.filter((o) => o.status === "factory_proposal").length;
  const delivered = orders.filter((o) => o.status === "delivered").length;
  const recent = [...activeProjects].sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || "")).slice(0, 6);
  return `
  <div class="page-head"><div><h2>Bonjour, ${esc(user.name.split(" ")[0])}</h2>
    <p>Créez un projet coté, calculez votre prix et suivez sa validation usine.</p></div>
    <div class="page-actions"><button class="btn btn-primary" data-action="new-project-choice">+ Nouveau devis</button></div></div>
  <div class="kpi-grid">
    ${kpi("Projets actifs", activeProjects.length, "Devis et commandes")}
    ${kpi("Commandes en cours", inFactory.length, "Chez l'usine")}
    ${kpi("À valider", toValidate, "Propositions usine")}
    ${kpi("Livrées", delivered, "Historique récent")}
  </div>
  <div class="dashboard-grid">
    <section class="card">
      <div class="card-head"><h3>Devis et projets récents</h3><button class="link-btn" data-view="projects">Voir tous</button></div>
      <div class="table-wrap"><table>
        <thead><tr><th>Projet</th><th>Client</th><th>Matériau</th><th>Vente HT</th><th>Vente TTC</th><th>État</th><th>Mis à jour</th><th></th></tr></thead>
        <tbody>${recent.map((p) => {
          const order = orders.find((o) => o.projectId === p.id && o.status !== "cancelled");
          return `<tr>
          <td><div class="table-title">${esc(p.title)}</div><div class="table-sub">${esc(p.reference)}</div></td>
          <td>${esc(p.customer?.name || "—")}</td>
          <td>${esc(materialLabel(p.materialId))}</td>
          <td>${money(p.quote?.customerHT)}</td><td>${money(p.quote?.customerTTC)}</td>
          <td>${statusBadge(order ? order.status : p.status === "draft" ? "quote" : p.status)}</td>
          <td>${dateFr(p.updatedAt)}</td>
          <td>${order ? `<button class="btn btn-small btn-ghost" data-action="open-order" data-id="${order.id}">Commande</button>` : `<button class="btn btn-small" data-action="open-project" data-id="${p.id}">Ouvrir</button>`}</td>
        </tr>`;
        }).join("") || `<tr><td colspan="8"><div class="empty"><p>Créez votre premier devis.</p></div></td></tr>`}</tbody>
      </table></div>
    </section>
    <aside class="card"><div class="card-head"><h3>Notifications</h3></div>${recentActivity()}</aside>
  </div>`;
}
