// Documents imprimables — réplique du gabarit d'origine (5 pages) :
//   page 1-2 : en-tête émetteur, blocs Émetteur/Client/Projet, détail des
//              prestations groupé par élément avec sous-totaux, totaux,
//              conditions de règlement ;
//   page 3   : Vue d'ensemble du projet (repères numérotés + légende) ;
//   page 4+  : Plans techniques entièrement cotés (un cadre par pièce) ;
//   dernière : note « Important », remarques, signatures, pied de page.
//
// Types : quote (Devis client) · customer-order (Bon de commande client, N° BDC)
//         factory-order (Bon de commande usine, prix d'achat, sans TVA).

import { STATUS_LABELS, PRODUCTION_STEPS, EDGE_SIDES } from "../../shared/constants.js";
import { overviewSvg, technicalSvg } from "../../shared/plan-svg.js";

const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = (value) => new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(Number(value || 0));
const dateFr = (value) => (value ? new Date(value).toLocaleDateString("fr-FR") : "");
// Les quantités sont imprimées avec un point décimal (1.334 m², 0.65 ml).
const qty = (value) => String(Math.round(Number(value || 0) * 1000) / 1000);

const CSS = `
  * { box-sizing: border-box; margin: 0; }
  body { font: 13px/1.45 Arial, "Segoe UI", sans-serif; color: #26282a; padding: 26px 34px; }
  .doc-header { display: flex; justify-content: space-between; align-items: flex-start; padding-bottom: 14px; border-bottom: 4px solid #c75b39; }
  .issuer-name { font-family: Georgia, "Times New Roman", serif; font-size: 30px; font-weight: 700; letter-spacing: .4px; }
  .issuer-sub { color: #8a8d90; margin-top: 4px; font-size: 12.5px; }
  .doc-title { font-size: 26px; font-weight: 700; text-align: right; }
  .doc-meta { text-align: right; font-size: 12.5px; margin-top: 4px; }
  .doc-meta strong { font-weight: 700; }
  .info-blocks { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 22px; margin: 24px 0 8px; padding-top: 14px; border-top: 1px solid #d9d5cf; border-bottom: 1px solid #d9d5cf; padding-bottom: 16px; }
  .info-blocks h4 { font-size: 13px; margin-bottom: 6px; }
  .info-blocks div p { margin: 2px 0; font-size: 12.5px; }
  h2.section { font-size: 17px; margin: 26px 0 10px; }
  table.lines { width: 100%; border-collapse: collapse; }
  table.lines th { text-align: left; font-size: 12px; padding: 8px 6px; border-bottom: 2px solid #b9b4ad; }
  table.lines th.r, table.lines td.r { text-align: right; white-space: nowrap; }
  table.lines td { padding: 9px 6px; border-bottom: 1px solid #e4e0d9; vertical-align: top; font-size: 12.5px; }
  tr.group-head td { border-top: 3px double #b9b4ad; border-bottom: 1px solid #e4e0d9; padding-top: 12px; }
  tr.group-head .g-title { font-size: 14px; font-weight: 700; }
  tr.group-head .g-sub { color: #8a8d90; font-size: 11.5px; }
  tr.material-line td { font-weight: 700; }
  tr.subtotal td { border-bottom: 2px solid #b9b4ad; padding: 8px 6px 12px; }
  .subtotal-label { text-align: right; font-weight: 700; font-size: 13.5px; }
  .subtotal-note { text-align: right; color: #8a8d90; font-size: 10.5px; }
  .margin-note { color: #6c6f6a; font-size: 12px; margin: 18px 0; border-top: 1px solid #d9d5cf; padding-top: 12px; }
  .totals { width: 330px; margin-left: auto; margin-top: 8px; }
  .totals .row { display: flex; justify-content: space-between; padding: 6px 4px; border-bottom: 1px solid #e4e0d9; }
  .totals .grand { display: flex; justify-content: space-between; padding: 10px 4px; font-size: 19px; font-weight: 700; border-bottom: none; margin-top: 4px; }
  .cond-boxes { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; margin-top: 26px; }
  .cond-boxes .box, .sig-boxes .box { border: 1.5px solid #cfc9c1; border-radius: 10px; padding: 12px 14px; font-size: 12.5px; }
  .cond-boxes .box strong { display: block; margin-bottom: 4px; }
  .page { page-break-before: always; }
  h2.page-title { font-size: 18px; margin: 8px 0 16px; }
  .sheet { border: 1px solid #d9d5cf; border-radius: 10px; background: #f6f3ec; padding: 26px; }
  .legend { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; border-top: 1px solid #d9d5cf; margin-top: 18px; padding-top: 12px; }
  .legend .item { display: flex; gap: 9px; align-items: flex-start; font-size: 12px; }
  .legend .badge-n { display: inline-flex; width: 22px; height: 22px; border: 1.5px solid #26282a; border-radius: 50%; align-items: center; justify-content: center; font-weight: 700; flex: none; }
  .tech-block { border: 1px solid #d9d5cf; border-radius: 8px; padding: 16px 18px 8px; margin-bottom: 22px; page-break-inside: avoid; }
  .tech-head { display: flex; justify-content: space-between; align-items: baseline; border-bottom: 1px solid #d9d5cf; padding-bottom: 8px; margin-bottom: 8px; }
  .tech-head h3 { font-size: 17px; }
  .tech-head .mat { font-size: 13px; color: #4a4d50; } .tech-head .mat strong { color: #26282a; }
  .important { display: flex; gap: 10px; border-left: 4px solid #c75b39; background: #faf6f1; padding: 10px 14px; font-size: 12.5px; margin: 18px 0; }
  h2.remarks { font-size: 16px; margin: 22px 0 8px; }
  .sig-boxes { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; margin-top: 18px; }
  .sig-boxes .box { min-height: 120px; }
  .sig-boxes .box small { color: #8a8d90; }
  .doc-footer { border-top: 1px solid #d9d5cf; margin-top: 26px; padding-top: 8px; color: #8a8d90; font-size: 11px; }
  .noprint { margin-top: 24px; }
  @media print { body { padding: 6mm 8mm; } .noprint { display: none; } }
`;

