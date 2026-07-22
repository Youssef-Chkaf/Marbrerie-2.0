// Statistiques : indicateurs, C.A. mensuel, classement produits.

import { state } from "../state.js";
import { request } from "../api.js";
import { esc, money, kpi, toast } from "../ui.js";

export function renderStatistics() {
  const stats = state.statsData || state.data.stats;
  const maxMonth = Math.max(...stats.months.map((m) => m.totalHT), 1);
  return `
  <div class="page-head"><div><h2>Statistiques</h2><p>Analysez l'activité sur la période visible.</p></div>
    <div class="page-actions filters">
      <input type="date" data-stats-range="from" value="${esc(state.statsRange.from)}">
      <input type="date" data-stats-range="to" value="${esc(state.statsRange.to)}">
    </div></div>
  <div class="kpi-grid">
    ${kpi("C.A. total HT", money(stats.totalHT), "Période visible")}
    ${kpi("Commandes livrées", stats.delivered, "Expédiées incluses")}
    ${kpi("Commandes en cours", stats.inProgress, "Hors archives")}
    ${kpi("Prix moyen", money(stats.average), `${stats.orderCount} commande(s)`)}
  </div>
  <div class="dashboard-grid">
    <section class="card"><div class="card-head"><h3>C.A. mensuel</h3></div>
      <div class="bar-chart">${stats.months.map((m) => `
        <div class="bar-col"><div class="bar" style="height:${Math.max(3, Math.round(m.totalHT / maxMonth * 100))}%" title="${money(m.totalHT)}"></div><small>${esc(m.label)}</small></div>`).join("")}</div>
    </section>
    <aside class="card"><div class="card-head"><h3>Classement produits & coloris</h3></div>
      <div class="ranking">${stats.topMaterials.map((m) => `
        <div class="rank-row"><span>${esc(m.label)}</span><strong>${m.pct}%</strong>
        <div class="rank-track"><div style="width:${m.pct}%"></div></div></div>`).join("") || `<div class="empty" style="padding:16px"><p>Pas encore de données.</p></div>`}</div>
    </aside>
  </div>`;
}

export async function reloadStats() {
  try {
    const { from, to } = state.statsRange;
    const params = new URLSearchParams();
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    const result = await request(`/api/stats?${params}`);
    state.statsData = result.stats;
    window.dispatchEvent(new Event("marbexa:render"));
  } catch (error) { toast(error.message, "error"); }
}
