// Documents imprimables (HTML autonome avec CSS d'impression) :
// - devis client (avec marge, TVA, remise — sans les prix usine)
// - bon de commande client
// - bon de commande usine (prix d'achat usine, sans les lignes commerciales)
// - fiche technique de fabrication (cotes, découpes, chants, étapes)

import { STATUS_LABELS, EDGE_SIDES, PRODUCTION_STEPS } from "../../shared/constants.js";

const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = (value) => new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(Number(value || 0));
const num = (value, digits = 2) => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: digits }).format(Number(value || 0));
const dateFr = (value) => (value ? new Date(value).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" }) : "");

const BASE_CSS = `
  * { box-sizing: border-box; margin: 0; }
  body { font: 13px/1.5 "Segoe UI", system-ui, sans-serif; color: #20231f; padding: 34px 40px; }
  header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 26px; }
  h1 { font-size: 24px; letter-spacing: .3px; }
  h2 { font-size: 15px; margin: 22px 0 8px; }
  .muted { color: #6c6f6a; }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; margin: 14px 0; }
  .box { border: 1px solid #ddd8d0; border-radius: 8px; padding: 12px 14px; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #e7e2da; vertical-align: top; }
  th { font-size: 11px; text-transform: uppercase; letter-spacing: .6px; color: #6c6f6a; }
  td.r, th.r { text-align: right; white-space: nowrap; }
  .totals { margin-left: auto; width: 320px; margin-top: 14px; }
  .totals div { display: flex; justify-content: space-between; padding: 4px 0; }
  .totals .grand { border-top: 2px solid #20231f; font-size: 16px; font-weight: 700; padding-top: 8px; margin-top: 6px; }
  .logo { font-weight: 800; font-size: 20px; }
  .logo span { display: inline-block; background: #c75b39; color: #fff; border-radius: 6px; padding: 1px 8px; margin-right: 7px; }
  .terms { font-size: 11px; color: #6c6f6a; margin-top: 26px; white-space: pre-wrap; }
  .badge { display: inline-block; border: 1px solid #ddd8d0; border-radius: 99px; padding: 2px 10px; font-size: 11px; }
  .piece { border: 1px solid #ddd8d0; border-radius: 8px; padding: 12px 14px; margin: 10px 0; page-break-inside: avoid; }
  .sig { display: grid; grid-template-columns: 1fr 1fr; gap: 22px; margin-top: 34px; }
  .sig .box { min-height: 110px; }
  ul.checklist { list-style: none; padding: 0; } ul.checklist li { padding: 3px 0; }
  @media print { body { padding: 10mm 12mm; } .noprint { display: none; } }
`;

function page(title, body) {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${BASE_CSS}</style></head>
<body>${body}<div class="noprint" style="margin-top:26px"><button onclick="print()" style="padding:9px 18px;font-weight:600;cursor:pointer">Imprimer / PDF</button></div></body></html>`;
}

function header(issuer, docTitle, meta) {
  return `<header>
    <div>
      ${issuer.logoDataUrl ? `<img src="${esc(issuer.logoDataUrl)}" alt="" style="max-height:54px;max-width:190px;margin-bottom:8px">` : `<div class="logo"><span>M</span>${esc(issuer.name)}</div>`}
      <div class="muted">${esc(issuer.legalName || "")}</div>
      <div class="muted">${esc(issuer.address || "")}</div>
      <div class="muted">${[issuer.siret ? `SIRET ${issuer.siret}` : "", issuer.vatNumber ? `TVA ${issuer.vatNumber}` : ""].filter(Boolean).map(esc).join(" · ")}</div>
      <div class="muted">${[issuer.email, issuer.phone].filter(Boolean).map(esc).join(" · ")}</div>
    </div>
    <div style="text-align:right">
      <h1>${esc(docTitle)}</h1>
      ${meta.map((line) => `<div class="muted">${esc(line)}</div>`).join("")}
    </div>
  </header>`;
}

function customerBox(project) {
  const c = project.customer || {};
  return `<div class="box"><strong>Client</strong><br>${esc(c.name || "")}<br>${esc(c.address || "")}<br>${[c.email, c.phone].filter(Boolean).map(esc).join(" · ")}</div>`;
}

function customerLinesTable(quote) {
  const rows = quote.lines.map((line) => `<tr>
      <td>${esc(line.code)}</td><td>${esc(line.description)}</td>
      <td class="r">${num(line.quantity, 3)} ${esc(line.unit)}</td>
      <td class="r">${money(line.customerUnitPrice)}</td>
      <td class="r">${money(line.customerAmount)}</td></tr>`).join("");
  const manualRows = (quote.manualLines || []).map((line) => `<tr>
      <td></td><td>${esc(line.label)}</td>
      <td class="r">${num(line.quantity || 1)}</td>
      <td class="r">${money(line.priceHT)}</td>
      <td class="r">${money(line.amount)}</td></tr>`).join("");
  return `<table><thead><tr><th>Code</th><th>Désignation</th><th class="r">Qté</th><th class="r">P.U. HT</th><th class="r">Total HT</th></tr></thead>
    <tbody>${rows}${manualRows}</tbody></table>`;
}

function customerTotals(quote) {
  return `<div class="totals">
    <div><span>Total HT</span><strong>${money(quote.customerHT)}</strong></div>
    ${(quote.vatBreakdown || []).map((entry) => `<div><span>TVA ${num(entry.rate)} %</span><span>${money(entry.amount)}</span></div>`).join("")}
    <div><span>Sous-total TTC</span><span>${money(quote.customerSubtotalTTC)}</span></div>
    ${quote.discountTTC ? `<div><span>Remise</span><span>− ${money(quote.discountTTC)}</span></div>` : ""}
    <div class="grand"><span>Total TTC</span><span>${money(quote.customerTTC)}</span></div>
  </div>`;
}

export function quoteDocument(project, reseller) {
  const quote = project.quote;
  const issuer = { ...reseller, name: reseller.company };
  const body = `
    ${header(issuer, "Devis", [`N° ${project.reference}`, `Date : ${dateFr(project.quoteDate)}`, `Validité : ${dateFr(project.validityDate)}`])}
    <div class="grid2">${customerBox(project)}
      <div class="box"><strong>Projet</strong><br>${esc(project.title)}<br>${esc(project.roomType || "")} · semaine de livraison souhaitée ${esc(project.deliveryWeek || "—")}</div></div>
    ${customerLinesTable(quote)}
    ${customerTotals(quote)}
    ${project.notes ? `<h2>Remarques</h2><p>${esc(project.notes)}</p>` : ""}
    <div class="sig"><div class="box"><strong>Bon pour accord client</strong><br><span class="muted">Date et signature précédées de « bon pour accord »</span></div>
    <div class="box"><strong>${esc(reseller.company)}</strong><br><span class="muted">${esc(reseller.salespersonName || reseller.managerName || "")}</span></div></div>
    <div class="terms">${esc([reseller.paymentTerms, reseller.latePenalties, reseller.salesTerms].filter(Boolean).join("\n"))}</div>`;
  return page(`Devis ${project.reference}`, body);
}

export function customerOrderDocument(project, reseller) {
  const quote = project.quote;
  const issuer = { ...reseller, name: reseller.company };
  const body = `
    ${header(issuer, "Bon de commande", [`N° ${project.reference}`, `Date : ${dateFr(project.customerOrderDate || project.quoteDate)}`])}
    <div class="grid2">${customerBox(project)}
      <div class="box"><strong>Livraison</strong><br>Semaine ${esc(project.deliveryWeek || "—")}<br>${esc(project.customer?.address || "")}</div></div>
    ${customerLinesTable(quote)}
    ${customerTotals(quote)}
    <div class="sig"><div class="box"><strong>Signature client</strong></div><div class="box"><strong>${esc(reseller.company)}</strong></div></div>
    <div class="terms">${esc([reseller.paymentTerms, reseller.latePenalties].filter(Boolean).join("\n"))}</div>`;
  return page(`Bon de commande ${project.reference}`, body);
}

function pieceTechnicalBlock(piece, catalog, materialLabel) {
  const cutRows = (piece.cutouts || []).map((cut) => {
    const service = (catalog?.services || []).find((s) => s.id === cut.serviceId);
    const ref = [cut.brand, cut.reference].filter(Boolean).join(" ");
    const dims = cut.shape === "circle" ? `Ø ${num(cut.diameterMm || cut.widthMm, 0)} mm` : `${num(cut.widthMm, 0)} × ${num(cut.heightMm, 0)} mm${cut.radiusMm ? ` · R${num(cut.radiusMm, 0)}` : ""}`;
    return `<tr><td>${esc(service?.label || cut.kind)}</td><td>${esc(ref || "—")}${cut.verified ? "" : " <span class='badge'>à vérifier</span>"}</td>
      <td class="r">${dims}</td><td class="r">X ${num(cut.xMm, 0)} · Y ${num(cut.yMm, 0)} mm</td></tr>`;
  }).join("");
  const edgeRows = (piece.edges || []).map((edge) => {
    const service = (catalog?.services || []).find((s) => s.id === edge.serviceId);
    return `<tr><td>${esc(service?.label || "Chant")}</td><td>${esc(EDGE_SIDES[edge.side] || edge.side)}</td><td class="r">${num(edge.lengthMm || 0, 0)} mm</td><td></td></tr>`;
  }).join("");
  return `<div class="piece">
    <strong>${esc(piece.name || piece.kind)}</strong> — ${num(piece.lengthMm, 0)} × ${num(piece.widthMm, 0)} mm · ${esc(materialLabel)}
    ${cutRows || edgeRows ? `<table><thead><tr><th>Usinage</th><th>Référence / côté</th><th class="r">Dimensions</th><th class="r">Position (depuis coin haut-gauche)</th></tr></thead><tbody>${cutRows}${edgeRows}</tbody></table>` : `<p class="muted">Aucun usinage.</p>`}
  </div>`;
}

export function factoryOrderDocument(order, project, reseller, factory, catalog) {
  const quote = project.quote;
  const rows = quote.lines.map((line) => `<tr>
      <td>${esc(line.code)}</td><td>${esc(line.description)}</td>
      <td class="r">${num(line.quantity, 3)} ${esc(line.unit)}</td>
      <td class="r">${money(line.factoryUnitPrice)}</td>
      <td class="r">${money(line.factoryAmount)}</td></tr>`).join("");
  const body = `
    ${header({ ...factory }, "Bon de commande usine", [`N° ${order.number}`, `Statut : ${STATUS_LABELS[order.status] || order.status}`, `Semaine : ${order.deliveryWeek || "—"}`, `Révision ${order.revision || 1}`])}
    <div class="grid2">
      <div class="box"><strong>Revendeur</strong><br>${esc(reseller.company)}<br>${esc(reseller.deliveryAddress || "")}<br>${[reseller.email, reseller.phone].filter(Boolean).map(esc).join(" · ")}</div>
      <div class="box"><strong>Chantier / client final</strong><br>${esc(project.customer?.name || "")}<br>${esc(project.customer?.address || "")}</div>
    </div>
    <table><thead><tr><th>Code</th><th>Désignation</th><th class="r">Qté</th><th class="r">P.U. usine HT</th><th class="r">Total usine HT</th></tr></thead><tbody>${rows}</tbody></table>
    <div class="totals"><div class="grand"><span>Total achat usine HT</span><span>${money(quote.purchaseHT)}</span></div></div>
    ${project.notes ? `<h2>Remarques</h2><p>${esc(project.notes)}</p>` : ""}`;
  return page(`BC usine ${order.number}`, body);
}

export function technicalSheetDocument(order, project, reseller, factory, catalog) {
  const material = (catalog?.materials || []).find((m) => m.id === project.materialId);
  const materialLabel = material ? `${material.brand} ${material.color} · ${project.thicknessMm} mm · ${project.finish}` : "";
  const manufactured = (project.pieces || []).filter((p) => ["worktop", "splashback", "panel"].includes(p.kind));
  const steps = PRODUCTION_STEPS.map((step) => {
    const done = order.productionSteps?.[step.id];
    return `<li>${done ? "☑" : "☐"} ${esc(step.label)}${done ? ` <span class="muted">— ${dateFr(done.at)} (${esc(done.by || "")})</span>` : ""}</li>`;
  }).join("");
  const body = `
    ${header({ ...factory }, "Fiche technique de fabrication", [`N° ${order.number}`, `${project.reference}`, `Semaine : ${order.deliveryWeek || "—"}`])}
    <div class="grid2">
      <div class="box"><strong>Matériau</strong><br>${esc(materialLabel)}<br><span class="muted">Plaque maxi : ${num(material?.maxLengthMm, 0)} × ${num(material?.maxWidthMm, 0)} mm</span></div>
      <div class="box"><strong>Chantier</strong><br>${esc(project.customer?.name || "")} · ${esc(reseller.company)}<br>${esc(project.customer?.address || "")}</div>
    </div>
    <h2>Pièces à fabriquer (${manufactured.length})</h2>
    ${manufactured.map((piece) => pieceTechnicalBlock(piece, catalog, materialLabel)).join("")}
    <h2>Étapes de fabrication</h2><ul class="checklist">${steps}</ul>
    ${project.notes ? `<h2>Remarques</h2><p>${esc(project.notes)}</p>` : ""}
    <p class="terms">DXF 2D machine disponible dans Marbexa · Les cotes d'encastrement marquées « à vérifier » doivent être contrôlées avec la notice fabricant avant usinage.</p>`;
  return page(`Fiche technique ${order.number}`, body);
}