function header(issuer, title, metaLines) {
  return `<header class="doc-header">
    <div>
      ${issuer.logoDataUrl ? `<img src="${esc(issuer.logoDataUrl)}" alt="" style="max-height:56px;max-width:220px;margin-bottom:6px"><br>` : ""}
      <div class="issuer-name">${esc(issuer.name)}</div>
      <div class="issuer-sub">${esc(issuer.address || "")}</div>
      <div class="issuer-sub">${[issuer.phone, issuer.email].filter(Boolean).map(esc).join(" · ")}</div>
    </div>
    <div>
      <div class="doc-title">${esc(title)}</div>
      <div class="doc-meta">${metaLines.map((line) => `<div>${line}</div>`).join("")}</div>
    </div>
  </header>`;
}

function infoBlocks(firstTitle, firstBody, project) {
  const c = project.customer || {};
  return `<div class="info-blocks">
    <div><h4>${esc(firstTitle)}</h4>${firstBody}</div>
    <div><h4>Client</h4>
      <p>${esc(c.name || "—")}</p>
      <p>${esc(c.address || "")}</p>
      <p>${[c.phone, c.email].filter(Boolean).map(esc).join(" · ")}</p></div>
    <div><h4>Projet</h4>
      <p>${esc(project.title)}</p>
      <p>${esc(project.roomType || "")}</p>
      <p>Livraison souhaitée : ${esc(project.deliveryWeek || "—")}</p></div>
  </div>`;
}

