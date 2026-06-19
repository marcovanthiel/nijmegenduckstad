/**
 * Nijmegen Duckstad — bestel- en betaalsysteem voor de badeendjesrace
 * Cloudflare Worker + D1 + Mollie (iDEAL).
 *
 * Routes:
 *   GET  /api/status               publieke verkoopstand (live teller)
 *   POST /api/order                nieuwe bestelling -> Mollie checkout-URL
 *   GET  /api/order-status?id=...  status + toegekende nummers van 1 bestelling
 *   POST /api/mollie-webhook       Mollie meldt betaalstatus -> nummers toekennen
 *   /admin                         dashboard (login met account + rol)
 *   /api/admin/*                   beveiligde admin-API (sessie-cookie + rollen)
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
const escHtml = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
// Vrije tekst (admin-geschreven) veilig naar HTML: dubbele newline -> nieuwe alinea, enkele -> <br>.
function htmlParagraphs(text) {
  return String(text || "").trim().split(/\n{2,}/).map((para) =>
    `<p style="margin:0 0 14px;">${escHtml(para).replace(/\n/g, "<br>")}</p>`).join("");
}
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

// Ken de LAAGSTE VRIJE nummers toe (per type). Zo komen nummers die door het
// verwijderen van een bestelling zijn vrijgekomen, vanzelf weer in gebruik.
async function assignNumbers(env, order) {
  // Voorkom dubbel toekennen als de webhook 2x binnenkomt.
  const existing = await env.DB.prepare("SELECT COUNT(*) AS n FROM ducks WHERE order_id=?1").bind(order.id).first();
  if (existing && existing.n > 0) return;
  for (let attempt = 0; attempt < 6; attempt++) {
    const usedR = await env.DB.prepare("SELECT number FROM ducks WHERE type=?1").bind(order.type).all();
    const used = new Set((usedR.results || []).map((r) => r.number));
    const pick = [];
    for (let n = 1; pick.length < order.quantity; n++) if (!used.has(n)) pick.push(n);
    try {
      const t = now();
      await env.DB.batch(pick.map((i) => env.DB.prepare("INSERT INTO ducks (number,type,order_id,created_at) VALUES (?1,?2,?3,?4)").bind(i, order.type, order.id, t)));
      return;
    } catch (e) {
      // PRIMARY KEY-conflict bij gelijktijdige toewijzing → opnieuw proberen met verse stand.
    }
  }
  throw new Error("nummer_toewijzing_mislukt");
}

/* ---------------- e-mail (optioneel, via Resend) ---------------- */
async function sendConfirmation(env, orderId) {
  if (!env.RESEND_API_KEY) return;
  const o = await env.DB.prepare("SELECT * FROM orders WHERE id=?1").bind(orderId).first();
  if (!o) return;
  const d = await env.DB.prepare("SELECT number FROM ducks WHERE order_id=?1 ORDER BY number").bind(orderId).all();
  const nums = (d.results || []).map((r) => r.number);
  const isBiz = o.type === "business";
  const jaar = new Date().getFullYear();
  // Eén racekaartje per eendje: blauwe stub met 🦆 + afgescheurde bon met het nummer.
  const ticket = (n) => `
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:460px;margin:0 auto 12px;border-collapse:separate;">
          <tr>
            <td width="92" style="width:92px;background:#17458f;border-radius:14px 0 0 14px;text-align:center;vertical-align:middle;padding:16px 0;font-size:38px;line-height:1;">🦆</td>
            <td style="background:#fff8e9;border:2px dashed #f7a81b;border-left:0;border-radius:0 14px 14px 0;padding:12px 20px;font-family:Arial,Helvetica,sans-serif;">
              <div style="font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#9a7b22;font-weight:bold;">Startnummer · ${isBiz ? "bedrijfseendje" : "badeendjesrace"}</div>
              <div style="font-family:Georgia,'Times New Roman',serif;font-size:33px;font-weight:bold;color:#17458f;line-height:1.15;">${String(n).padStart(4, "0")}</div>
            </td>
          </tr>
        </table>`;
  const ticketsHtml = nums.map(ticket).join("");
  const html = `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#eef3fb;margin:0;padding:0;">
  <tr><td align="center" style="padding:24px 12px;">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;background:#ffffff;border-radius:18px;overflow:hidden;">
      <tr><td style="background:#17458f;background:linear-gradient(135deg,#17458f,#0e2d63);padding:28px 30px;text-align:center;font-family:Georgia,serif;">
        <div style="font-size:12px;letter-spacing:.18em;text-transform:uppercase;color:#ffd60a;font-weight:bold;">Rotary Badeendjesrace</div>
        <div style="font-size:29px;color:#ffffff;font-weight:bold;margin-top:4px;">Nijmegen Duckstad 🦆</div>
      </td></tr>
      <tr><td style="padding:28px 34px 6px;font-family:Arial,Helvetica,sans-serif;color:#1d2433;font-size:16px;line-height:1.6;">
        <p style="margin:0 0 14px;">Hoi <strong>${esc(o.name)}</strong>,</p>
        <p style="margin:0 0 14px;">Bedankt dat je meedoet aan de <strong>Nijmegen Duckstad</strong> badeendjesrace! Je hebt <strong>${o.quantity}&times; ${isBiz ? "bedrijfseendje" : "eendje"}${o.quantity === 1 ? "" : "s"}</strong> geadopteerd. Hieronder ${nums.length === 1 ? "jouw persoonlijke lot" : "jouw persoonlijke loten"} &mdash; <strong>bewaar deze mail goed.</strong></p>
      </td></tr>
      <tr><td style="padding:8px 30px 6px;">${ticketsHtml}</td></tr>
      <tr><td style="padding:8px 34px 26px;font-family:Arial,Helvetica,sans-serif;color:#1d2433;font-size:15px;line-height:1.6;">
        <p style="margin:0 0 6px;">Met ${nums.length === 1 ? "dit nummer doe" : "deze nummers doe"} je mee in de <strong>badeendjesrace</strong> met mooie prijzen.</p>
        <p style="margin:0;color:#5b6679;">Tot zaterdag 17 april 2027 in de Spiegelwaal! 🦆</p>
      </td></tr>
      <tr><td style="background:#0e2d63;padding:26px 34px 28px;font-family:Arial,Helvetica,sans-serif;">
        <img src="https://nijmegenduckstad.nl/assets/img/rotary-nijmegen-stadenland.png" alt="Rotary Nijmegen Stad en Land" width="210" style="display:block;width:210px;max-width:210px;height:auto;background:#ffffff;border-radius:8px;padding:9px;">
        <p style="margin:14px 0 12px;color:#cdd7ea;font-size:13px;line-height:1.6;">Rotary Nijmegen Stad en Land zet zich het hele jaar in voor goede doelen &mdash; lokaal, regionaal &eacute;n wereldwijd. Jouw deelname steunt dat werk direct. Onze lopende fundraisingacties:</p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr><td style="padding:3px 0;color:#ffffff;font-size:14px;font-family:Arial,Helvetica,sans-serif;">🦆 <strong>Badeendjesrace</strong> in de Spiegelwaal <span style="color:#9fb2d6;">&middot; lente 2027</span></td></tr>
          <tr><td style="padding:3px 0;color:#ffffff;font-size:14px;font-family:Arial,Helvetica,sans-serif;">🎄 <strong>Kerststollen</strong> voor All4small <span style="color:#9fb2d6;">&middot; december 2026</span></td></tr>
          <tr><td style="padding:3px 0;color:#ffffff;font-size:14px;font-family:Arial,Helvetica,sans-serif;">🏰 <strong>Kasteeldiner</strong> met de Soroptimisten <span style="color:#9fb2d6;">&middot; november 2026</span></td></tr>
        </table>
        <p style="margin:16px 0 0;"><a href="https://marcovanthiel.nl/fundraising" style="color:#ffd60a;font-weight:bold;text-decoration:none;font-size:14px;">Bekijk alle acties &rarr; marcovanthiel.nl/fundraising</a></p>
        <hr style="border:0;border-top:1px solid #1f3f72;margin:18px 0 14px;">
        <p style="margin:0 0 6px;color:#cdd7ea;font-size:12px;line-height:1.55;">Een initiatief van de <a href="https://www.rotary.nl/nijmegenstadenland/" style="color:#ffd60a;text-decoration:none;">Rotary club &ndash; Nijmegen Stad en Land</a> (<a href="https://www.rotary.nl/nijmegenstadenland/" style="color:#9fb2d6;text-decoration:none;">rotary.nl/nijmegenstadenland</a>).</p>
        <p style="margin:0;color:#7d92b8;font-size:12px;line-height:1.55;">&copy; ${jaar} Rotary club &ndash; Nijmegen Stad en Land. Je ontvangt deze mail omdat je eendje(s) hebt geadopteerd. Vragen? Beantwoord gerust deze mail.</p>
      </td></tr>
    </table>
  </td></tr>
</table>`;
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: "Bearer " + env.RESEND_API_KEY, "content-type": "application/json" },
      body: JSON.stringify({
        from: env.MAIL_FROM || "Nijmegen Duckstad <info@nijmegenduckstad.nl>",
        reply_to: env.MAIL_REPLY_TO || "marco@marcovanthiel.nl",
        to: [o.email], subject: `🦆 Je startnummer${nums.length === 1 ? "" : "s"} — Nijmegen Duckstad badeendjesrace`, html,
      }),
    });
    // Log Resend-fouten (anders falen mails ongemerkt; nummers staan ook op de bedankpagina + admin).
    if (!r.ok) console.error("resend_fout", r.status, (await r.text().catch(() => "")).slice(0, 300));
  } catch (e) { console.error("resend_exception", String((e && e.message) || e)); }
}

