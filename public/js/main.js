// Point d'entrée du client Marbexa : rendu du shell, routage des vues et
// délégation globale des événements.

import { state } from "./state.js";
import { request, refresh, setToken } from "./api.js";
import { esc, toast, initials, closeModal, showModal, dateFr } from "./ui.js";
import { actions } from "./actions.js";

import { renderLogin } from "./views/login.js";
import { renderFactoryDashboard, renderResellerDashboard } from "./views/dashboard.js";
import { renderOrdersPage } from "./views/orders.js";
import { renderProjects, handleProjectForms, handleMaterialCascade } from "./views/projects.js";
import { renderCatalog, saveCatalogPrice, toggleCatalogItem } from "./views/catalog.js";
import { renderResellers, handleResellerForm } from "./views/resellers.js";
import { renderStatistics, reloadStats } from "./views/stats.js";
import { renderFactorySettings } from "./views/settings.js";
import { renderProfile } from "./views/profile.js";
import { renderConfigurator } from "./configurator/index.js";
import { bindCanvas, handleStripField } from "./configurator/canvas.js";
import { bindDetailCanvas, handleApplianceSearchInput } from "./configurator/details.js";
import { bindCredence, handleWallHeight } from "./configurator/credence.js";
import { handlePieceField } from "./configurator/inspector.js";
import { handleDetailField, handleDetailClick } from "./configurator/details.js";
import { handleQuoteField } from "./configurator/quote.js";
import { handleMaterialChange } from "./configurator/material.js";

const root = document.querySelector("#app");

// ---------- Navigation ----------

function navItems() {
  const role = state.data.user.role;
  return role === "factory" ? [
    ["dashboard", "▦", "Tableau de bord"],
    ["orders", "▤", "Commandes"],
    ["resellers", "◇", "Revendeurs"],
    ["catalog", "▦", "Tarifs & produits"],
    ["stats", "▥", "Statistiques"],
    ["settings", "⚙", "Réglages"],
  ] : [
    ["dashboard", "▦", "Tableau de bord"],
    ["projects", "◇", "Devis & projets"],
    ["orders", "▤", "Mes commandes"],
    ["profile", "◇", "Mon profil"],
  ];
}

function pageTitle() {
  const titles = {
    dashboard: "Tableau de bord", orders: "Commandes", projects: "Devis & projets",
    resellers: "Revendeurs", catalog: "Tarifs & catalogue", stats: "Statistiques",
    settings: "Réglages usine", profile: "Profil revendeur", configurator: "Configurateur",
  };
  return titles[state.view] || "Marbexa";
}

function renderView() {
  const role = state.data.user.role;
  switch (state.view) {
    case "dashboard": return role === "factory" ? renderFactoryDashboard() : renderResellerDashboard();
    case "orders": return renderOrdersPage();
    case "projects": return renderProjects();
    case "resellers": return renderResellers();
    case "catalog": return renderCatalog();
    case "stats": return renderStatistics();
    case "settings": return renderFactorySettings();
    case "profile": return renderProfile();
    case "configurator": return renderConfigurator();
    default: return renderFactoryDashboard();
  }
}

function shell() {
  const { user, factory, notifications } = state.data;
  const unread = (notifications || []).filter((n) => !n.read).length;
  const today = new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
  return `
  <div class="app-shell">
    <aside class="sidebar">
      <div class="brand"><span class="logo-mark">M</span><strong>Marbexa</strong></div>
      <div class="tenant-chip"><strong>${esc(factory?.name || "")}</strong><small>${user.role === "factory" ? "USINE / MARBRIER" : "REVENDEUR"}</small></div>
      <nav class="nav">
        ${navItems().map(([view, symbol, label]) => `
          <button class="${state.view === view ? "active" : ""}" data-view="${view}">
            <span class="nav-symbol">${symbol}</span>${esc(label)}</button>`).join("")}
      </nav>
      <div class="sidebar-bottom">
        <div class="user-mini"><span class="avatar">${esc(initials(user.name))}</span>
          <div><strong>${esc(user.name)}</strong><small>${esc(user.email)}</small></div></div>
        <button class="logout" data-action="logout">Se déconnecter</button>
      </div>
    </aside>
    <main class="main">
      <div class="topbar"><div style="display:grid"><strong>${esc(pageTitle())}</strong><small>${esc(today)}</small></div>
        <div class="top-actions">
          <button class="icon-btn" data-action="show-notifications" title="Notifications">◇${unread ? `<span class="notification-dot"></span>` : ""}</button>
          <span class="avatar">${esc(initials(user.name))}</span>
        </div></div>
      <div class="workspace">${renderView()}</div>
    </main>
  </div>`;
}

export function render() {
  if (!state.data) {
    root.innerHTML = renderLogin();
    return;
  }
  // Conserve le défilement (fenêtre + conteneurs internes) entre deux rendus,
  // sinon chaque modification renvoie l'utilisateur en haut de page.
  const keepScroll = [".detail-canvas", ".inspector", ".cut-library", ".modal-body", ".quote-layout"];
  const saved = keepScroll
    .map((selector) => {
      const el = root.querySelector(selector);
      return el ? [selector, el.scrollLeft, el.scrollTop] : null;
    })
    .filter(Boolean);
  const winX = window.scrollX;
  const winY = window.scrollY;
  root.innerHTML = shell();
  if (state.view === "configurator") {
    bindCanvas(root);
    bindCredence(root);
    bindDetailCanvas(root);
  }
  for (const [selector, left, top] of saved) {
    const el = root.querySelector(selector);
    if (el) { el.scrollLeft = left; el.scrollTop = top; }
  }
  window.scrollTo(winX, winY);
}