// Tableau groupé par élément, avec sous-total par groupe.
function linesTable(project, quote, { customerPrices, vatColumn }) {
  const priceOf = (line) => (customerPrices ? line.customerUnitPrice : line.factoryUnitPrice);
  const amountOf = (line) => (customerPrices ? line.customerAmount : line.factoryAmount);

  const groups = new Map();
  const pieces = (project.pieces || []).filter((p) => ["worktop", "splashback", "panel"].includes(p.kind));
  const kindLabels = { worktop: "Plan de travail", splashback: "Crédence", panel: "Panneau" };
  for (const line of quote.lines || []) {
    const key = line.pieceId || "_general";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(line);
  }

  const colCount = vatColumn ? 6 : 5;
  let rows = "";
  let index = 0;
  for (const [key, lines] of groups) {
    const piece = pieces.find((p) => p.id === key);
    if (piece) {
      index += 1;
      rows += `<tr class="group-head"><td colspan="${colCount}">
        <div class="g-title">Élément ${index} — ${esc(piece.name)}</div>
        <div class="g-sub">${esc(kindLabels[piece.kind] || piece.kind)} · élément principal et toutes ses découpes / finitions</div></td></tr>`;
    } else {
      rows += `<tr class="group-head"><td colspan="${colCount}">
        <div class="g-title">Livraison et prestations générales</div>
        <div class="g-sub">Prestations hors élément</div></td></tr>`;
    }
    for (const line of lines) {
      rows += `<tr class="${line.category === "Matière" ? "material-line" : ""}">
        <td>${esc(line.code)}</td>
        <td>${esc(line.description)}</td>
        <td class="r">${qty(line.quantity)} ${esc(line.unit)}</td>
        <td class="r">${money(priceOf(line))}</td>
        ${vatColumn ? `<td class="r">${line.customerVatPct} %</td>` : ""}
        <td class="r">${money(amountOf(line))}</td>
      </tr>`;
    }
    const subtotal = lines.reduce((sum, line) => sum + amountOf(line), 0);
    rows += `<tr class="subtotal"><td colspan="${colCount - 1}">
      <div class="subtotal-label">Sous-total du groupe</div>
      <div class="subtotal-note">Montant informatif déjà inclus dans le total — ce n'est pas un supplément.</div></td>
      <td class="r" style="font-weight:700">${money(Math.round(subtotal * 100) / 100)}</td></tr>`;
  }

  // Lignes commerciales du revendeur (documents client uniquement).
  if (customerPrices && (quote.manualLines || []).length) {
    rows += `<tr class="group-head"><td colspan="${colCount}">
      <div class="g-title">Prestations complémentaires</div>
      <div class="g-sub">Pose et prestations du revendeur</div></td></tr>`;
    for (const line of quote.manualLines) {
      rows += `<tr><td></td><td>${esc(line.label)}</td><td class="r">${qty(line.quantity || 1)} un</td>
        <td class="r">${money(line.priceHT)}</td>${vatColumn ? `<td class="r">${line.vatPct} %</td>` : ""}
        <td class="r">${money(line.amount)}</td></tr>`;
    }
  }

  return `<table class="lines">
    <thead><tr><th style="width:52px">Code</th><th>Désignation</th><th class="r">Quantité</th>
      <th class="r">Prix unitaire HT</th>${vatColumn ? `<th class="r">TVA</th>` : ""}<th class="r">Total HT</th></tr></thead>
    <tbody>${rows}</tbody></table>`;
}

function customerTotals(quote) {
  return `
  <div class="margin-note">Prix de vente calculés avec la marge répartie sur chaque ligne. Les prestations ajoutées manuellement et la remise restent privées entre le revendeur et son client.</div>
  <div class="totals">
    <div class="row"><span>Montant HT</span><strong>${money(quote.customerHT)}</strong></div>
    ${(quote.vatBreakdown || []).map((entry) => `<div class="row"><span>TVA ${entry.rate} %</span><strong>${money(entry.amount)}</strong></div>`).join("")}
    <div class="row"><span>Sous-total TTC</span><strong>${money(quote.customerSubtotalTTC)}</strong></div>
    ${quote.discountTTC ? `<div class="row"><span>Remise</span><strong>− ${money(quote.discountTTC)}</strong></div>` : ""}
    <div class="grand"><span>Total TTC</span><span>${money(quote.customerTTC)}</span></div>
  </div>`;
}

function conditionBoxes(reseller) {
  return `<div class="cond-boxes">
    <div class="box"><strong>Conditions de règlement</strong>${esc(reseller.paymentTerms || "Paiement selon les conditions indiquées au devis.")}</div>
    <div class="box"><strong>Retard de paiement</strong>${esc(reseller.latePenalties || "")}</div>
  </div>`;
}

function overviewPage(project) {
  const { svg, legend } = overviewSvg(project);
  return `<div class="page">
    <h2 class="page-title">Vue d'ensemble du projet</h2>
    <div class="sheet">${svg}
      <div class="legend">${legend.map((item) => `
        <div class="item"><span class="badge-n">${item.index}</span>
          <span><strong>${esc(item.name)}</strong><br>
          <span style="color:#8a8d90">${item.lengthMm} × ${item.widthMm} mm · rotation ${item.rotationDeg}°</span></span></div>`).join("")}
      </div></div></div>`;
}