/* ---------------- admin: accounts, rollen, sessies ---------------- */
const te = new TextEncoder();
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const randToken = () => b64(crypto.getRandomValues(new Uint8Array(32))).replace(/[+/=]/g, (c) => (c === "+" ? "-" : c === "/" ? "_" : ""));

async function hashPassword(pw) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iter = 100000;
  const key = await crypto.subtle.importKey("raw", te.encode(pw), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: iter, hash: "SHA-256" }, key, 256);
  return `pbkdf2$${iter}$${b64(salt)}$${b64(bits)}`;
}
async function verifyPassword(pw, stored) {
  if (!stored || stored.indexOf("pbkdf2$") !== 0) return false;
  const [, iterStr, saltB64, hashB64] = stored.split("$");
  const key = await crypto.subtle.importKey("raw", te.encode(pw), "PBKDF2", false, ["deriveBits"]);
  const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", salt: fromB64(saltB64), iterations: parseInt(iterStr, 10), hash: "SHA-256" }, key, 256));
  const want = fromB64(hashB64);
  if (bits.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < bits.length; i++) diff |= bits[i] ^ want[i];
  return diff === 0;
}

function getCookie(request, name) {
  const m = (request.headers.get("cookie") || "").match(new RegExp("(?:^|; )" + name + "=([^;]+)"));
  return m ? m[1] : null;
}
const sessionCookie = (token, maxAge) => `dd_session=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;

async function resolveSession(request, env) {
  const token = getCookie(request, "dd_session");
  if (!token) return null;
  const s = await env.DB.prepare("SELECT user_id, email, role, expires FROM sessions WHERE token=?1").bind(token).first();
  if (!s || s.expires < now()) return null;
  return { user_id: s.user_id, email: s.email, role: s.role, token };
}

async function doLogin(request, env) {
  const b = await request.json().catch(() => ({}));
  const email = String(b.email || "").trim().toLowerCase();
  const password = String(b.password || "");
  let user = null;
  const u = await env.DB.prepare("SELECT id, email, role, pass_hash FROM users WHERE email=?1").bind(email).first();
  if (u && u.pass_hash && (await verifyPassword(password, u.pass_hash))) user = { id: u.id, email: u.email, role: u.role };
  // break-glass: env-admin blijft altijd werken, zodat je nooit buitengesloten raakt
  if (!user && email === String(env.ADMIN_USER || "admin").toLowerCase() && env.ADMIN_PASSWORD && password === env.ADMIN_PASSWORD) {
    user = { id: "env-admin", email, role: "admin" };
  }
  if (!user) return bad("ongeldige_login", 401);
  const token = randToken();
  const maxAge = 7 * 24 * 3600;
  const exp = new Date(Date.now() + maxAge * 1000).toISOString();
  await env.DB.prepare("INSERT INTO sessions (token,user_id,email,role,created_at,expires) VALUES (?1,?2,?3,?4,?5,?6)")
    .bind(token, user.id, user.email, user.role, now(), exp).run();
  return json({ ok: true, email: user.email, role: user.role }, 200, { "set-cookie": sessionCookie(token, maxAge) });
}

async function doLogout(request, env) {
  const token = getCookie(request, "dd_session");
  if (token) await env.DB.prepare("DELETE FROM sessions WHERE token=?1").bind(token).run();
  return json({ ok: true }, 200, { "set-cookie": "dd_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0" });
}

async function doRequestReset(request, env) {
  const b = await request.json().catch(() => ({}));
  const email = String(b.email || "").trim().toLowerCase();
  const u = await env.DB.prepare("SELECT id, email FROM users WHERE email=?1").bind(email).first();
  if (u) {
    const token = randToken();
    const exp = new Date(Date.now() + 3600 * 1000).toISOString();
    await env.DB.prepare("UPDATE users SET reset_token=?2, reset_expires=?3 WHERE id=?1").bind(u.id, token, exp).run();
    await sendResetMail(env, u.email, token, false);
  }
  return json({ ok: true }); // lek nooit of een account bestaat
}

async function doSetPassword(request, env) {
  const b = await request.json().catch(() => ({}));
  const token = String(b.token || "");
  const password = String(b.password || "");
  if (!token) return bad("token_ontbreekt");
  if (password.length < 8) return bad("wachtwoord_te_kort");
  const u = await env.DB.prepare("SELECT id, reset_expires FROM users WHERE reset_token=?1").bind(token).first();
  if (!u || !u.reset_expires || u.reset_expires < now()) return bad("token_ongeldig_of_verlopen", 400);
  const hash = await hashPassword(password);
  await env.DB.prepare("UPDATE users SET pass_hash=?2, reset_token=NULL, reset_expires=NULL WHERE id=?1").bind(u.id, hash).run();
  return json({ ok: true });
}

async function sendResetMail(env, email, token, isNew) {
  if (!env.RESEND_API_KEY) return;
  const link = `https://nijmegenduckstad.nl/admin-wachtwoord?token=${token}`;
  const titel = isNew ? "Stel je wachtwoord in" : "Wachtwoord opnieuw instellen";
  const intro = isNew
    ? "Er is een beheeraccount voor je aangemaakt voor het admin-dashboard van Nijmegen Duckstad. Stel hieronder je wachtwoord in."
    : "Je hebt een nieuw wachtwoord aangevraagd voor het admin-dashboard van Nijmegen Duckstad.";
  const html = `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#eef3fb;margin:0;padding:0;">
  <tr><td align="center" style="padding:24px 12px;font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="520" cellpadding="0" cellspacing="0" border="0" style="width:520px;max-width:520px;background:#fff;border-radius:16px;overflow:hidden;">
      <tr><td style="background:#17458f;padding:22px 28px;color:#fff;font-family:Georgia,serif;font-size:20px;font-weight:bold;">Nijmegen Duckstad &middot; admin</td></tr>
      <tr><td style="padding:26px 28px;color:#1d2433;font-size:15px;line-height:1.6;">
        <p style="margin:0 0 14px;font-weight:bold;">${titel}</p>
        <p style="margin:0 0 20px;color:#5b6679;">${intro}</p>
        <p style="margin:0 0 20px;"><a href="${link}" style="background:#f7a81b;color:#3a2600;font-weight:bold;text-decoration:none;padding:12px 22px;border-radius:999px;display:inline-block;">${titel}</a></p>
        <p style="margin:0;color:#8a94a6;font-size:12px;line-height:1.5;">Werkt de knop niet? Open: ${link}<br>Deze link verloopt vanzelf. Niet aangevraagd? Negeer deze mail.</p>
      </td></tr>
    </table>
  </td></tr>
</table>`;
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: "Bearer " + env.RESEND_API_KEY, "content-type": "application/json" },
      body: JSON.stringify({ from: env.MAIL_FROM || "Nijmegen Duckstad <info@nijmegenduckstad.nl>", reply_to: env.MAIL_REPLY_TO || "marco@marcovanthiel.nl", to: [email], subject: `${titel} — Nijmegen Duckstad admin`, html }),
    });
    if (!r.ok) console.error("reset_mail_fout", r.status, (await r.text().catch(() => "")).slice(0, 300));
  } catch (e) { console.error("reset_mail_exception", String((e && e.message) || e)); }
}

