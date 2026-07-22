// API Marbexa. Toutes les routes /api/* ainsi que /print/* et les exports DXF.

import { randomBytes } from "node:crypto";
import { computeQuote, deliveryForDistance } from "../shared/pricing.js";
import { validateProject } from "../shared/plan.js";
import { STATUS_LABELS, ORDER_TRANSITIONS, PRODUCTION_STEPS, isoWeekOf, addWeeksToIsoWeek } from "../shared/constants.js";
import { verifyPassword, hashPassword } from "./seed.js";
import { projectToDxf } from "./lib/dxf-writer.js";
import { parseDxfPlan } from "./lib/dxf-parser.js";
import { parsePdfPlan } from "./lib/pdf-plan.js";
import { quoteDocument, customerOrderDocument, factoryOrderDocument, technicalSheetDocument } from "./lib/documents.js";

const now = () => new Date().toISOString();
const makeId = (prefix) => `${prefix}-${randomBytes(9).toString("hex")}`;

export class Api {
  constructor(store) {
    this.store = store;
  }

  get db() { return this.store.data; }

  // ---------- Session ----------

  createSession(userId) {
    const token = randomBytes(24).toString("hex");
    this.db.sessions[token] = { userId, createdAt: now() };
    this.store.save();
    return token;
  }

  userFromRequest(req) {
    const auth = req.headers.authorization || "";
    let token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
    if (!token) {
      const cookie = req.headers.cookie || "";
      token = /(?:^|;\s*)marbexa_token=([a-f0-9]+)/.exec(cookie)?.[1] || null;
    }
    const session = token ? this.db.sessions[token] : null;
    if (!session) return null;
    const user = this.db.users.find((u) => u.id === session.userId && u.active);
    return user ? { user, token } : null;
  }

  // ---------- Aides ----------

  factoryOf(user) { return this.db.factories.find((f) => f.id === user.factoryId); }
  resellerOf(user) { return user.resellerId ? this.db.resellers.find((r) => r.id === user.resellerId) : null; }
  catalogOf(factoryId) { return this.db.catalogs[factoryId]; }

  visibleProjects(user) {
    return this.db.projects.filter((p) => p.factoryId === user.factoryId
      && (user.role === "factory" ? true : p.resellerId === user.resellerId));
  }

  visibleOrders(user) {
    return this.db.orders.filter((o) => o.factoryId === user.factoryId
      && (user.role === "factory" ? true : o.resellerId === user.resellerId));
  }

  notify(targetRole, factoryId, resellerId, title, body) {
    this.db.notifications.unshift({
      id: makeId("notif"), targetRole, factoryId, resellerId, title, body, read: false, createdAt: now(),
    });
    this.db.notifications = this.db.notifications.slice(0, 200);
  }

  nextReference(kind) {
    const year = new Date().getFullYear();
    const value = this.db.counters[kind] || 1;
    this.db.counters[kind] = value + 1;
    return kind === "order"
      ? `MBX-${year}-${String(value).padStart(5, "0")}`
      : `DEV-${year}-${String(value).padStart(4, "0")}`;
  }

  recomputeQuote(project) {
    const factory = this.db.factories.find((f) => f.id === project.factoryId);
    const groupIds = project.groupedOrderIds || [];
    // Snapshot : les prix sont figés au premier calcul et réutilisés à vie.
    // Changer un tarif catalogue n'affecte que les nouveaux devis.
    if (!project.priceSnapshot) project.priceSnapshot = {};
    let options = { snapshot: project.priceSnapshot };
    if (groupIds.length) {
      // Livraison groupée : un seul forfait (la distance la plus grande) partagé.
      const projects = [project, ...groupIds
        .map((orderId) => this.db.orders.find((o) => o.id === orderId))
        .filter(Boolean)
        .map((order) => this.db.projects.find((p) => p.id === order.projectId))
        .filter(Boolean)];
      const maxDistance = Math.max(...projects.map((p) => Number(p.deliveryDistanceKm || 0)));
      options = {
        snapshot: project.priceSnapshot,
        groupSize: projects.length,
        groupDeliveryTotal: deliveryForDistance(factory?.settings, maxDistance),
      };
    }
    project.quote = computeQuote(project, this.catalogOf(project.factoryId), factory?.settings, options);
    project.updatedAt = now();
  }

