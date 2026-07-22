// Éditeur « Modifier découpes & chants » d'une pièce : chants par côté,
// angles, découpes (évier, cuisson, robinet, égouttoir…) et assistant
// d'encastrement par marque + référence.

import { state, currentProject } from "../state.js";
import { request } from "../api.js";
import { esc, number, toast, showModal, closeModal } from "../ui.js";
import { register } from "../actions.js";
import { makeCutout, cutoutFromAppliance } from "/shared/plan.js";
import { saveProject } from "./index.js";

let selectedCutId = null;

const edgeServices = () => state.data.catalog.services.filter((s) => s.category === "edge" && s.active);
const cutLibrary = [
  { kind: "sink", icon: "▢", label: "Évier" },
  { kind: "hob", icon: "▦", label: "Cuisson" },
  { kind: "tap", icon: "◦", label: "Robinet" },
  { kind: "socket", icon: "◎", label: "Prise" },
  { kind: "drainer", icon: "≣", label: "Égouttoir" },
  { kind: "notch", icon: "⌐", label: "Encoche" },
  { kind: "custom", icon: "✚", label: "Libre" },
];

function getPiece() {
  const project = currentProject();
  return project?.pieces.find((p) => p.id === state.configurator?.detailPieceId);
}

function detailSvg(piece) {
  const viewW = 760;
  const scale = Math.min(viewW / piece.lengthMm, 380 / piece.widthMm);
  const w = piece.lengthMm * scale;
  const h = piece.widthMm * scale;
  const ox = (viewW - w) / 2;
  const oy = 30;
  const cuts = (piece.cutouts || []).map((cut) => {
    const x = ox + cut.xMm * scale;
    const y = oy + cut.yMm * scale;
    const cw = Math.max(4, cut.widthMm * scale);
    const ch = Math.max(4, cut.heightMm * scale);
    const active = cut.id === selectedCutId;
    const stroke = active ? "#c75b39" : "#8a4a33";
    let shape;
    if (cut.shape === "circle") shape = `<circle cx="${x + cw / 2}" cy="${y + ch / 2}" r="${cw / 2}" fill="rgba(199,91,57,.08)" stroke="${stroke}" stroke-width="${active ? 3 : 2}"/>`;
    else if (cut.shape === "grooves") {
      const grooves = Math.max(2, Number(cut.grooves || 5));
      let lines = "";
      for (let i = 0; i < grooves; i += 1) lines += `<line x1="${x}" y1="${y + ch / (grooves - 1) * i}" x2="${x + cw}" y2="${y + ch / (grooves - 1) * i}" stroke="${stroke}" stroke-width="2"/>`;
      shape = `${lines}<rect x="${x}" y="${y}" width="${cw}" height="${ch}" fill="transparent" stroke="${active ? stroke : "transparent"}" stroke-dasharray="4 3"/>`;
    } else shape = `<rect x="${x}" y="${y}" width="${cw}" height="${ch}" rx="${(cut.radiusMm || 0) * scale}" fill="rgba(199,91,57,.08)" stroke="${stroke}" stroke-width="${active ? 3 : 2}"/>`;
    const label = [cut.brand, cut.reference].filter(Boolean).join(" ") || cut.kind;
    return `<g class="svg-cut" data-detail-cut="${cut.id}" style="cursor:pointer">${shape}
      <text x="${x + 3}" y="${y - 4}" font-size="11" fill="#6c4a3a">${esc(label)}${cut.verified ? " ✓" : ""}</text></g>`;
  }).join("");

  const edgeLines = (piece.edges || []).map((edge) => {
    const points = edge.side === "top" ? [ox, oy, ox + w, oy]
      : edge.side === "bottom" ? [ox, oy + h, ox + w, oy + h]
      : edge.side === "left" ? [ox, oy, ox, oy + h] : [ox + w, oy, ox + w, oy + h];
    return `<line x1="${points[0]}" y1="${points[1]}" x2="${points[2]}" y2="${points[3]}" stroke="#2e7d5b" stroke-width="5" stroke-linecap="round" opacity=".8"/>`;
  }).join("");

  const cornerMarkers = ["topLeft", "topRight", "bottomLeft", "bottomRight"].map((key) => {
    const cx = key.includes("Left") ? ox : ox + w;
    const cy = key.includes("top") ? oy : oy + h;
    const corner = piece.corners?.[key];
    const active = corner && corner.type && corner.type !== "square";
    return `<circle cx="${cx}" cy="${cy}" r="9" fill="${active ? "#c75b39" : "#fff"}" stroke="#20231f" stroke-width="1.5"
      class="corner-marker" data-detail-corner="${key}" style="cursor:pointer"><title>${key}</title></circle>`;
  }).join("");

  return `<svg class="detail-canvas" viewBox="0 0 ${viewW} ${oy * 2 + h + 40}" width="100%">
    <rect x="${ox}" y="${oy}" width="${w}" height="${h}" rx="4" fill="#d9c9b6" stroke="#20231f" stroke-width="2"/>
    ${edgeLines}${cuts}${cornerMarkers}
    <text x="${ox + w / 2 - 40}" y="${oy + h + 26}" font-size="12" fill="#40433e">${number(piece.lengthMm)} mm</text>
    <text x="${ox - 24}" y="${oy + h / 2}" font-size="12" fill="#40433e" transform="rotate(-90 ${ox - 20} ${oy + h / 2})">${number(piece.widthMm)} mm</text>
    <text x="${ox}" y="${oy + h + 26}" font-size="11" fill="#8a8d86">chant avant en bas</text>
  </svg>`;
}