// Bevestigingsmail aan de inbrenger van een prijs. `subject`/`message` zijn door de
// admin aanpasbaar; `message` is platte tekst die we veilig naar HTML omzetten.
async function sendPrizeConfirmation(env, prize, subject, message) {
  const jaar = new Date().getFullYear();
  const prizeCard = `
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;">
          <tr><td style="background:#fff8e9;border:2px dashed #f7a81b;border-radius:14px;padding:14px 18px;font-family:Arial,Helvetica,sans-serif;">
            <div style="font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#9a7b22;font-weight:bold;">Ingebrachte prijs</div>
            <div style="font-family:Georgia,'Times New Roman',serif;font-size:21px;font-weight:bold;color:#17458f;line-height:1.2;margin-top:2px;">🎁 ${escHtml(prize.title)}${prize.value ? ` <span style="font-size:14px;color:#9a7b22;font-weight:normal;">${escHtml(prize.value)}</span>` : ""}</div>
          </td></tr>
        </table>`;
  const html = `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#eef3fb;margin:0;padding:0;">
  <tr><td align="center" style="padding:24px 12px;">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;background:#ffffff;border-radius:18px;overflow:hidden;">
      <tr><td style="background:#17458f;background:linear-gradient(135deg,#17458f,#0e2d63);padding:28px 30px;text-align:center;font-family:Georgia,serif;">
        <div style="font-size:12px;letter-spacing:.18em;text-transform:uppercase;color:#ffd60a;font-weight:bold;">Rotary Badeendjesrace</div>
        <div style="font-size:29px;color:#ffffff;font-weight:bold;margin-top:4px;">Nijmegen Duckstad 🦆</div>
      </td></tr>
      <tr><td style="padding:28px 34px 8px;font-family:Arial,Helvetica,sans-serif;color:#1d2433;font-size:16px;line-height:1.6;">
        ${htmlParagraphs(message)}
      </td></tr>
      <tr><td style="padding:4px 34px 22px;">${prizeCard}</td></tr>
      <tr><td style="background:#0e2d63;padding:26px 34px 28px;font-family:Arial,Helvetica,sans-serif;">
        <img src="https://nijmegenduckstad.nl/assets/img/rotary-nijmegen-stadenland.png" alt="Rotary Nijmegen Stad en Land" width="210" style="display:block;width:210px;max-width:210px;height:auto;background:#ffffff;border-radius:8px;padding:9px;">
        <p style="margin:14px 0 0;color:#cdd7ea;font-size:13px;line-height:1.6;">Met jouw bijdrage maken we er een mooie badeendjesrace van &mdash; de opbrengst gaat naar de goede doelen van Rotary Nijmegen Stad en Land.</p>
        <hr style="border:0;border-top:1px solid #1f3f72;margin:18px 0 14px;">
        <p style="margin:0 0 6px;color:#cdd7ea;font-size:12px;line-height:1.55;">Een initiatief van de <a href="https://www.rotary.nl/nijmegenstadenland/" style="color:#ffd60a;text-decoration:none;">Rotary club &ndash; Nijmegen Stad en Land</a>.</p>
        <p style="margin:0;color:#7d92b8;font-size:12px;line-height:1.55;">&copy; ${jaar} Rotary club &ndash; Nijmegen Stad en Land. Vragen of klopt er iets niet? Beantwoord gerust deze mail.</p>
      </td></tr>
    </table>
  </td></tr>
</table>`;
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: "Bearer " + env.RESEND_API_KEY, "content-type": "application/json" },
      body: JSON.stringify({
        from: env.MAIL_FROM || "Nijmegen Duckstad <info@nijmegenduckstad.nl>",
        reply_to: env.MAIL_REPLY_TO || "marco@marcovanthiel.nl",
        to: [prize.donor_email], subject, html,
      }),
    });
    if (!r.ok) {
      const t = (await r.text().catch(() => "")).slice(0, 300);
      console.error("prize_mail_fout", r.status, t);
      return { ok: false, error: "resend_" + r.status };
    }
    return { ok: true };
  } catch (e) { console.error("prize_mail_exception", String((e && e.message) || e)); return { ok: false, error: String((e && e.message) || e) }; }
}

