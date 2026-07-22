// Petites briques d'interface : formatage, toasts, modales, badges.

import { state } from "./state.js";

export const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[c]));

export const money = (value) => new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(Number(value || 0));
export const number = (value, digits = 0) => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: digits }).format(Number(value || 0));
export const dateFr = (value) => (value ? new Date(value).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" }) : "");
export const initials = (name) => String(name || "M").split(/\s+/).slice(0, 2).map((part) => part[0] || "").join("").toUpperCase();

export function toast(message, type = "success") {
  const region = document.querySelector("#toast-region");
  const element = document.createElement("div");
  element.className = `toast ${type}`;
  element.textContent = message;
  region.append(element);
  setTimeout(() => element.remove(), 4200);
}

let modalContent = null;
let modalLarge = false;

export function showModal(content, large = false) {
  modalContent = content;
  modalLarge = large;
  renderModal();
}

export function closeModal() {
  modalContent = null;
  renderModal();
}

export function renderModal() {
  document.querySelector(".modal-backdrop")?.remove();
  if (!modalContent) return;
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `<div class="modal ${modalLarge ? "large" : ""}" role="dialog" aria-modal="true">${modalContent}</div>`;
  backdrop.addEventListener("mousedown", (event) => {
    if (event.target === backdrop) closeModal();
  });
  document.body.append(backdrop);
}

export function statusBadge(status) {
  const label = state.data?.system?.statusLabels?.[status] || status;
  return `<span class="badge status-${esc(status)}">● ${esc(label)}</span>`;
}

export function kpi(label, value, sub) {
  return `<div class="kpi"><small>${esc(label)}</small><strong>${value}</strong><span>${esc(sub || "")}</span></div>`;
}

export function weekLabel(isoWeek) {
  const match = /^(\d{4})-W(\d{2})$/.exec(String(isoWeek || ""));
  return match ? `Semaine ${Number(match[2])}, ${match[1]}` : isoWeek || "—";
}

export function materialLabel(materialId) {
  const material = state.data?.catalog?.materials?.find((m) => m.id === materialId);
  return material ? `${material.brand} · ${material.color}` : "—";
}
