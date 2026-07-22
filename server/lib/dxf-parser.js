// Import DXF 2D : lit les entités (LWPOLYLINE, POLYLINE, LINE, CIRCLE, ARC,
// TEXT/MTEXT), reconstitue les contours fermés et propose des pièces éditables
// avec leurs découpes. Les éléments ambigus sont signalés dans `issues`.

function parsePairs(text) {
  const lines = text.split(/\r\n|\r|\n/);
  const pairs = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = Number(lines[i].trim());
    if (Number.isNaN(code)) continue;
    pairs.push([code, lines[i + 1].trim()]);
  }
  return pairs;
}

function extractEntities(pairs) {
  const entities = [];
  let inEntities = false;
  let current = null;
  for (let i = 0; i < pairs.length; i += 1) {
    const [code, value] = pairs[i];
    if (code === 0 && value === "SECTION" && pairs[i + 1]?.[0] === 2 && pairs[i + 1]?.[1] === "ENTITIES") {
      inEntities = true;
      continue;
    }
    if (code === 0 && value === "ENDSEC") { inEntities = false; current = null; continue; }
    if (!inEntities) continue;
    if (code === 0) {
      current = { type: value, codes: [] };
      entities.push(current);
    } else if (current) {
      current.codes.push([code, value]);
    }
  }
  return entities;
}

const num = (value) => Number(String(value).replace(",", "."));

function entityGeometry(entity) {
  const get = (code) => entity.codes.filter(([c]) => c === code).map(([, v]) => num(v));
  const getStr = (code) => entity.codes.find(([c]) => c === code)?.[1] || "";
  switch (entity.type) {
    case "LINE":
      return { type: "line", x1: get(10)[0], y1: get(20)[0], x2: get(11)[0], y2: get(21)[0], layer: getStr(8) };
    case "CIRCLE":
      return { type: "circle", cx: get(10)[0], cy: get(20)[0], r: get(40)[0], layer: getStr(8) };
    case "ARC":
      return { type: "arc", cx: get(10)[0], cy: get(20)[0], r: get(40)[0], start: get(50)[0], end: get(51)[0], layer: getStr(8) };
    case "LWPOLYLINE": {
      const xs = get(10); const ys = get(20);
      const closed = (get(70)[0] || 0) & 1;
      return { type: "poly", points: xs.map((x, i) => [x, ys[i]]), closed: Boolean(closed), layer: getStr(8) };
    }
    case "POLYLINE":
      return { type: "polyline-start", closed: Boolean((get(70)[0] || 0) & 1), layer: getStr(8) };
    case "VERTEX":
      return { type: "vertex", x: get(10)[0], y: get(20)[0] };
    case "SEQEND":
      return { type: "seqend" };
    case "TEXT":
    case "MTEXT":
      return { type: "text", x: get(10)[0], y: get(20)[0], value: getStr(1), layer: getStr(8) };
    default:
      return null;
  }
}

function collectShapes(entities) {
  const shapes = [];
  let pendingPoly = null;
  for (const entity of entities) {
    const geo = entityGeometry(entity);
    if (!geo) continue;
    if (geo.type === "polyline-start") { pendingPoly = { type: "poly", points: [], closed: geo.closed, layer: geo.layer }; continue; }
    if (geo.type === "vertex" && pendingPoly) { pendingPoly.points.push([geo.x, geo.y]); continue; }
    if (geo.type === "seqend") { if (pendingPoly?.points.length) shapes.push(pendingPoly); pendingPoly = null; continue; }
    shapes.push(geo);
  }
  return shapes;
}

// Assemble les LINE isolées en boucles fermées (tolérance 1 mm).
function linesToLoops(lines) {
  const tolerance = 1;
  const remaining = [...lines];
  const loops = [];
  while (remaining.length) {
    const chain = [remaining.shift()];
    const points = [[chain[0].x1, chain[0].y1], [chain[0].x2, chain[0].y2]];
    let extended = true;
    while (extended) {
      extended = false;
      const tail = points[points.length - 1];
      for (let i = 0; i < remaining.length; i += 1) {
        const seg = remaining[i];
        if (Math.hypot(seg.x1 - tail[0], seg.y1 - tail[1]) < tolerance) {
          points.push([seg.x2, seg.y2]); remaining.splice(i, 1); extended = true; break;
        }
        if (Math.hypot(seg.x2 - tail[0], seg.y2 - tail[1]) < tolerance) {
          points.push([seg.x1, seg.y1]); remaining.splice(i, 1); extended = true; break;
        }
      }
    }
    const first = points[0];
    const last = points[points.length - 1];
    loops.push({ points, closed: Math.hypot(first[0] - last[0], first[1] - last[1]) < tolerance });
  }
  return loops;
}

const bounds = (points) => {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
};

const inside = (inner, outer) =>
  inner.minX >= outer.minX - 1 && inner.maxX <= outer.maxX + 1 && inner.minY >= outer.minY - 1 && inner.maxY <= outer.maxY + 1
  && (inner.maxX - inner.minX) < (outer.maxX - outer.minX) - 1;