async function adminApi(path, request, env) {
  const sub = path.slice("/api/admin/".length);

  // Publieke (sessieloze) endpoints
  if (sub === "login" && request.method === "POST") return doLogin(request, env);
  if (sub === "logout" && request.method === "POST") return doLogout(request, env);
  if (sub === "request-reset" && request.method === "POST") return doRequestReset(request, env);
  if (sub === "set-password" && request.method === "POST") return doSetPassword(request, env);

  // Vanaf hier: geldige sessie vereist
  const session = await resolveSession(request, env);
  if (!session) return json({ error: "unauthorized" }, 401);
  if (sub === "me") return json({ email: session.email, role: session.role });

  // Muteren mag alleen 'admin'; read-only mag bekijken + exports
  const ADMIN_ONLY = new Set(["delete-order", "setting", "manual-order", "winner", "draw-reset", "users", "user-role", "user-reset", "user-delete", "prize", "prize-delete", "prize-confirm"]);
  if (ADMIN_ONLY.has(sub) && session.role !== "admin") return json({ error: "forbidden" }, 403);

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
    const prizes = await env.DB.prepare("SELECT COUNT(*) AS n FROM prizes").first();
    return json({
      regular_sold: reg, business_sold: bus, max_regular: s.max_regular,
      paid_orders: agg.paid_orders, pending_orders: agg.pending_orders,
      revenue_cents: agg.revenue_cents, newsletter_count: agg.newsletter_count,
      draws: draws.n, prizes: prizes.n, sales_open: s.sales_open,
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
    return new Response("﻿" + csv(rows), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="eendjeslijst.csv"' } });
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

  // Winnaar invoeren: admin voert het winnende startnummer in (uit de race-uitslag).
  if (sub === "winner" && request.method === "POST") {
    const b = await request.json().catch(() => ({}));
    const prize = esc(b.prize).trim().slice(0, 160);
    const type = b.duck_type === "business" ? "business" : "regular";
    const number = parseInt(b.duck_number, 10);
    if (!prize) return bad("prijs_verplicht");
    if (!Number.isFinite(number)) return bad("startnummer_ongeldig");
    const duck = await env.DB.prepare(
      `SELECT d.type AS type, d.number AS number, o.id AS order_id, o.name AS name, o.email AS email
       FROM ducks d JOIN orders o ON o.id=d.order_id WHERE d.type=?1 AND d.number=?2`).bind(type, number).first();
    if (!duck) return bad("startnummer_niet_gevonden", 404);
    await env.DB.prepare(
      "INSERT INTO draws (created_at,prize,duck_type,duck_number,order_id,winner_name,winner_email) VALUES (?1,?2,?3,?4,?5,?6,?7)")
      .bind(now(), prize, duck.type, duck.number, duck.order_id, duck.name, duck.email).run();
    return json({ winner: { prize, type: duck.type, number: duck.number, name: duck.name, email: duck.email } });
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

  // Bestelling verwijderen: nummers komen vrij (hergebruikbaar), betaling/nummers/order weg uit het systeem.
  if (sub === "delete-order" && request.method === "POST") {
    const b = await request.json().catch(() => ({}));
    const id = String(b.id || "");
    if (!id) return bad("id_verplicht");
    const o = await env.DB.prepare("SELECT id FROM orders WHERE id=?1").bind(id).first();
    if (!o) return bad("niet_gevonden", 404);
    await env.DB.batch([
      env.DB.prepare("DELETE FROM ducks WHERE order_id=?1").bind(id),
      env.DB.prepare("DELETE FROM draws WHERE order_id=?1").bind(id),
      env.DB.prepare("DELETE FROM orders WHERE id=?1").bind(id),
    ]);
    return json({ ok: true });
  }

  /* ----- prijzen & inbrengers ----- */
  // Lijst (read-only mag bekijken).
  if (sub === "prizes" && request.method === "GET") {
    const r = await env.DB.prepare("SELECT * FROM prizes ORDER BY created_at DESC").all();
    return json({ prizes: r.results || [] });
  }
  // Toevoegen of bijwerken (admin-only). Met `id` => update, anders insert.
  if (sub === "prize" && request.method === "POST") {
    const b = await request.json().catch(() => ({}));
    const title = esc(b.title).trim().slice(0, 200);
    const donor_name = esc(b.donor_name).trim().slice(0, 160);
    if (!title) return bad("prijs_verplicht");
    if (!donor_name) return bad("inbrenger_verplicht");
    const value = esc(b.value).trim().slice(0, 120);
    const description = esc(b.description).trim().slice(0, 1000);
    const donor_company = esc(b.donor_company).trim().slice(0, 160);
    const donor_email = esc(b.donor_email).trim().slice(0, 200);
    const donor_phone = esc(b.donor_phone).trim().slice(0, 60);
    const conditions = esc(b.conditions).trim().slice(0, 2000);
    if (donor_email && !isEmail(donor_email)) return bad("email_ongeldig");
    if (b.id) {
      const ex = await env.DB.prepare("SELECT id FROM prizes WHERE id=?1").bind(String(b.id)).first();
      if (!ex) return bad("niet_gevonden", 404);
      await env.DB.prepare(
        "UPDATE prizes SET title=?2,value=?3,description=?4,donor_name=?5,donor_company=?6,donor_email=?7,donor_phone=?8,conditions=?9 WHERE id=?1")
        .bind(String(b.id), title, value, description, donor_name, donor_company, donor_email, donor_phone, conditions).run();
      return json({ ok: true, id: String(b.id) });
    }
    const id = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO prizes (id,created_at,title,value,description,donor_name,donor_company,donor_email,donor_phone,conditions) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)")
      .bind(id, now(), title, value, description, donor_name, donor_company, donor_email, donor_phone, conditions).run();
    return json({ ok: true, id });
  }
  if (sub === "prize-delete" && request.method === "POST") {
    const b = await request.json().catch(() => ({}));
    const id = String(b.id || "");
    if (!id) return bad("id_verplicht");
    await env.DB.prepare("DELETE FROM prizes WHERE id=?1").bind(id).run();
    return json({ ok: true });
  }
  // Bevestigingsmail naar de inbrenger (admin-only). Onderwerp + bericht zijn
  // door de admin aangepast vóór verzending.
  if (sub === "prize-confirm" && request.method === "POST") {
    const b = await request.json().catch(() => ({}));
    const id = String(b.id || "");
    const subject = esc(b.subject).trim().slice(0, 200);
    const message = esc(b.message);
    if (!id) return bad("id_verplicht");
    if (!subject) return bad("onderwerp_verplicht");
    if (!message.trim()) return bad("bericht_verplicht");
    const prize = await env.DB.prepare("SELECT * FROM prizes WHERE id=?1").bind(id).first();
    if (!prize) return bad("niet_gevonden", 404);
    if (!prize.donor_email) return bad("geen_inbrenger_email");
    if (!env.RESEND_API_KEY) return bad("mail_niet_geconfigureerd", 503);
    const res = await sendPrizeConfirmation(env, prize, subject, message);
    if (!res.ok) return bad("mail_mislukt: " + res.error, 502);
    await env.DB.prepare("UPDATE prizes SET confirmation_sent_at=?2 WHERE id=?1").bind(id, now()).run();
    return json({ ok: true });
  }

  /* ----- gebruikersbeheer (admin-only) ----- */
  if (sub === "users" && request.method === "GET") {
    const r = await env.DB.prepare("SELECT id, email, role, created_at, (pass_hash IS NOT NULL) AS has_pw FROM users ORDER BY email").all();
    return json({ users: r.results || [], me: session.email });
  }
  if (sub === "users" && request.method === "POST") {
    const b = await request.json().catch(() => ({}));
    const email = String(b.email || "").trim().toLowerCase();
    const role = b.role === "admin" ? "admin" : "readonly";
    if (!isEmail(email)) return bad("email_ongeldig");
    const exists = await env.DB.prepare("SELECT id FROM users WHERE email=?1").bind(email).first();
    if (exists) return bad("bestaat_al", 409);
    const id = crypto.randomUUID();
    const token = randToken();
    const exp = new Date(Date.now() + 72 * 3600 * 1000).toISOString();
    await env.DB.prepare("INSERT INTO users (id,email,role,created_at,reset_token,reset_expires) VALUES (?1,?2,?3,?4,?5,?6)")
      .bind(id, email, role, now(), token, exp).run();
    await sendResetMail(env, email, token, true);
    return json({ ok: true, mailed: !!env.RESEND_API_KEY });
  }
  if (sub === "user-role" && request.method === "POST") {
    const b = await request.json().catch(() => ({}));
    const id = String(b.id || "");
    const role = b.role === "admin" ? "admin" : "readonly";
    if (role !== "admin") {
      const t = await env.DB.prepare("SELECT role FROM users WHERE id=?1").bind(id).first();
      const admins = await env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE role='admin'").first();
      if (t && t.role === "admin" && admins.n <= 1) return bad("laatste_admin", 409);
    }
    await env.DB.prepare("UPDATE users SET role=?2 WHERE id=?1").bind(id, role).run();
    return json({ ok: true });
  }
  if (sub === "user-reset" && request.method === "POST") {
    const b = await request.json().catch(() => ({}));
    const u = await env.DB.prepare("SELECT id, email FROM users WHERE id=?1").bind(String(b.id || "")).first();
    if (!u) return bad("niet_gevonden", 404);
    const token = randToken();
    const exp = new Date(Date.now() + 72 * 3600 * 1000).toISOString();
    await env.DB.prepare("UPDATE users SET reset_token=?2, reset_expires=?3 WHERE id=?1").bind(u.id, token, exp).run();
    await sendResetMail(env, u.email, token, false);
    return json({ ok: true, mailed: !!env.RESEND_API_KEY });
  }
  if (sub === "user-delete" && request.method === "POST") {
    const b = await request.json().catch(() => ({}));
    const u = await env.DB.prepare("SELECT id, email, role FROM users WHERE id=?1").bind(String(b.id || "")).first();
    if (!u) return bad("niet_gevonden", 404);
    if (u.email === session.email) return bad("niet_jezelf_verwijderen", 409);
    if (u.role === "admin") {
      const admins = await env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE role='admin'").first();
      if (admins.n <= 1) return bad("laatste_admin", 409);
    }
    await env.DB.batch([
      env.DB.prepare("DELETE FROM users WHERE id=?1").bind(u.id),
      env.DB.prepare("DELETE FROM sessions WHERE user_id=?1").bind(u.id),
    ]);
    return json({ ok: true });
  }

  return bad("onbekende_admin-route", 404);
}