function technicalPages(project, catalog) {
  const pieces = (project.pieces || []).filter((p) => ["worktop", "splashback", "panel"].includes(p.kind));
  if (!pieces.length) return "";
  const blocks = pieces.map((piece, index) => {
    const material = (catalog?.materials || []).find((m) => m.id === (piece.materialId || project.materialId));
    const thickness = piece.thicknessMm || project.thicknessMm;
    const finish = piece.finish || project.finish;
    const variant = (material?.variants || []).find((v) => v.finish === finish && v.thicknessMm === Number(thickness));
    return `<div class="tech-block">
      <div class="tech-head"><h3>${index + 1}. ${esc(piece.name)}</h3>
        <span class="mat"><strong>${esc(material?.brand || "")}</strong> · <strong>${esc(material?.color || "")}</strong> · épaisseur <strong>${esc(thickness)} mm</strong> · rotation ${piece.rotationDeg || 0}°${variant ? ` · ${esc(variant.finishLabel || finish)}` : ""}</span></div>
      ${technicalSvg(piece)}
    </div>`;
  }).join("");
  return `<div class="page"><h2 class="page-title">Plans techniques entièrement cotés</h2>${blocks}</div>`;
}

function closingSection(project, issuer, { signatures }) {
  const important = `<div class="important"><div><strong>Important :</strong> toutes les cotes sont en millimètres. Les axes verticaux sont mesurés depuis le chant avant pour les plans de travail, et depuis le chant bas pour les crédences et panneaux. Les références et cotes d'encastrement doivent être vérifiées avant fabrication.</div></div>`;
  const remarks = project.notes ? `<h2 class="remarks">Remarques</h2><p style="font-size:12.5px">${esc(project.notes)}</p>` : "";
  const signatureBoxes = signatures.length ? `<div class="sig-boxes">${signatures.map(([title, subtitle]) => `
    <div class="box"><strong>${esc(title)}</strong><br><small>${esc(subtitle)}</small></div>`).join("")}</div>` : "";
  const footer = `<div class="doc-footer">${esc(issuer.name)}${issuer.siret ? ` · SIRET ${esc(issuer.siret)}` : ""}<br>${esc(issuer.email || "")}</div>`;
  return `${important}${remarks}${signatureBoxes}${footer}`;
}

