/**
 * Nijmegen Duckstad — bestel-, betaal- en loterijsysteem
 * Cloudflare Worker + D1 + Mollie (iDEAL).
 *
 * Routes:
 *   GET  /api/status               publieke verkoopstand (live teller)
 *   POST /api/order                nieuwe bestelling -> Mollie checkout-URL
 *   GET  /api/order-status?id=...  status + toegekende nummers van 1 bestelling
 *   POST /api/mollie-webhook       Mollie meldt betaalstatus -> nummers toekennen
 *   /admin                         dashboard (Basic Auth)
 *   /api/admin/*                   beveiligde admin-API (Basic Auth)
 * Al het andere -> statische site (env.ASSETS).
 */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const p = url.pathname;
    try {
      if (p === "/api/status" && request.method === "GET") return apiStatus(env);
      if (p === "/api/order" && request.method === "POST") return apiOrder(request, env, url);
      if (p === "/api/order-status" && request.method === "GET") return apiOrderStatus(url, env);
      if (p === "/api/mollie-webhook" && request.method === "POST") return apiWebhook(request, env, ctx);
      if (p.startsWith("/api/admin/")) return adminApi(p, request, env);
      // /admin -> /admin.html wordt door html_handling als statische asset geserveerd
      // (de pagina zelf bevat geen data; de admin-API is met Basic Auth beveiligd).
    } catch (e) {
      return json({ error: "server_error", message: String(e && e.message || e) }, 500);
    }
    return env.ASSETS.fetch(request); // statische site
  },
};

