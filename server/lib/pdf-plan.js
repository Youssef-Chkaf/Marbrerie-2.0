// Moteur IA Marbexa — analyse de PDF vectoriels.
// Un plan PDF n'a pas d'échelle fiable : le moteur extrait les tracés vectoriels
// (rectangles, polylignes) et les textes de cotation, puis cherche l'échelle qui
// rend les pièces plausibles et cohérentes avec les cotes écrites. Tout ce qui
// est déduit est marqué « à vérifier » : le brouillon n'est jamais un ordre de
// fabrication.

import zlib from "node:zlib";

function inflateStreams(buffer) {
  const chunks = [];
  const marker = Buffer.from("stream");
  let index = 0;
  while ((index = buffer.indexOf(marker, index)) !== -1) {
    let start = index + marker.length;
    if (buffer[start] === 0x0d) start += 1;
    if (buffer[start] === 0x0a) start += 1;
    const end = buffer.indexOf(Buffer.from("endstream"), start);
    if (end === -1) break;
    const raw = buffer.subarray(start, end);
    try {
      chunks.push(zlib.inflateSync(raw).toString("latin1"));
    } catch {
      // Flux non compressé ou filtre non géré : tenté en clair.
      const text = raw.toString("latin1");
      if (/[a-zA-Z]/.test(text)) chunks.push(text);
    }
    index = end;
  }
  return chunks;
}

// Interprète les opérateurs de tracé d'un flux de contenu PDF.
function parseContent(content) {
  const rects = [];
  const paths = [];
  const texts = [];
  let current = [];
  const stack = [];
  const tokens = content.match(/\((?:\\.|[^\\()])*\)|<[0-9A-Fa-f\s]+>|[-.0-9]+|[A-Za-z'"*]+|\[|\]/g) || [];
  // Matrice de transformation courante (a b c d e f).
  let ctm = [1, 0, 0, 1, 0, 0];
  const apply = (x, y) => [ctm[0] * x + ctm[2] * y + ctm[4], ctm[1] * x + ctm[3] * y + ctm[5]];
  const numbersBefore = (i, count) => tokens.slice(Math.max(0, i - count), i).map(Number);

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token === "q") stack.push([...ctm]);
    else if (token === "Q") ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
    else if (token === "cm") {
      const [a, b, c, d, e, f] = numbersBefore(i, 6);
      if (![a, b, c, d, e, f].some(Number.isNaN)) {
        ctm = [
          a * ctm[0] + b * ctm[2], a * ctm[1] + b * ctm[3],
          c * ctm[0] + d * ctm[2], c * ctm[1] + d * ctm[3],
          e * ctm[0] + f * ctm[2] + ctm[4], e * ctm[1] + f * ctm[3] + ctm[5],
        ];
      }
    } else if (token === "re") {
      const [x, y, w, h] = numbersBefore(i, 4);
      if (![x, y, w, h].some(Number.isNaN)) {
        const [x1, y1] = apply(x, y);
        const [x2, y2] = apply(x + w, y + h);
        rects.push({ x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) });
      }
    } else if (token === "m") {
      const [x, y] = numbersBefore(i, 2);
      current = [apply(x, y)];
    } else if (token === "l") {
      const [x, y] = numbersBefore(i, 2);
      current.push(apply(x, y));
    } else if (token === "h" || token === "f" || token === "s" || token === "S" || token === "b" || token === "B") {
      if (current.length >= 3) paths.push(current);
      if (token !== "h") current = [];
    } else if (token.startsWith("(")) {
      texts.push(token.slice(1, -1).replace(/\\([()\\])/g, "$1"));
    }
  }
  if (current.length >= 3) paths.push(current);
  return { rects, paths, texts };
}

const plausibleWorktop = (lengthMm, widthMm) =>
  lengthMm >= 600 && lengthMm <= 4200 && widthMm >= 300 && widthMm <= 1300;

// Cherche l'échelle (mm par unité PDF) qui maximise la vraisemblance.
function findScale(candidateRects, dimensionTexts) {
  const scales = [0.3528, 1, 2, 2.5, 3.5278, 5, 7.0556, 10, 17.639, 20, 35.278, 50];
  const numbers = dimensionTexts
    .flatMap((t) => (t.match(/\d{3,4}/g) || []).map(Number))
    .filter((n) => n >= 200 && n <= 4200);
  let best = { scale: 1, score: -1 };
  for (const scale of scales) {
    let score = 0;
    for (const rect of candidateRects) {
      const L = rect.w * scale;
      const W = rect.h * scale;
      if (plausibleWorktop(Math.max(L, W), Math.min(L, W))) score += 2;
      // Bonus si une cote écrite correspond à ±2 % près.
      for (const n of numbers) {
        if (Math.abs(L - n) / n < 0.02 || Math.abs(W - n) / n < 0.02) score += 3;
      }
    }
    if (score > best.score) best = { scale, score };
  }
  return best;
}