  // Le revendeur garde ses marges pour lui : l'usine ne voit que les montants usine.
  serializeProjectFor(role, project) {
    if (role !== "factory") return project;
    const clone = structuredClone(project);
    delete clone.manualQuoteLines;
    if (clone.quote) {
      delete clone.quote.manualLines;
      clone.quote.lines = clone.quote.lines.map((line) => {
        const { customerUnitPrice, customerAmount, customerVatAmount, customerTTC, ...rest } = line;
        return rest;
      });
      for (const key of ["customerHT", "vatAmount", "vatBreakdown", "customerSubtotalTTC", "discountTTC", "discountMode", "discountValue", "customerTTC", "marginPct"]) {
        delete clone.quote[key];
      }
    }
    delete clone.marginPct;
    delete clone.commercialDiscount;
    return clone;
  }

  serializeOrderFor(role, order) {
    const project = this.db.projects.find((p) => p.id === order.projectId);
    const reseller = this.db.resellers.find((r) => r.id === order.resellerId);
    return {
      ...order,
      statusLabel: STATUS_LABELS[order.status] || order.status,
      project: project ? this.serializeProjectFor(role, project) : null,
      reseller: reseller ? { id: reseller.id, company: reseller.company, deliveryAddress: reseller.deliveryAddress, distanceKm: reseller.distanceKm } : null,
    };
  }