/* ---------------- helpers ---------------- */
const now = () => new Date().toISOString();
const json = (obj, status = 200, extra = {}) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra } });
const bad = (msg, status = 400) => json({ error: msg }, status);
const euro = (c) => "€" + (c / 100).toLocaleString("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const isEmail = (s) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s || "");
const esc = (s) => String(s == null ? "" : s);
function csvCell(s) { s = esc(s); return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
function csv(rows) { return rows.map((r) => r.map(csvCell).join(";")).join("\r\n"); }

async function settings(env) {
  const r = await env.DB.prepare("SELECT key, value FROM settings").all();
  const o = {};
  (r.results || []).forEach((x) => (o[x.key] = x.value));
  return {
    sales_open: o.sales_open !== "0",
    max_regular: parseInt(o.max_regular || "5000", 10),
    price_regular_cents: parseInt(o.price_regular_cents || "500", 10),
    price_business_cents: parseInt(o.price_business_cents || "15000", 10),
  };
}
async function soldCount(env, type) {
  const r = await env.DB.prepare("SELECT COUNT(*) AS n FROM ducks WHERE type = ?1").bind(type).first();
  return (r && r.n) || 0;
}

/* ---------------- publieke API ---------------- */
async function apiStatus(env) {
  const s = await settings(env);
  const reg = await soldCount(env, "regular");
  const bus = await soldCount(env, "business");
  const rev = await env.DB.prepare("SELECT COALESCE(SUM(amount_cents),0) AS c FROM orders WHERE status='paid'").first();
  return json({
    sold: reg, total: s.max_regular, business_sold: bus,
    raised_cents: (rev && rev.c) || 0,
    price_regular_cents: s.price_regular_cents, price_business_cents: s.price_business_cents,
    sales_open: s.sales_open,
  });
}

async function apiOrder(request, env, url) {
  const s = await settings(env);
  if (!s.sales_open) return bad("verkoop_gesloten", 403);
  let b;
  try { b = await request.json(); } catch { return bad("ongeldige_invoer"); }

  const type = b.type === "business" ? "business" : "regular";
  let qty = parseInt(b.quantity, 10);
  if (!Number.isFinite(qty) || qty < 1) return bad("aantal_ongeldig");
  if (type === "regular" && qty > 100) return bad("max_100_per_bestelling");
  if (type === "business" && qty > 20) return bad("max_20_bedrijfseendjes");

  const name = esc(b.name).trim().slice(0, 120);
  const email = esc(b.email).trim().slice(0, 160);
  const phone = esc(b.phone).trim().slice(0, 40);
  const city = esc(b.city).trim().slice(0, 80);
  const newsletter = b.newsletter ? 1 : 0;
  if (!name) return bad("naam_verplicht");
  if (!isEmail(email)) return bad("email_ongeldig");
  if (!b.consent) return bad("toestemming_verplicht");

  // Voorraadcheck (zacht): betaalde reguliere eendjes mogen max_regular niet overschrijden.
  if (type === "regular") {
    const sold = await soldCount(env, "regular");
    if (sold + qty > s.max_regular) return bad("uitverkocht", 409);
  }

  const price = type === "business" ? s.price_business_cents : s.price_regular_cents;
  const amount = price * qty;
  const id = crypto.randomUUID();

  await env.DB.prepare(
    `INSERT INTO orders (id,created_at,name,email,phone,city,type,quantity,amount_cents,status,payment_method,newsletter)
     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,'pending','mollie',?10)`
  ).bind(id, now(), name, email, phone, city, type, qty, amount, newsletter).run();

  const origin = url.origin;
  let payment;
  try {
    payment = await mollieCreate(env, {
      amount: { currency: "EUR", value: (amount / 100).toFixed(2) },
      description: `Nijmegen Duckstad — ${qty}x ${type === "business" ? "bedrijfseendje" : "eendje"}`,
      redirectUrl: `${origin}/bestelling?id=${id}`,
      webhookUrl: `${origin}/api/mollie-webhook`,
      metadata: { order_id: id },
    });
  } catch (e) {
    await env.DB.prepare("UPDATE orders SET status='failed', note=?2 WHERE id=?1").bind(id, "mollie_fout: " + String(e.message || e)).run();
    return bad("betaling_aanmaken_mislukt: " + String(e.message || e), 502);
  }

  await env.DB.prepare("UPDATE orders SET mollie_payment_id=?2 WHERE id=?1").bind(id, payment.id).run();
  const checkout = payment._links && payment._links.checkout && payment._links.checkout.href;
  if (!checkout) return bad("geen_checkout_url", 502);
  return json({ order_id: id, checkoutUrl: checkout });
}

async function apiOrderStatus(url, env) {
  const id = url.searchParams.get("id");
  if (!id) return bad("id_ontbreekt");
  const o = await env.DB.prepare("SELECT id,name,type,quantity,amount_cents,status,created_at,paid_at FROM orders WHERE id=?1").bind(id).first();
  if (!o) return bad("niet_gevonden", 404);
  const d = await env.DB.prepare("SELECT number FROM ducks WHERE order_id=?1 ORDER BY number").bind(id).all();
  return json({
    status: o.status, type: o.type, quantity: o.quantity, name: o.name,
    amount_cents: o.amount_cents, numbers: (d.results || []).map((r) => r.number),
  });
}

/* ---------------- Mollie ---------------- */
async function mollieCreate(env, body) {
  const r = await fetch("https://api.mollie.com/v2/payments", {
    method: "POST",
    headers: { authorization: "Bearer " + env.MOLLIE_API_KEY, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j && j.detail ? j.detail : "mollie_" + r.status);
  return j;
}
async function mollieGet(env, id) {
  const r = await fetch("https://api.mollie.com/v2/payments/" + encodeURIComponent(id), {
    headers: { authorization: "Bearer " + env.MOLLIE_API_KEY },
  });
  const j = await r.json();
  if (!r.ok) throw new Error("mollie_get_" + r.status);
  return j;
}

async function apiWebhook(request, env, ctx) {
  const form = await request.formData();
  const pid = form.get("id");
  if (!pid) return new Response("ok"); // niets te doen
  // Verifieer altijd bij Mollie zelf (vertrouw de POST niet).
  let pay;
  try { pay = await mollieGet(env, pid); } catch { return new Response("ok"); }
  const orderId = pay.metadata && pay.metadata.order_id;
  if (!orderId) return new Response("ok");
  const order = await env.DB.prepare("SELECT * FROM orders WHERE id=?1").bind(orderId).first();
  if (!order) return new Response("ok");

  if (pay.status === "paid") {
    if (order.status !== "paid") {
      await assignNumbers(env, order);
      await env.DB.prepare("UPDATE orders SET status='paid', paid_at=?2 WHERE id=?1").bind(orderId, now()).run();
      ctx.waitUntil(sendConfirmation(env, orderId));
    }
  } else if (["expired", "canceled", "failed"].includes(pay.status)) {
    if (order.status === "pending") {
      await env.DB.prepare("UPDATE orders SET status=?2 WHERE id=?1").bind(orderId, pay.status).run();
    }
  }
  return new Response("ok");
}

// Ken opvolgende nummers toe (atomair via counter + RETURNING).
async function assignNumbers(env, order) {
  // Voorkom dubbel toekennen als de webhook 2x binnenkomt.
  const existing = await env.DB.prepare("SELECT COUNT(*) AS n FROM ducks WHERE order_id=?1").bind(order.id).first();
  if (existing && existing.n > 0) return;
  const c = await env.DB.prepare("UPDATE counters SET n = n + ?1 WHERE name = ?2 RETURNING n").bind(order.quantity, order.type).first();
  const high = c.n, start = high - order.quantity + 1;
  const stmts = [];
  const t = now();
  for (let i = start; i <= high; i++) {
    stmts.push(env.DB.prepare("INSERT INTO ducks (number,type,order_id,created_at) VALUES (?1,?2,?3,?4)").bind(i, order.type, order.id, t));
  }
  await env.DB.batch(stmts);
}

/* ---------------- e-mail (optioneel, via Resend) ---------------- */
async function sendConfirmation(env, orderId) {
  if (!env.RESEND_API_KEY) return;
  const o = await env.DB.prepare("SELECT * FROM orders WHERE id=?1").bind(orderId).first();
  if (!o) return;
  const d = await env.DB.prepare("SELECT number FROM ducks WHERE order_id=?1 ORDER BY number").bind(orderId).all();
  const nums = (d.results || []).map((r) => r.number).join(", ");
  const html = `<p>Hoi ${esc(o.name)},</p>
    <p>Bedankt voor je deelname aan de <strong>Nijmegen Duckstad</strong> badeendjesrace!</p>
    <p>Je hebt <strong>${o.quantity}x ${o.type === "business" ? "bedrijfseendje" : "eendje"}</strong> geadopteerd.
    Jouw startnummer(s): <strong>${nums}</strong>.</p>
    <p>Bewaar deze mail — met deze nummers doe je mee in de race en de loterij.</p>
    <p>Tot 17 april 2027 in de Spiegelwaal! 🦆</p>`;
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: "Bearer " + env.RESEND_API_KEY, "content-type": "application/json" },
      body: JSON.stringify({
        from: env.MAIL_FROM || "Nijmegen Duckstad <info@nijmegenduckstad.nl>",
        reply_to: env.MAIL_REPLY_TO || "marco@marcovanthiel.nl",
        to: [o.email], subject: "Je badeendje(s) — Nijmegen Duckstad", html,
      }),
    });
    // Log Resend-fouten (anders falen mails ongemerkt; nummers staan ook op de bedankpagina + admin).
    if (!r.ok) console.error("resend_fout", r.status, (await r.text().catch(() => "")).slice(0, 300));
  } catch (e) { console.error("resend_exception", String((e && e.message) || e)); }
}