function edgeEditor(piece) {
  const sides = [["bottom", "Chant avant"], ["top", "Chant arrière"], ["left", "Chant gauche"], ["right", "Chant droit"]];
  return `<div class="edge-grid">
    ${sides.map(([side, label]) => {
      const edge = (piece.edges || []).find((e) => e.side === side);
      const sideLength = ["top", "bottom"].includes(side) ? piece.lengthMm : piece.widthMm;
      return `<div class="edge-row">
        <strong>${label}</strong>
        <select data-edge-side="${side}">
          <option value="">Brut (non travaillé)</option>
          ${edgeServices().map((s) => `<option value="${s.id}" ${edge?.serviceId === s.id ? "selected" : ""}>${esc(s.label)}</option>`).join("")}
        </select>
        <input type="number" data-edge-length="${side}" min="0" max="${sideLength}" value="${esc(edge?.lengthMm ?? sideLength)}" ${edge ? "" : "disabled"} title="Longueur travaillée en mm">
      </div>`;
    }).join("")}
  </div><p class="help corner-help">La longueur permet un chant partiel (départ côté gauche/haut).</p>`;
}

function cornerEditor(piece) {
  const corners = { topLeft: "Haut gauche", topRight: "Haut droit", bottomLeft: "Bas gauche", bottomRight: "Bas droit" };
  return `<div class="edge-grid">
    ${Object.entries(corners).map(([key, label]) => {
      const corner = piece.corners?.[key] || { type: "square" };
      return `<div class="edge-row">
        <strong>${label}</strong>
        <select data-corner="${key}">
          <option value="square" ${!corner.type || corner.type === "square" ? "selected" : ""}>Angle droit</option>
          <option value="round" ${corner.type === "round" ? "selected" : ""}>Extrémité arrondie</option>
          <option value="cut" ${corner.type === "cut" ? "selected" : ""}>Pan coupé</option>
          <option value="notch90" ${corner.type === "notch90" ? "selected" : ""}>Découpe 90°</option>
        </select>
        <input type="number" data-corner-value="${key}" min="0" value="${esc(corner.type === "cut" ? corner.cutMm || 40 : corner.radiusMm || 40)}" ${corner.type && corner.type !== "square" ? "" : "disabled"} title="Rayon ou pan en mm">
      </div>`;
    }).join("")}
  </div>`;
}