  stats(user, from, to) {
    const orders = this.visibleOrders(user).filter((o) => !["cancelled"].includes(o.status));
    const inRange = orders.filter((o) => (!from || o.createdAt >= from) && (!to || o.createdAt <= `${to}T23:59:59`));
    const amount = (o) => this.db.projects.find((p) => p.id === o.projectId)?.quote?.purchaseHT || 0;
    const active = inRange.filter((o) => !o.archived);
    const totalHT = active.reduce((sum, o) => sum + amount(o), 0);
    const delivered = inRange.filter((o) => ["shipped", "delivered"].includes(o.status)).length;
    const inProgress = active.filter((o) => !["delivered"].includes(o.status)).length;
    const materials = new Map();
    for (const order of inRange) {
      const project = this.db.projects.find((p) => p.id === order.projectId);
      const material = this.catalogOf(order.factoryId)?.materials.find((m) => m.id === project?.materialId);
      if (!material) continue;
      const key = `${material.brand} · ${material.color}`;
      materials.set(key, (materials.get(key) || 0) + amount(order));
    }
    const totalMat = [...materials.values()].reduce((a, b) => a + b, 0) || 1;
    const months = [];
    for (let i = 5; i >= 0; i -= 1) {
      const d = new Date(); d.setMonth(d.getMonth() - i, 1);
      const key = d.toISOString().slice(0, 7);
      months.push({
        month: key,
        label: d.toLocaleDateString("fr-FR", { month: "short" }),
        totalHT: Math.round(orders.filter((o) => o.createdAt.startsWith(key)).reduce((sum, o) => sum + amount(o), 0) * 100) / 100,
      });
    }
    return {
      totalHT: Math.round(totalHT * 100) / 100,
      delivered,
      inProgress,
      orderCount: inRange.length,
      average: inRange.length ? Math.round(totalHT / inRange.length * 100) / 100 : 0,
      topMaterials: [...materials.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
        .map(([label, value]) => ({ label, pct: Math.round(value / totalMat * 100) })),
      months,
    };
  }

  bootstrap(user) {
    const factory = this.factoryOf(user);
    const reseller = this.resellerOf(user);
    const role = user.role;
    return {
      user: { id: user.id, role, factoryId: user.factoryId, resellerId: user.resellerId, name: user.name, email: user.email },
      factory,
      reseller,
      resellers: role === "factory" ? this.db.resellers.filter((r) => r.factoryId === user.factoryId) : [],
      projects: this.visibleProjects(user).map((p) => this.serializeProjectFor(role, p)),
      orders: this.visibleOrders(user).map((o) => this.serializeOrderFor(role, o)),
      catalog: this.catalogOf(user.factoryId),
      notifications: this.db.notifications.filter((n) => n.factoryId === user.factoryId
        && n.targetRole === role && (role === "factory" || n.resellerId === user.resellerId)).slice(0, 30),
      stats: this.stats(user),
      appliances: { brands: [...new Set(this.db.appliances.map((a) => a.brand))].sort(), note: this.db.applianceNote },
      system: {
        version: this.db.version,
        statusLabels: STATUS_LABELS,
        productionSteps: PRODUCTION_STEPS,
        minimumDeliveryWeek: addWeeksToIsoWeek(isoWeekOf(), factory?.settings?.minLeadWeeks ?? 3),
        planAiEnabled: true,
        dxfImportEnabled: true,
        planAiModel: "Moteur IA Marbexa",
      },
    };
  }

  // ---------- Routage ----------

  async handle(req, res, url, body) {
    const send = (status, payload, headers = {}) => {
      const text = typeof payload === "string" ? payload : JSON.stringify(payload);
      res.writeHead(status, { "Content-Type": typeof payload === "string" ? "text/html; charset=utf-8" : "application/json; charset=utf-8", ...headers });
      res.end(text);
    };
    const fail = (status, message) => send(status, { error: message });

    const route = `${req.method} ${url.pathname}`;

    if (route === "POST /api/login") {
      const user = this.db.users.find((u) => u.email.toLowerCase() === String(body?.email || "").toLowerCase() && u.active);
      if (!user || !verifyPassword(String(body?.password || ""), user.password)) {
        return fail(401, "E-mail ou mot de passe incorrect.");
      }
      const token = this.createSession(user.id);
      return send(200, { token, ...this.bootstrap(user) }, {
        "Set-Cookie": `marbexa_token=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`,
      });
    }

    const auth = this.userFromRequest(req);
    if (!auth) return fail(401, "Session expirée, reconnectez-vous.");
    const { user } = auth;
    const role = user.role;

    if (route === "POST /api/logout") {
      delete this.db.sessions[auth.token];
      this.store.save();
      return send(200, { ok: true }, { "Set-Cookie": "marbexa_token=; Path=/; Max-Age=0" });
    }

    if (route === "GET /api/bootstrap") return send(200, this.bootstrap(user));

    // ---------- Projets ----------

    if (route === "POST /api/projects") {
      if (role !== "reseller") return fail(403, "Seul un revendeur crée des devis.");
      const reseller = this.resellerOf(user);
      const project = {
        id: makeId("project"),
        reference: this.nextReference("project"),
        factoryId: user.factoryId,
        resellerId: user.resellerId,
        title: String(body.title || "Nouveau projet"),
        roomType: body.roomType || "Cuisine",
        customer: { name: "", email: "", phone: "", address: "", ...(body.customer || {}) },
        materialId: body.materialId,
        thicknessMm: Number(body.thicknessMm || 20),
        finish: body.finish || "Poli",
        marginPct: Number(body.marginPct ?? reseller?.defaultMarginPct ?? 35),
        vatPct: Number(body.vatPct ?? reseller?.defaultVatPct ?? 20),
        manualQuoteLines: [],
        commercialDiscount: { mode: "percent", value: 0 },
        deliveryWeek: body.deliveryWeek || addWeeksToIsoWeek(isoWeekOf(), 3),
        deliveryDistanceKm: Number(reseller?.distanceKm || 0),
        consolidatedDelivery: false,
        groupedOrderIds: [],
        quoteDate: new Date().toISOString().slice(0, 10),
        validityDate: new Date(Date.now() + (reseller?.quoteValidityDays || 30) * 86400000).toISOString().slice(0, 10),
        customerOrderDate: new Date().toISOString().slice(0, 10),
        notes: body.notes || "",
        pieces: Array.isArray(body.pieces) ? body.pieces : [],
        priceSnapshot: {},
        importSource: body.importSource || null,
        status: "draft",
        archived: false,
        revision: 1,
        history: [{ at: now(), actor: user.name, event: body.importSource ? `Projet créé depuis ${body.importSource}` : "Projet créé" }],
        createdAt: now(),
        updatedAt: now(),
      };
      this.recomputeQuote(project);
      this.db.projects.push(project);
      this.store.save();
      return send(200, { project });
    }

    const projectMatch = url.pathname.match(/^\/api\/projects\/([^/]+)(?:\/(\w+))?$/);
    if (projectMatch) {
      const project = this.db.projects.find((p) => p.id === projectMatch[1]);
      if (!project || project.factoryId !== user.factoryId) return fail(404, "Projet introuvable.");
      if (role === "reseller" && project.resellerId !== user.resellerId) return fail(403, "Accès refusé.");
      const action = projectMatch[2];

      if (req.method === "GET" && !action) return send(200, { project: this.serializeProjectFor(role, project) });

      if (req.method === "PATCH" && !action) {
        const order = this.db.orders.find((o) => o.projectId === project.id && !["cancelled"].includes(o.status));
        const editableByFactory = role === "factory";
        const editableByReseller = role === "reseller" && (!order || ["changes_requested"].includes(order.status));
        if (!editableByFactory && !editableByReseller) {
          return fail(409, "Commande déjà envoyée : demandez une correction pour modifier le plan.");
        }
        const allowed = ["title", "roomType", "customer", "materialId", "thicknessMm", "finish", "marginPct", "vatPct",
          "manualQuoteLines", "commercialDiscount", "deliveryWeek", "deliveryDistanceKm", "notes", "pieces",
          "quoteDate", "validityDate", "customerOrderDate", "archived", "status"];
        for (const key of allowed) {
          if (key in body) project[key] = body[key];
        }
        if (body.historyEvent) project.history.push({ at: now(), actor: user.name, event: String(body.historyEvent) });
        this.recomputeQuote(project);
        if (order && body.pieces) {
          order.revision = (order.revision || 1) + 1;
          order.updatedAt = now();
        }
        this.store.save();
        return send(200, { project: this.serializeProjectFor(role, project), issues: validateProject(project, this.catalogOf(project.factoryId)) });
      }

      if (req.method === "DELETE" && !action) {
        if (this.db.orders.some((o) => o.projectId === project.id)) return fail(409, "Ce projet a déjà une commande : archivez-le plutôt.");
        this.db.projects = this.db.projects.filter((p) => p.id !== project.id);
        this.store.save();
        return send(200, { ok: true });
      }

      if (route.endsWith("/validate")) {
        return send(200, { issues: validateProject(project, this.catalogOf(project.factoryId)) });
      }

      if (route.endsWith("/submit")) {
        if (role !== "reseller") return fail(403, "Seul le revendeur envoie la commande.");
        if (this.db.orders.some((o) => o.projectId === project.id && o.status !== "cancelled")) {
          return fail(409, "Une commande existe déjà pour ce projet.");
        }
        const issues = validateProject(project, this.catalogOf(project.factoryId));
        const blocking = issues.filter((i) => i.includes("réservées aux plans de travail"));
        if (blocking.length) return fail(422, blocking[0]);
        this.recomputeQuote(project);
        const order = {
          id: makeId("order"),
          number: this.nextReference("order"),
          projectId: project.id,
          factoryId: project.factoryId,
          resellerId: project.resellerId,
          status: "factory_review",
          deliveryWeek: project.deliveryWeek,
          requestedDeliveryWeek: project.deliveryWeek,
          revision: 1,
          archived: false,
          comments: [],
          attachments: [],
          productionSteps: {},
          createdAt: now(),
          updatedAt: now(),
          submittedAt: now(),
          shippedAt: null,
          deliveredAt: null,
        };
        project.status = "submitted";
        project.history.push({ at: now(), actor: user.name, event: `Commande ${order.number} envoyée à l'usine` });
        this.db.orders.push(order);
        this.notify("factory", project.factoryId, project.resellerId, "Nouvelle commande", `${order.number} - ${project.customer?.name || project.title}`);
        this.store.save();
        return send(200, { order: this.serializeOrderFor(role, order), issues });
      }
    }

    // ---------- Commandes ----------

    if (route === "POST /api/orders/group-delivery") {
      if (role !== "reseller" && role !== "factory") return fail(403, "Accès refusé.");
      const ids = Array.isArray(body.orderIds) ? body.orderIds : [];
      const orders = ids.map((id) => this.db.orders.find((o) => o.id === id)).filter(Boolean)
        .filter((o) => o.factoryId === user.factoryId && (role === "factory" || o.resellerId === user.resellerId));
      if (orders.length < 2) return fail(422, "Sélectionnez au moins deux commandes à regrouper.");
      for (const order of orders) {
        const project = this.db.projects.find((p) => p.id === order.projectId);
        if (!project) continue;
        project.groupedOrderIds = orders.filter((o) => o.id !== order.id).map((o) => o.id);
        project.consolidatedDelivery = true;
        this.recomputeQuote(project);
        order.updatedAt = now();
      }
      this.store.save();
      return send(200, { ok: true, count: orders.length });
    }

    const orderMatch = url.pathname.match(/^\/api\/orders\/([^/]+)(?:\/([\w-]+))?$/);
    if (orderMatch) {
      const order = this.db.orders.find((o) => o.id === orderMatch[1]);
      if (!order || order.factoryId !== user.factoryId) return fail(404, "Commande introuvable.");
      if (role === "reseller" && order.resellerId !== user.resellerId) return fail(403, "Accès refusé.");
      const project = this.db.projects.find((p) => p.id === order.projectId);
      const action = orderMatch[2];

      if (req.method === "GET" && !action) return send(200, { order: this.serializeOrderFor(role, order) });

      if (req.method === "GET" && action === "dxf") {
        if (role === "reseller" && !["approved", "in_production", "shipped", "delivered"].includes(order.status)) {
          return fail(409, "Le DXF machine est disponible après validation par l'usine.");
        }
        const dxf = projectToDxf(project, this.catalogOf(order.factoryId));
        return send(200, dxf, {
          "Content-Type": "application/dxf",
          "Content-Disposition": `attachment; filename="${order.number}.dxf"`,
        });
      }

      if (req.method === "POST" && action === "comment") {
        const text = String(body.text || "").trim();
        const attachments = (Array.isArray(body.attachments) ? body.attachments : []).slice(0, 5)
          .filter((a) => a?.dataUrl && String(a.dataUrl).length < 7_000_000)
          .map((a) => ({ id: makeId("file"), name: String(a.name || "fichier"), dataUrl: a.dataUrl, by: user.name, at: now() }));
        if (!text && !attachments.length) return fail(422, "Commentaire vide.");
        if (text) order.comments.push({ id: makeId("comment"), at: now(), author: user.name, text });
        order.attachments.push(...attachments);
        order.updatedAt = now();
        this.notify(role === "factory" ? "reseller" : "factory", order.factoryId, order.resellerId,
          "Nouveau commentaire", `${order.number} : ${text.slice(0, 80) || "pièce jointe"}`);
        this.store.save();
        return send(200, { order: this.serializeOrderFor(role, order) });
      }

      if (req.method === "POST" && action === "status") {
        const target = String(body.status || "");
        const allowed = ORDER_TRANSITIONS[order.status] || [];
        if (!allowed.includes(target)) {
          return fail(409, `Passage impossible de « ${STATUS_LABELS[order.status]} » à « ${STATUS_LABELS[target] || target} ».`);
        }
        const factoryOnly = ["approved", "in_production", "shipped", "changes_requested", "factory_proposal"];
        if (factoryOnly.includes(target) && role !== "factory") return fail(403, "Action réservée à l'usine.");
        if (target === "reseller_accepted" && role !== "reseller") return fail(403, "Action réservée au revendeur.");
        order.status = target;
        order.updatedAt = now();
        if (body.week) order.deliveryWeek = String(body.week);
        if (target === "shipped") order.shippedAt = now();
        if (target === "delivered") order.deliveredAt = now();
        if (target === "changes_requested" && project) {
          project.status = "correction";
          project.history.push({ at: now(), actor: user.name, event: "Correction demandée par l'usine" });
        }
        if (target === "factory_review" && project) {
          project.status = "submitted";
          project.history.push({ at: now(), actor: user.name, event: "Correction renvoyée à l'usine pour contrôle" });
        }
        if (body.comment) order.comments.push({ id: makeId("comment"), at: now(), author: user.name, text: String(body.comment) });
        this.notify(role === "factory" ? "reseller" : "factory", order.factoryId, order.resellerId,
          "Commande mise à jour", `${order.number} : ${STATUS_LABELS[target] || target}`);
        this.store.save();
        return send(200, { order: this.serializeOrderFor(role, order) });
      }

      if (req.method === "POST" && action === "production-step") {
        if (role !== "factory") return fail(403, "Action réservée à l'usine.");
        const step = PRODUCTION_STEPS.find((s) => s.id === body.stepId);
        if (!step) return fail(422, "Étape inconnue.");
        order.productionSteps = order.productionSteps || {};
        if (body.done) order.productionSteps[step.id] = { at: now(), by: user.name };
        else delete order.productionSteps[step.id];
        order.updatedAt = now();
        this.store.save();
        return send(200, { order: this.serializeOrderFor(role, order) });
      }

      if (req.method === "POST" && action === "archive") {
        order.archived = Boolean(body.archived ?? true);
        order.updatedAt = now();
        this.store.save();
        return send(200, { ok: true });
      }
    }

    // ---------- Catalogue ----------

    if (route === "PATCH /api/catalog") {
      if (role !== "factory") return fail(403, "Seule l'usine modifie les tarifs.");
      const catalog = this.catalogOf(user.factoryId);
      const { type, id, prices, active, variantKey, price } = body;
      const list = type === "material" ? catalog.materials : catalog.services;
      const item = list.find((entry) => entry.id === id);
      if (!item) return fail(404, "Élément introuvable.");
      // Nouveau modèle matière : prix par variante « FINITION|épaisseur ».
      if (type === "material" && variantKey !== undefined) {
        const [finish, thickness] = String(variantKey).split("|");
        const variant = (item.variants || []).find((v) => v.finish === finish && v.thicknessMm === Number(thickness));
        if (!variant) return fail(404, "Variante introuvable.");
        variant.priceM2 = Number(price || 0);
      }
      if (prices && typeof prices === "object" && item.prices) {
        for (const [key, value] of Object.entries(prices)) {
          if (value === "" || value === null) delete item.prices[key];
          else item.prices[key] = Number(value);
        }
      }
      if (typeof active === "boolean") item.active = active;
      catalog.updatedAt = now();
      this.store.save();
      return send(200, { catalog });
    }

    // ---------- Revendeurs ----------

    if (route === "POST /api/resellers") {
      if (role !== "factory") return fail(403, "Seule l'usine crée des revendeurs.");
      const email = String(body.email || "").toLowerCase().trim();
      if (!email) return fail(422, "E-mail de connexion requis.");
      if (this.db.users.some((u) => u.email.toLowerCase() === email)) return fail(409, "Un compte existe déjà avec cet e-mail.");
      const reseller = {
        id: makeId("reseller"),
        factoryId: user.factoryId,
        company: String(body.company || "Revendeur"),
        siret: body.siret || "",
        managerName: body.managerName || "",
        salespersonName: body.salespersonName || "",
        email,
        phone: body.phone || "",
        deliveryAddress: body.deliveryAddress || "",
        distanceKm: Number(body.distanceKm || 50),
        defaultMarginPct: 35,
        defaultVatPct: 20,
        active: true,
        createdAt: now(),
        legalName: body.company || "",
        billingAddress: body.deliveryAddress || "",
        quoteValidityDays: 30,
        paymentTerms: "Paiement selon les conditions indiquées au devis.",
        latePenalties: "Pénalités de retard exigibles au taux légal en vigueur et indemnité forfaitaire de recouvrement de 40 €.",
        salesTerms: "",
        logoDataUrl: "",
      };
      const password = randomBytes(4).toString("hex");
      this.db.resellers.push(reseller);
      this.db.users.push({
        id: makeId("user"), role: "reseller", factoryId: user.factoryId, resellerId: reseller.id,
        name: reseller.company, email, password: hashPassword(password), active: true,
      });
      this.store.save();
      return send(200, { reseller, temporaryPassword: password });
    }

    const resellerMatch = url.pathname.match(/^\/api\/resellers\/([^/]+)$/);
    if (resellerMatch && req.method === "PATCH") {
      const reseller = this.db.resellers.find((r) => r.id === resellerMatch[1] && r.factoryId === user.factoryId);
      if (!reseller) return fail(404, "Revendeur introuvable.");
      if (role === "reseller" && reseller.id !== user.resellerId) return fail(403, "Accès refusé.");
      const factoryFields = ["active", "distanceKm"];
      const profileFields = ["company", "legalName", "legalForm", "capital", "siret", "vatNumber", "rcs", "email", "phone",
        "website", "deliveryAddress", "billingAddress", "managerName", "salespersonName", "logoDataUrl",
        "quoteValidityDays", "paymentTerms", "latePenalties", "salesTerms", "defaultMarginPct", "defaultVatPct"];
      const fields = role === "factory" ? [...factoryFields, ...profileFields] : profileFields;
      for (const key of fields) if (key in body) reseller[key] = body[key];
      if (body.newPassword && role === "reseller") {
        const account = this.db.users.find((u) => u.resellerId === reseller.id);
        if (account) account.password = hashPassword(String(body.newPassword));
      }
      this.store.save();
      return send(200, { reseller });
    }

    // ---------- Réglages usine ----------

    if (route === "PATCH /api/settings") {
      if (role !== "factory") return fail(403, "Réservé à l'usine.");
      const factory = this.factoryOf(user);
      if (body.settings) factory.settings = { ...factory.settings, ...body.settings };
      for (const key of ["name", "city", "legalName", "siret", "managerName", "email", "phone", "address"]) {
        if (key in body) factory[key] = body[key];
      }
      this.store.save();
      return send(200, { factory });
    }

    if (route === "GET /api/stats") {
      return send(200, { stats: this.stats(user, url.searchParams.get("from"), url.searchParams.get("to")) });
    }

    if (route === "POST /api/notifications/read") {
      for (const notification of this.db.notifications) {
        if (notification.factoryId === user.factoryId && notification.targetRole === role
          && (role === "factory" || notification.resellerId === user.resellerId)) notification.read = true;
      }
      this.store.save();
      return send(200, { ok: true });
    }

    // ---------- Appareils encastrables ----------

    if (route === "GET /api/appliances") {
      const q = String(url.searchParams.get("q") || "").toLowerCase();
      const type = url.searchParams.get("type");
      const results = this.db.appliances.filter((a) =>
        (!type || a.type === type)
        && (!q || `${a.brand} ${a.reference} ${a.label}`.toLowerCase().includes(q)));
      return send(200, { appliances: results.slice(0, 30), note: this.db.applianceNote });
    }

    if (route === "POST /api/appliance-lookup") {
      const brand = String(body.brand || "").toLowerCase().trim();
      const reference = String(body.reference || "").toLowerCase().replace(/[\s-]/g, "");
      if (!reference) return fail(422, "Renseignez la référence de l'appareil.");
      const match = this.db.appliances.find((a) =>
        (!brand || a.brand.toLowerCase().includes(brand))
        && a.reference.toLowerCase().replace(/[\s-]/g, "").includes(reference));
      if (match) return send(200, { found: true, appliance: match, note: this.db.applianceNote });
      const suggestions = this.db.appliances
        .filter((a) => !brand || a.brand.toLowerCase().includes(brand)).slice(0, 6);
      return send(200, {
        found: false,
        suggestions,
        message: "Référence absente de la base Marbexa : saisissez les cotes d'encastrement de la notice fabricant, elles seront enregistrées pour la prochaine fois.",
      });
    }

    if (route === "POST /api/appliances") {
      const { type, brand, reference, cutoutWidthMm, cutoutDepthMm } = body;
      if (!brand || !reference || !cutoutWidthMm || !cutoutDepthMm) return fail(422, "Marque, référence et cotes de découpe sont obligatoires.");
      const appliance = {
        id: makeId("app"),
        type: type === "hob" ? "hob" : "sink",
        brand: String(brand),
        reference: String(reference),
        label: String(body.label || `${brand} ${reference}`),
        cutoutWidthMm: Number(cutoutWidthMm),
        cutoutDepthMm: Number(cutoutDepthMm),
        cornerRadiusMm: Number(body.cornerRadiusMm || 10),
        mounting: Array.isArray(body.mounting) && body.mounting.length ? body.mounting : ["top"],
        minFrontMm: Number(body.minFrontMm || 50),
        addedBy: user.name,
      };
      this.db.appliances.push(appliance);
      this.store.save();
      return send(200, { appliance });
    }

    // ---------- Import de plans (DXF / PDF) ----------

    if (route === "POST /api/import-plan") {
      const name = String(body.fileName || "plan");
      const data = Buffer.from(String(body.dataBase64 || ""), "base64");
      if (!data.length) return fail(422, "Fichier vide.");
      if (data.length > 12 * 1024 * 1024) return fail(422, "Fichier trop lourd (12 Mo maximum).");
      const lower = name.toLowerCase();
      let result;
      if (lower.endsWith(".dxf") || data.subarray(0, 512).toString("latin1").includes("SECTION")) {
        result = { sourceType: "dxf", ...parseDxfPlan(data.toString("latin1")) };
      } else if (lower.endsWith(".pdf") || data.subarray(0, 5).toString() === "%PDF-") {
        result = { sourceType: "pdf", ...parsePdfPlan(data) };
      } else {
        return send(200, {
          sourceType: "image",
          pieces: [],
          issues: [
            "L'analyse d'images (scan, photo, plan à main levée) demande le moteur IA visuel : il n'est pas configuré sur ce serveur.",
            "Utilisez un export DXF 2D ou PDF vectoriel du logiciel d'origine, ou créez le plan manuellement en gardant l'image sous les yeux.",
          ],
          texts: [],
        });
      }
      // Nommage automatique des pièces proposées.
      let count = 0;
      for (const piece of result.pieces) {
        count += 1;
        piece.name = piece.name || `${piece.kind === "splashback" ? "Crédence" : piece.kind === "panel" ? "Panneau" : "Plan de travail"} ${count}`;
      }
      return send(200, result);
    }

    // ---------- Impression ----------

    const printMatch = url.pathname.match(/^\/print\/([^/]+)$/);
    if (printMatch && req.method === "GET") {
      const project = this.db.projects.find((p) => p.id === printMatch[1]);
      if (!project || project.factoryId !== user.factoryId) return fail(404, "Projet introuvable.");
      if (role === "reseller" && project.resellerId !== user.resellerId) return fail(403, "Accès refusé.");
      const reseller = this.db.resellers.find((r) => r.id === project.resellerId);
      const factory = this.db.factories.find((f) => f.id === project.factoryId);
      const catalog = this.catalogOf(project.factoryId);
      const order = this.db.orders.find((o) => o.projectId === project.id && o.status !== "cancelled");
      const type = url.searchParams.get("type") || "quote";
      if (["factory-order", "technical"].includes(type) && role === "reseller" && !order) {
        return fail(409, "Envoyez d'abord la commande à l'usine.");
      }
      const html = type === "customer-order" ? customerOrderDocument(project, reseller)
        : type === "factory-order" ? factoryOrderDocument(order || { number: "(brouillon)", status: project.status, revision: project.revision }, project, reseller, factory, catalog)
        : type === "technical" ? technicalSheetDocument(order || { number: "(brouillon)", productionSteps: {} }, project, reseller, factory, catalog)
        : quoteDocument(project, reseller);
      return send(200, html);
    }

    return fail(404, "Route inconnue.");
  }
}