/* ---------------- admin ---------------- */
function checkAuth(request, env) {
  const h = request.headers.get("authorization") || "";
  if (!h.startsWith("Basic ")) return false;
  let dec = "";
  try { dec = atob(h.slice(6)); } catch { return false; }
  const i = dec.indexOf(":");
  const user = dec.slice(0, i), pass = dec.slice(i + 1);
  const okUser = user === (env.ADMIN_USER || "admin");
  const okPass = !!env.ADMIN_PASSWORD && pass === env.ADMIN_PASSWORD;
  return okUser && okPass;
}
const authChallenge = () => new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { "content-type": "application/json", "www-authenticate": 'Basic realm="Nijmegen Duckstad admin"' } });

async function adminApi(path, request, env) {
  if (!checkAuth(request, env)) return authChallenge();
  const sub = path.slice("/api/admin/".length);

  if (sub === "stats") {
    const s = await settings(env);
    const reg = await soldCount(env, "regular");
    const bus = await soldCount(env, "business");
    const agg = await env.DB.prepare(
      `SELECT
         COUNT(*) FILTER (WHERE status='paid')    AS paid_orders,
         COUNT(*) FILTER (WHERE status='pending') AS pending_orders,
         COALESCE(SUM(amount_cents) FILTER (WHERE status='paid'),0) AS revenue_cents,
         COUNT(*) FILTER (WHERE newsletter=1 AND status='paid') AS newsletter_count
       FROM orders`).first();
    const draws = await env.DB.prepare("SELECT COUNT(*) AS n FROM draws").first();
    return json({
      regular_sold: reg, business_sold: bus, max_regular: s.max_regular,
      paid_orders: agg.paid_orders, pending_orders: agg.pending_orders,
      revenue_cents: agg.revenue_cents, newsletter_count: agg.newsletter_count,
      draws: draws.n, sales_open: s.sales_open,
      price_regular_cents: s.price_regular_cents, price_business_cents: s.price_business_cents,
    });
  }

  if (sub === "orders") {
    const r = await env.DB.prepare(
      "SELECT id,created_at,name,email,phone,city,type,quantity,amount_cents,status,newsletter,paid_at FROM orders ORDER BY created_at DESC LIMIT 1000").all();
    return json({ orders: r.results || [] });
  }

  if (sub === "export-lottery") {
    const r = await env.DB.prepare(
      `SELECT d.type AS type, d.number AS number, o.name AS name, o.email AS email, o.city AS city, o.phone AS phone
       FROM ducks d JOIN orders o ON o.id = d.order_id ORDER BY d.type, d.number`).all();
    const rows = [["Type", "Nummer", "Naam", "E-mail", "Woonplaats", "Telefoon"]];
    (r.results || []).forEach((x) => rows.push([x.type, x.number, x.name, x.email, x.city, x.phone]));
    return new Response("﻿" + csv(rows), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="loterijlijst.csv"' } });
  }

  if (sub === "export-orders") {
    const r = await env.DB.prepare(
      "SELECT created_at,name,email,phone,city,type,quantity,amount_cents,status,newsletter,paid_at FROM orders ORDER BY created_at DESC").all();
    const rows = [["Datum", "Naam", "E-mail", "Telefoon", "Woonplaats", "Type", "Aantal", "Bedrag(€)", "Status", "Nieuwsbrief", "Betaald op"]];
    (r.results || []).forEach((x) => rows.push([x.created_at, x.name, x.email, x.phone, x.city, x.type, x.quantity, (x.amount_cents / 100).toFixed(2), x.status, x.newsletter ? "ja" : "nee", x.paid_at]));
    return new Response("﻿" + csv(rows), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="bestellingen.csv"' } });
  }

  if (sub === "export-newsletter") {
    const r = await env.DB.prepare("SELECT DISTINCT name,email FROM orders WHERE newsletter=1 AND status='paid' ORDER BY name").all();
    const rows = [["Naam", "E-mail"]];
    (r.results || []).forEach((x) => rows.push([x.name, x.email]));
    return new Response("﻿" + csv(rows), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="nieuwsbrief.csv"' } });
  }

  if (sub === "draws" && request.method === "GET") {
    const r = await env.DB.prepare("SELECT * FROM draws ORDER BY id DESC").all();
    return json({ draws: r.results || [] });
  }

  if (sub === "draw" && request.method === "POST") {
    const b = await request.json().catch(() => ({}));
    const prize = esc(b.prize).trim().slice(0, 160);
    if (!prize) return bad("prijs_verplicht");
    const filterBusiness = b.include_business === false ? " AND d.type='regular'" : "";
    // willekeurig eendje dat nog niet eerder gewonnen heeft
    const pick = await env.DB.prepare(
      `SELECT d.type AS type, d.number AS number, o.id AS order_id, o.name AS name, o.email AS email
       FROM ducks d JOIN orders o ON o.id=d.order_id
       WHERE NOT EXISTS (SELECT 1 FROM draws w WHERE w.duck_type=d.type AND w.duck_number=d.number)${filterBusiness}
       ORDER BY RANDOM() LIMIT 1`).first();
    if (!pick) return bad("geen_eendjes_beschikbaar", 409);
    await env.DB.prepare(
      "INSERT INTO draws (created_at,prize,duck_type,duck_number,order_id,winner_name,winner_email) VALUES (?1,?2,?3,?4,?5,?6,?7)")
      .bind(now(), prize, pick.type, pick.number, pick.order_id, pick.name, pick.email).run();
    return json({ winner: { prize, type: pick.type, number: pick.number, name: pick.name, email: pick.email } });
  }

  if (sub === "draw-reset" && request.method === "POST") {
    await env.DB.prepare("DELETE FROM draws").run();
    return json({ ok: true });
  }

  if (sub === "setting" && request.method === "POST") {
    const b = await request.json().catch(() => ({}));
    if (!b.key) return bad("key_verplicht");
    await env.DB.prepare("INSERT INTO settings (key,value) VALUES (?1,?2) ON CONFLICT(key) DO UPDATE SET value=?2").bind(String(b.key), String(b.value)).run();
    return json({ ok: true });
  }

  // Handmatige bestelling (bv. contante/Tikkie-betaling op een verkoopdag).
  if (sub === "manual-order" && request.method === "POST") {
    const b = await request.json().catch(() => ({}));
    const type = b.type === "business" ? "business" : "regular";
    const qty = parseInt(b.quantity, 10);
    if (!b.name || !Number.isFinite(qty) || qty < 1) return bad("invoer_ongeldig");
    const s = await settings(env);
    const price = type === "business" ? s.price_business_cents : s.price_regular_cents;
    const id = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO orders (id,created_at,name,email,phone,city,type,quantity,amount_cents,status,payment_method,newsletter,paid_at,note)
       VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,'paid','manual',?10,?2,?11)`
    ).bind(id, now(), esc(b.name).slice(0,120), esc(b.email).slice(0,160), esc(b.phone).slice(0,40), esc(b.city).slice(0,80), type, qty, price * qty, b.newsletter ? 1 : 0, esc(b.note).slice(0,200)).run();
    await assignNumbers(env, { id, quantity: qty, type });
    const d = await env.DB.prepare("SELECT number FROM ducks WHERE order_id=?1 ORDER BY number").bind(id).all();
    return json({ ok: true, order_id: id, numbers: (d.results || []).map((r) => r.number) });
  }

  return bad("onbekende_admin-route", 404);
}