function cutFields(piece, cut) {
  if (!cut) return `<div class="empty" style="padding:16px"><p>Sélectionnez une découpe sur le dessin ou ajoutez-en une.</p></div>`;
  const services = state.data.catalog.services.filter((s) => ["cutout", "drainer", "sink", "shape"].includes(s.category) && s.active);
  const frontDistance = piece.widthMm - (cut.yMm + cut.heightMm);
  const applianceSection = ["sink", "hob", "socket", "custom"].includes(cut.kind) ? `
    <div class="verification" style="margin-top:10px">
      <h4>Assistant d'encastrement</h4>
      <div class="form-grid">
        <label>Marque<input data-cut-field="brand" value="${esc(cut.brand || "")}" placeholder="Franke, Bosch…" list="appliance-brands"></label>
        <label>Référence<input data-cut-field="reference" value="${esc(cut.reference || "")}" placeholder="Référence exacte de l'appareil"></label>
      </div>
      <datalist id="appliance-brands">${(state.data.appliances?.brands || []).map((b) => `<option>${esc(b)}</option>`).join("")}</datalist>
      <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">
        <button class="btn btn-small btn-soft" data-action="lookup-appliance">Rechercher les cotes d'encastrement</button>
        ${cut.verified ? `<span class="badge status-approved">● Cotes vérifiées base Marbexa</span>` : `<button class="btn btn-small btn-ghost" data-action="save-appliance">Enregistrer ces cotes dans la base</button>`}
      </div>
    </div>` : "";

  const dimensionFields = cut.shape === "circle"
    ? `<label>Diamètre (mm)<input type="number" data-cut-field="diameterMm" value="${esc(cut.diameterMm || cut.widthMm)}"></label>`
    : `<label>Largeur (mm)<input type="number" data-cut-field="widthMm" value="${esc(cut.widthMm)}"></label>
       <label>Profondeur (mm)<input type="number" data-cut-field="heightMm" value="${esc(cut.heightMm)}"></label>
       <label>Rayon d'angle (mm)<input type="number" data-cut-field="radiusMm" value="${esc(cut.radiusMm || 0)}"></label>`;

  return `
    <div class="form-grid">
      <label>Type d'usinage<select data-cut-field="serviceId">
        ${services.map((s) => `<option value="${s.id}" ${cut.serviceId === s.id ? "selected" : ""}>${esc(s.label)}</option>`).join("")}</select></label>
      ${dimensionFields}
      <label>X depuis la gauche (mm)<input type="number" data-cut-field="xMm" value="${esc(cut.xMm)}"></label>
      <label>Y depuis l'arrière (mm)<input type="number" data-cut-field="yMm" value="${esc(cut.yMm)}"></label>
      ${cut.shape === "grooves" ? `<label>Nombre de rainures<input type="number" min="2" max="12" data-cut-field="grooves" value="${esc(cut.grooves || 5)}"></label>` : ""}
    </div>
    <p class="help">Distance au chant avant : <strong>${number(frontDistance)} mm</strong>${["sink", "hob"].includes(cut.kind) ? ` (minimum conseillé ${cut.minFrontMm || 50} mm)` : ""}</p>
    ${applianceSection}
    <button class="btn btn-small btn-ghost btn-danger" style="margin-top:10px" data-action="delete-cut">Supprimer cette découpe</button>`;
}