export function parsePdfPlan(buffer) {
  const issues = [];
  const streams = inflateStreams(buffer);
  if (!streams.length) {
    return {
      pieces: [],
      issues: ["Ce PDF ne contient aucun tracé vectoriel lisible (probablement un scan). Utilisez un export PDF vectoriel ou un DXF 2D, ou passez en conception manuelle."],
      texts: [],
    };
  }
  const rects = [];
  const paths = [];
  const texts = [];
  for (const stream of streams) {
    const parsed = parseContent(stream);
    rects.push(...parsed.rects);
    paths.push(...parsed.paths);
    texts.push(...parsed.texts);
  }

  // Polylignes fermées converties en boîtes candidates.
  for (const path of paths) {
    const xs = path.map((p) => p[0]);
    const ys = path.map((p) => p[1]);
    const w = Math.max(...xs) - Math.min(...xs);
    const h = Math.max(...ys) - Math.min(...ys);
    if (w > 4 && h > 4) rects.push({ x: Math.min(...xs), y: Math.min(...ys), w, h, fromPath: true });
  }

  const big = rects.filter((r) => r.w > 20 && r.h > 8);
  if (!big.length) {
    return { pieces: [], issues: ["Aucun rectangle exploitable dans ce PDF. Essayez un DXF 2D ou la conception manuelle."], texts };
  }

  const { scale, score } = findScale(big, texts);
  if (score <= 0) issues.push("Échelle incertaine : les dimensions proposées sont des estimations à corriger.");
  else issues.push(`Échelle estimée : 1 unité PDF = ${scale} mm (à contrôler sur chaque cote).`);

  // Grandes formes = pièces ; formes contenues = découpes.
  const scaled = big.map((r) => ({ ...r, L: Math.round(r.w * scale), W: Math.round(r.h * scale) }))
    .filter((r) => r.L >= 150 && r.W >= 60 && r.L <= 6000 && r.W <= 3000);
  scaled.sort((a, b) => b.L * b.W - a.L * a.W);

  const pieces = [];
  const used = new Set();
  for (const rect of scaled) {
    if (used.has(rect)) continue;
    if (!plausibleWorktop(Math.max(rect.L, rect.W), Math.min(rect.L, rect.W)) && pieces.length) continue;
    const piece = {
      kind: rect.W < 480 ? "splashback" : "worktop",
      name: "",
      lengthMm: rect.L,
      widthMm: rect.W,
      cutouts: [],
      needsReview: true,
    };
    for (const inner of scaled) {
      if (inner === rect || used.has(inner)) continue;
      const contained = inner.x >= rect.x - 1 && inner.y >= rect.y - 1
        && inner.x + inner.w <= rect.x + rect.w + 1 && inner.y + inner.h <= rect.y + rect.h + 1
        && inner.w * inner.h < rect.w * rect.h * 0.85;
      if (!contained) continue;
      used.add(inner);
      const guessed = inner.L >= 500 && inner.W >= 380 && inner.W <= 540 ? "hob" : inner.L >= 300 && inner.W >= 300 ? "sink" : "notch";
      piece.cutouts.push({
        kind: guessed,
        shape: "rounded",
        serviceId: guessed === "hob" ? "cut-rough" : guessed === "sink" ? "cut-polished" : "cut-inside",
        xMm: Math.round((inner.x - rect.x) * scale),
        yMm: Math.round((rect.y + rect.h - inner.y - inner.h) * scale),
        widthMm: inner.L,
        heightMm: inner.W,
        radiusMm: 10,
        verified: false,
      });
    }
    used.add(rect);
    pieces.push(piece);
    if (pieces.length >= 8) { issues.push("Plus de 8 contours détectés : seuls les 8 plus grands ont été convertis."); break; }
  }

  if (!pieces.length) issues.push("Aucune pièce plausible après mise à l'échelle : corrigez manuellement ou fournissez un DXF.");
  issues.push("Brouillon proposé par le moteur IA Marbexa : contrôlez chaque cote, axe et rayon avant l'envoi en fabrication.");
  return { pieces, issues, texts };
}