window.addEventListener("marbexa:render", render);

// ---------- Délégation d'événements ----------

document.addEventListener("click", (event) => {
  const viewButton = event.target.closest("[data-view]");
  if (viewButton) {
    state.view = viewButton.dataset.view;
    state.configurator = state.view === "configurator" ? state.configurator : null;
    render();
    return;
  }
  const tabButton = event.target.closest("[data-catalog-tab]");
  if (tabButton) { state.catalogTab = tabButton.dataset.catalogTab; render(); return; }

  const toggleButton = event.target.closest("[data-catalog-toggle]");
  if (toggleButton) { toggleCatalogItem(toggleButton); return; }

  if (handleDetailClick(event.target)) return;

  const actionEl = event.target.closest("[data-action]");
  if (actionEl && actions[actionEl.dataset.action]) {
    actions[actionEl.dataset.action](actionEl, event);
  }
});

document.addEventListener("submit", async (event) => {
  const form = event.target;
  event.preventDefault();

  if (form.id === "login-form") {
    const data = Object.fromEntries(new FormData(form).entries());
    try {
      const result = await request("/api/login", { body: data });
      setToken(result.token);
      state.loginError = "";
      const { token, ...bootstrap } = result;
      state.data = bootstrap;
      state.view = "dashboard";
      render();
    } catch (error) {
      state.loginError = error.message;
      render();
    }
    return;
  }
  try {
    if (await handleProjectForms(form)) return;
    if (await handleResellerForm(form)) return;
  } catch (error) {
    toast(error.message, "error");
  }
});

document.addEventListener("change", (event) => {
  const el = event.target;

  if (el.dataset.filter !== undefined) { state.filters[el.dataset.filter] = el.value; render(); return; }
  if (el.dataset.statsRange !== undefined) { state.statsRange[el.dataset.statsRange] = el.value; reloadStats(); return; }
  if (el.dataset.catalogPrice !== undefined || el.dataset.catalogVariant !== undefined) { saveCatalogPrice(el); return; }
  if (handleMaterialCascade(el)) return;
  if (el.dataset.selectOrder !== undefined) {
    if (el.checked) state.selectedOrderIds.push(el.dataset.selectOrder);
    else state.selectedOrderIds = state.selectedOrderIds.filter((id) => id !== el.dataset.selectOrder);
    return;
  }
  if (el.dataset.productionStep !== undefined) {
    request(`/api/orders/${el.dataset.order}/production-step`, { body: { stepId: el.dataset.productionStep, done: el.checked } })
      .then(() => refresh())
      .then(() => actions["open-order"]({ dataset: { id: el.dataset.order } }))
      .catch((error) => toast(error.message, "error"));
    return;
  }
  if (el.dataset.actionChange && handleMaterialChange(el)) return;
  if (handleStripField(el)) return;
  if (handleWallHeight(el)) return;
  if (handlePieceField(el)) { render(); return; }
  if (handleDetailField(el)) return;
  if (handleQuoteField(el)) return;
});

document.addEventListener("input", (event) => {
  const el = event.target;
  if (handleApplianceSearchInput(el)) return;
  if (el.dataset.materialSearch !== undefined) {
    clearTimeout(el._timer);
    el._timer = setTimeout(() => {
      state.materialSearch = el.value;
      render();
      const input = document.querySelector("[data-material-search]");
      if (input) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
    }, 300);
    return;
  }
  if (el.dataset.catalogSearch !== undefined) {
    state.catalogSearch = el.value;
    // Filtrage en direct sans reconstruire l'input (pour garder le focus).
    const query = el.value.toLowerCase();
    document.querySelectorAll("[data-catalog-row], tbody tr").forEach(() => {});
    clearTimeout(el._timer);
    el._timer = setTimeout(() => { render(); document.querySelector("[data-catalog-search]")?.focus(); }, 350);
    return;
  }
  if (el.dataset.filter === "search") {
    clearTimeout(el._timer);
    el._timer = setTimeout(() => {
      state.filters.search = el.value;
      render();
      const input = document.querySelector('[data-filter="search"]');
      if (input) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
    }, 300);
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeModal();
});

// ---------- Notifications & déconnexion ----------

Object.assign(actions, {
  logout: async () => {
    try { await request("/api/logout", { body: {} }); } catch { /* session déjà close */ }
    setToken(null);
    state.data = null;
    render();
  },
  "show-notifications": () => {
    const items = state.data.notifications || [];
    showModal(`
      <div class="modal-head"><div><h2>Notifications</h2><p>${items.filter((n) => !n.read).length} non lue(s)</p></div>
        <button class="icon-btn" data-action="close-modal">×</button></div>
      <div class="modal-body">${items.length ? `<div class="activity">${items.map((item) => `
        <div class="activity-item"><span class="activity-dot" ${item.read ? 'style="opacity:.25"' : ""}></span>
          <div><strong>${esc(item.title)}</strong><p>${esc(item.body)} · ${dateFr(item.createdAt)}</p></div></div>`).join("")}</div>`
        : `<div class="empty"><p>Aucune notification.</p></div>`}</div>
      <div class="modal-actions">
        <button class="btn btn-ghost" data-action="read-notifications">Tout marquer comme lu</button>
        <button class="btn btn-primary" data-action="close-modal">Fermer</button></div>`);
  },
  "read-notifications": async () => {
    try {
      await request("/api/notifications/read", { body: {} });
      await refresh();
      closeModal();
      render();
    } catch (error) { toast(error.message, "error"); }
  },
});

// ---------- Démarrage ----------

(async function boot() {
  try {
    await refresh();
    state.view = "dashboard";
  } catch {
    state.data = null;
  }
  render();
})();