export function renderDetailEditor() {
  const piece = getPiece();
  if (!piece) return "";
  const cut = (piece.cutouts || []).find((c) => c.id === selectedCutId) || null;
  return `
  <div class="modal-head"><div><h2>Découpes & chants · ${esc(piece.name || piece.kind)}</h2>
    <p>${number(piece.lengthMm)} × ${number(piece.widthMm)} mm · Y mesuré depuis le chant arrière</p></div>
    <button class="icon-btn" data-action="close-details">×</button></div>
  <div class="modal-body detail-layout" style="display:grid;grid-template-columns:1.4fr 1fr;gap:18px">
    <div>
      ${detailSvg(piece)}
      <div class="cut-library" style="display:flex;gap:7px;flex-wrap:wrap;margin-top:10px">
        ${cutLibrary.map((item) => `<button class="cut-option" data-action="add-cut" data-kind="${item.kind}"><span class="cut-icon">${item.icon}</span>${item.label}</button>`).join("")}
      </div>
      <h3 style="margin-top:16px">Chants travaillés</h3>
      ${edgeEditor(piece)}
      <h3 style="margin-top:14px">Angles</h3>
      ${cornerEditor(piece)}
    </div>
    <div>
      <h3>Découpe sélectionnée</h3>
      ${cutFields(piece, cut)}
    </div>
  </div>
  <div class="modal-actions"><button class="btn btn-primary" data-action="close-details">Terminé</button></div>`;
}

export function openDetailEditor(pieceId) {
  state.configurator.detailPieceId = pieceId;
  selectedCutId = null;
  showModal(renderDetailEditor(), true);
}

function rerender() {
  showModal(renderDetailEditor(), true);
}

// ---------- Champs ----------

export function handleDetailField(input) {
  const piece = getPiece();
  if (!piece) return false;

  if (input.dataset.edgeSide !== undefined) {
    const side = input.dataset.edgeSide;
    piece.edges = (piece.edges || []).filter((e) => e.side !== side);
    if (input.value) {
      const sideLength = ["top", "bottom"].includes(side) ? piece.lengthMm : piece.widthMm;
      piece.edges.push({ side, serviceId: input.value, lengthMm: sideLength, startFrom: side === "right" ? "top" : "left" });
    }
    saveProject(); rerender(); return true;
  }
  if (input.dataset.edgeLength !== undefined) {
    const edge = (piece.edges || []).find((e) => e.side === input.dataset.edgeLength);
    if (edge) { edge.lengthMm = Math.max(0, Number(input.value)); saveProject(); }
    return true;
  }
  if (input.dataset.corner !== undefined) {
    piece.corners = piece.corners || {};
    const key = input.dataset.corner;
    if (input.value === "square") delete piece.corners[key];
    else if (input.value === "round") piece.corners[key] = { type: "round", radiusMm: Number(piece.corners[key]?.radiusMm || 40) };
    else piece.corners[key] = { type: input.value, cutMm: Number(piece.corners[key]?.cutMm || 40) };
    saveProject(); rerender(); return true;
  }
  if (input.dataset.cornerValue !== undefined) {
    const corner = piece.corners?.[input.dataset.cornerValue];
    if (corner) {
      if (corner.type === "round") corner.radiusMm = Number(input.value);
      else corner.cutMm = Number(input.value);
      saveProject();
    }
    return true;
  }
  if (input.dataset.cutField !== undefined) {
    const cut = (piece.cutouts || []).find((c) => c.id === selectedCutId);
    if (!cut) return true;
    const field = input.dataset.cutField;
    const numeric = ["xMm", "yMm", "widthMm", "heightMm", "radiusMm", "diameterMm", "grooves"];
    cut[field] = numeric.includes(field) ? Number(input.value) : input.value;
    if (field === "diameterMm") { cut.widthMm = cut.diameterMm; cut.heightMm = cut.diameterMm; }
    if (["brand", "reference", "widthMm", "heightMm", "diameterMm"].includes(field)) cut.verified = false;
    saveProject();
    if (["serviceId", "widthMm", "heightMm", "diameterMm", "xMm", "yMm", "grooves", "radiusMm"].includes(field)) rerender();
    return true;
  }
  return false;
}

