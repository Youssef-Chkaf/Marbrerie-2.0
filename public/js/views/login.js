import { state } from "../state.js";
import { esc } from "../ui.js";

export function renderLogin() {
  return `<div class="login-page">
    <div class="login-panel">
      <div class="login-brand"><span class="logo-mark">M</span><strong>Marbexa</strong></div>
      <div class="login-copy">
        <h1>Du premier trait à la livraison</h1>
        <p>L'atelier numérique qui relie marbriers et revendeurs : plans, chiffrage, commandes et fabrication au même endroit.</p>
      </div>
      <form id="login-form" class="login-form">
        <label>E-mail<input name="email" type="email" autocomplete="username" required placeholder="vous@societe.fr"></label>
        <label>Mot de passe<input name="password" type="password" autocomplete="current-password" required placeholder="••••••••"></label>
        ${state.loginError ? `<div class="warning">${esc(state.loginError)}</div>` : ""}
        <button class="btn btn-primary" type="submit">Se connecter</button>
        <p class="trust-line">Comptes de démonstration : <br>usine · atelier@marbexa.fr / usine2026<br>revendeur · cuisine@marbexa.fr / revendeur2026</p>
      </form>
    </div>
    <div class="login-visual">
      <div class="visual-caption">
        <span class="eyebrow">Marbexa 2.0</span>
        <h2>Devis, plans, découpes, DXF machine et suivi de fabrication.</h2>
      </div>
    </div>
  </div>`;
}