// Analyse principale : retourne { pieces, issues, texts }.
export function parseDxfPlan(text) {
  const issues = [];
  const shapes = collectShapes(extractEntities(parsePairs(text)));
  if (!shapes.length) return { pieces: [], issues: ["Aucune entité 2D lisible dans ce DXF."], texts: [] };

  const polys = shapes.filter((s) => s.type === "poly" && s.points.length >= 3);
  const lines = shapes.filter((s) => s.type === "line");
  const circles = shapes.filter((s) => s.type === "circle");
  const texts = shapes.filter((s) => s.type === "text").map((t) => t.value).filter(Boolean);

  const loops = [
    ...polys.map((p) => ({ points: p.points, closed: p.closed || true, layer: p.layer })),
    ...linesToLoops(lines).filter((l) => l.closed && l.points.length >= 4),
  ];

  // Heuristique d'unité : si tout tient dans 5 unités, le fichier est en mètres ;
  // dans 400, en centimètres. Marbexa travaille en millimètres.
  const allBounds = loops.length ? bounds(loops.flatMap((l) => l.points)) : null;
  let unitScale = 1;
  if (allBounds) {
    const span = Math.max(allBounds.maxX - allBounds.minX, allBounds.maxY - allBounds.minY);
    if (span > 0 && span < 6) { unitScale = 1000; issues.push("Unités détectées : mètres (converties en millimètres)."); }
    else if (span >= 6 && span < 420) { unitScale = 10; issues.push("Unités détectées : centimètres (converties en millimètres)."); }
  }
  const scalePoint = ([x, y]) => [x * unitScale, y * unitScale];
  for (const loop of loops) loop.points = loop.points.map(scalePoint);
  for (const circle of circles) { circle.cx *= unitScale; circle.cy *= unitScale; circle.r *= unitScale; }

  const loopBoxes = loops.map((loop) => ({ loop, box: bounds(loop.points) }));
  // Les contours qui ne contiennent personne et sont contenus par un autre = découpes.
  const outers = loopBoxes.filter(({ box }) => !loopBoxes.some((other) => other.box !== box && inside(box, other.box)));
  const pieces = [];

  for (const { loop, box } of outers) {
    const lengthMm = Math.round(box.maxX - box.minX);
    const widthMm = Math.round(box.maxY - box.minY);
    if (lengthMm < 120 || widthMm < 80) {
      issues.push(`Contour ${lengthMm} × ${widthMm} mm ignoré (trop petit pour une pièce).`);
      continue;
    }
    const isRectangle = loop.points.length <= 6;
    if (!isRectangle) {
      issues.push(`Un contour de ${loop.points.length} sommets a été simplifié en rectangle ${lengthMm} × ${widthMm} mm — vérifiez la forme réelle.`);
    }
    const kind = widthMm <= 620 && widthMm >= 480 && lengthMm > 800 ? "worktop" : widthMm < 480 ? "splashback" : "worktop";
    const piece = {
      kind,
      name: "",
      lengthMm,
      widthMm,
      cutouts: [],
      needsReview: !isRectangle,
    };

    // Découpes : contours fermés et cercles à l'intérieur.
    for (const { loop: innerLoop, box: innerBox } of loopBoxes) {
      if (innerLoop === loop || !inside(innerBox, box)) continue;
      const cw = Math.round(innerBox.maxX - innerBox.minX);
      const ch = Math.round(innerBox.maxY - innerBox.minY);
      const guessedKind = cw >= 500 && cw <= 900 && ch >= 380 && ch <= 520 ? "hob" : cw >= 300 && ch >= 300 ? "sink" : "notch";
      piece.cutouts.push({
        kind: guessedKind,
        shape: "rounded",
        serviceId: guessedKind === "hob" ? "cut-rough" : guessedKind === "sink" ? "cut-polished" : "cut-inside",
        xMm: Math.round(innerBox.minX - box.minX),
        yMm: Math.round(box.maxY - innerBox.maxY),
        widthMm: cw,
        heightMm: ch,
        radiusMm: 10,
        verified: false,
      });
    }
    for (const circle of circles) {
      if (circle.cx < box.minX || circle.cx > box.maxX || circle.cy < box.minY || circle.cy > box.maxY) continue;
      const diameter = Math.round(circle.r * 2);
      if (diameter > 120) { issues.push(`Cercle Ø${diameter} mm ignoré (trop grand pour un perçage).`); continue; }
      piece.cutouts.push({
        kind: diameter >= 60 ? "socket" : "tap",
        shape: "circle",
        serviceId: "cut-tap",
        xMm: Math.round(circle.cx - circle.r - box.minX),
        yMm: Math.round(box.maxY - circle.cy - circle.r),
        widthMm: diameter,
        heightMm: diameter,
        diameterMm: diameter,
        verified: false,
      });
    }
    pieces.push(piece);
  }

  if (!pieces.length) issues.push("Aucun contour fermé exploitable : dessinez les pièces en polylignes fermées puis réessayez.");
  return { pieces, issues, texts };
}