function page(title, body) {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${CSS}</style></head>
<body>${body}<div class="noprint"><button onclick="print()" style="padding:9px 18px;font-weight:600;cursor:pointer">Imprimer / PDF</button></div></body></html>`;
}

// ---------- Documents ----------

export function quoteDocument(project, reseller, factory, catalog) {
  const quote = project.quote;
  const issuer = { ...reseller, name: reseller.company, address: reseller.billingAddress || reseller.deliveryAddress };
  const body = `
    ${header(issuer, "Devis client", [
      `<strong>N° ${esc(project.reference)}</strong>`,
      `Date : ${dateFr(project.quoteDate)}`,
      `Valable jusqu'au : ${dateFr(project.validityDate)}`,
    ])}
    ${infoBlocks("Émetteur", `<p>${esc(reseller.company)}</p><p>${esc(reseller.deliveryAddress || "")}</p><p>${[reseller.phone, reseller.email].filter(Boolean).map(esc).join(" · ")}</p>`, project)}
    <h2 class="section">Détail des prestations</h2>
    ${linesTable(project, quote, { customerPrices: true, vatColumn: true })}
    ${customerTotals(quote)}
    ${conditionBoxes(reseller)}
    ${overviewPage(project)}
    ${technicalPages(project, catalog)}
    ${closingSection(project, issuer, { signatures: [["Le revendeur", "Date, nom et signature"], ["Le client - Bon pour accord", "Date, nom, signature et mention manuscrite"]] })}`;
  return page(`Devis client ${project.reference}`, body);
}

export function customerOrderDocument(project, reseller, factory, catalog) {
  const quote = project.quote;
  const issuer = { ...reseller, name: reseller.company, address: reseller.billingAddress || reseller.deliveryAddress };
  const bdcNumber = String(project.reference || "").replace(/^DEV/, "BDC");
  const body = `
    ${header(issuer, "Bon de commande client", [
      `<strong>N° ${esc(bdcNumber)}</strong>`,
      `Date : ${dateFr(project.customerOrderDate || project.quoteDate)}`,
    ])}
    ${infoBlocks("Émetteur", `<p>${esc(reseller.company)}</p><p>${esc(reseller.deliveryAddress || "")}</p><p>${[reseller.phone, reseller.email].filter(Boolean).map(esc).join(" · ")}</p>`, project)}
    <h2 class="section">Détail des prestations</h2>
    ${linesTable(project, quote, { customerPrices: true, vatColumn: true })}
    ${customerTotals(quote)}
    ${conditionBoxes(reseller)}
    ${overviewPage(project)}
    ${technicalPages(project, catalog)}
    ${closingSection(project, issuer, { signatures: [["Le revendeur", "Date, nom et signature"], ["Le client - Bon pour accord", "Date, nom, signature et mention manuscrite"]] })}`;
  return page(`Bon de commande client ${bdcNumber}`, body);
}

export function factoryOrderDocument(order, project, reseller, factory, catalog) {
  const quote = project.quote;
  const issuer = { ...factory };
  const body = `
    ${header(issuer, "Bon de commande usine", [
      `<strong>N° ${esc(order.number || "(brouillon)")}</strong>`,
      `Date d'envoi : ${dateFr(order.submittedAt || project.updatedAt)}`,
      order.revision > 1 ? `Révision ${order.revision}` : "",
    ].filter(Boolean))}
    ${infoBlocks("Revendeur", `<p>${esc(reseller.company)}</p><p>${esc(reseller.deliveryAddress || "")}</p><p>${[reseller.phone, reseller.email].filter(Boolean).map(esc).join(" · ")}</p>`, project)}
    <h2 class="section">Détail du chiffrage usine</h2>
    ${linesTable(project, quote, { customerPrices: false, vatColumn: false })}
    <div class="totals" style="margin-top:16px">
      <div class="grand"><span>Prix usine HT</span><span>${money(quote.purchaseHT)}</span></div>
    </div>
    ${overviewPage(project)}
    ${technicalPages(project, catalog)}
    ${closingSection(project, issuer, { signatures: [["Le revendeur", "Date, nom et signature"], ["L'usine - Bon pour fabrication", "Date, nom et signature"]] })}`;
  return page(`Bon de commande usine ${order.number || project.reference}`, body);
}

export function technicalSheetDocument(order, project, reseller, factory, catalog) {
  const material = (catalog?.materials || []).find((m) => m.id === project.materialId);
  const variant = (material?.variants || []).find((v) => v.finish === project.finish && v.thicknessMm === Number(project.thicknessMm))
    || (material?.variants || [])[0];
  const materialLabel = material ? `${material.brand} ${material.color} · ${project.thicknessMm} mm · ${variant?.finishLabel || project.finish}` : "";
  const steps = PRODUCTION_STEPS.map((step) => {
    const done = order.productionSteps?.[step.id];
    return `<li style="padding:3px 0">${done ? "☑" : "☐"} ${esc(step.label)}${done ? ` <span style="color:#8a8d90">— ${dateFr(done.at)} (${esc(done.by || "")})</span>` : ""}</li>`;
  }).join("");
  const body = `
    ${header({ ...factory }, "Fiche technique de fabrication", [
      `<strong>N° ${esc(order.number || "(brouillon)")}</strong>`,
      `${esc(project.reference)}`,
      `Statut : ${esc(STATUS_LABELS[order.status] || "")}`,
      `Semaine : ${esc(order.deliveryWeek || project.deliveryWeek || "—")}`,
    ])}
    ${infoBlocks("Matériau", `<p>${esc(materialLabel)}</p><p style="color:#8a8d90">Plaque maxi : ${variant ? `${variant.maxLengthMm} × ${variant.maxWidthMm} mm` : "—"}</p>`, project)}
    ${overviewPage(project)}
    ${technicalPages(project, catalog)}
    <h2 class="remarks">Étapes de fabrication</h2><ul style="list-style:none;padding:0;font-size:13px">${steps}</ul>
    ${closingSection(project, { ...factory }, { signatures: [] })}`;
  return page(`Fiche technique ${order.number || project.reference}`, body);
}