export function handleDetailClick(target) {
  const cutEl = target.closest("[data-detail-cut]");
  if (cutEl) { selectedCutId = cutEl.dataset.detailCut; rerender(); return true; }
  const cornerEl = target.closest("[data-detail-corner]");
  if (cornerEl) {
    const piece = getPiece();
    const key = cornerEl.dataset.detailCorner;
    piece.corners = piece.corners || {};
    // Clic sur un repère d'angle : droit → arrondi → pan coupé → découpe 90° → droit.
    const current = piece.corners[key]?.type || "square";
    if (current === "square") piece.corners[key] = { type: "round", radiusMm: 40 };
    else if (current === "round") piece.corners[key] = { type: "cut", cutMm: 40 };
    else if (current === "cut") piece.corners[key] = { type: "notch90", cutMm: 40 };
    else delete piece.corners[key];
    saveProject(); rerender(); return true;
  }
  return false;
}

register({
  "close-details": () => {
    state.configurator.detailPieceId = null;
    closeModal();
    window.dispatchEvent(new Event("marbexa:render"));
  },
  "add-cut": (el) => {
    const piece = getPiece();
    if (!piece) return;
    if (piece.kind === "splashback" && ["sink", "hob", "tap", "drainer"].includes(el.dataset.kind)) {
      toast("Les découpes cuisson, évier, robinet et égouttoir sont réservées aux plans de travail.", "error");
      return;
    }
    const cut = makeCutout(el.dataset.kind, {
      xMm: Math.round(piece.lengthMm / 2 - 200),
      yMm: Math.max(40, Math.round(piece.widthMm / 2 - 200)),
    });
    piece.cutouts = piece.cutouts || [];
    piece.cutouts.push(cut);
    selectedCutId = cut.id;
    saveProject(); rerender();
  },
  "delete-cut": () => {
    const piece = getPiece();
    piece.cutouts = (piece.cutouts || []).filter((c) => c.id !== selectedCutId);
    selectedCutId = null;
    saveProject(); rerender();
  },
  "lookup-appliance": async () => {
    const piece = getPiece();
    const cut = (piece?.cutouts || []).find((c) => c.id === selectedCutId);
    if (!cut) return;
    const brand = document.querySelector("[data-cut-field=brand]")?.value || "";
    const reference = document.querySelector("[data-cut-field=reference]")?.value || "";
    if (!reference.trim()) { toast("Renseignez la référence de l'appareil.", "error"); return; }
    try {
      const result = await request("/api/appliance-lookup", { body: { brand, reference } });
      if (result.found) {
        const proposal = cutoutFromAppliance(result.appliance, cut.mounting);
        Object.assign(cut, {
          widthMm: proposal.widthMm, heightMm: proposal.heightMm, radiusMm: proposal.radiusMm,
          brand: result.appliance.brand, reference: result.appliance.reference,
          serviceId: proposal.serviceId, minFrontMm: proposal.minFrontMm, verified: true,
          applianceId: result.appliance.id,
        });
        saveProject(); rerender();
        toast(`Cotes trouvées : découpe ${proposal.widthMm} × ${proposal.heightMm} mm. ${result.note || ""}`);
      } else {
        toast(result.message, "error");
        if (result.suggestions?.length) {
          toast(`Suggestions ${brand ? `pour ${brand}` : ""} : ${result.suggestions.map((s) => s.reference).join(", ")}`, "success");
        }
      }
    } catch (error) { toast(error.message, "error"); }
  },
  "save-appliance": async () => {
    const piece = getPiece();
    const cut = (piece?.cutouts || []).find((c) => c.id === selectedCutId);
    if (!cut) return;
    if (!cut.brand || !cut.reference) { toast("Renseignez la marque et la référence avant d'enregistrer.", "error"); return; }
    try {
      const result = await request("/api/appliances", {
        body: {
          type: cut.kind === "hob" ? "hob" : "sink",
          brand: cut.brand, reference: cut.reference,
          cutoutWidthMm: cut.widthMm, cutoutDepthMm: cut.heightMm,
          cornerRadiusMm: cut.radiusMm, minFrontMm: cut.minFrontMm || 50,
        },
      });
      cut.verified = true;
      cut.applianceId = result.appliance.id;
      saveProject(); rerender();
      toast("Cotes enregistrées dans la base d'encastrement.");
    } catch (error) { toast(error.message, "error"); }
  },
});
