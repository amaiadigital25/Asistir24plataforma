const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const basesDoc = require("./data/bases.json");
const { ensureWorkflow, cambiarEstado, buildRemito } = require("./src/workflow");
const { parseClaimsMail } = require("./src/claims-mail-parser");

const app = express();
const PORT = process.env.PORT || 3000;
app.use(express.json({ limit: "100kb" }));
app.use(cors({ origin: process.env.APP_ORIGIN || true, credentials: false }));

const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(64).toString("hex");
if (!process.env.JWT_SECRET) console.warn("[Asistir24] JWT_SECRET no configurado: clave temporal por arranque.");
const ADMIN_USER = process.env.ADMIN_USER || "admin";
const FALLBACK_SALT = "939d696df209329913ecaa38ae8b0ca2";
const FALLBACK_HASH = "e260eb5c451c4702ca7b611408f2aff4125c08384d012ce6f158a0c513f3f9f766270bbd9e26723ed59bb3251a5f6f247b93a6b79226eb0d6924cf3ca2e46939";
const TARIFA_COMPANIA = Object.freeze({ movida: 43989, km: 1199, moneda: "ARS", configured: true });
const TARIFA_PARTICULAR = Object.freeze({ movida: 60000, km: 2000, moneda: "ARS", configured: true });
const TARIFAS = Object.freeze({ COMPANIA: TARIFA_COMPANIA, PARTICULAR: TARIFA_PARTICULAR });
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, "database.json");
const FACTURACION_ESTADOS = ["PENDIENTE", "LISTO_PARA_FACTURAR", "FACTURADO", "COBRADO"];
const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.modify";
const GMAIL_EXPECTED_ACCOUNT = process.env.GMAIL_ACCOUNT || "asistir24operadores@gmail.com";
const GMAIL_AUTO_ENABLED = String(process.env.GMAIL_AUTO_ENABLED || "").toLowerCase() === "true";
const GMAIL_POLL_MS = Math.max(60000, Number(process.env.GMAIL_POLL_MS || 120000));

function tarifaPorTipoCliente(tipoCliente) {
  return String(tipoCliente || "").toUpperCase() === "PARTICULAR" ? TARIFAS.PARTICULAR : TARIFAS.COMPANIA;
}
function readData() {
  try {
    const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    return data && typeof data === "object" ? data : {};
  } catch (error) {
    if (error.code !== "ENOENT") console.error("[Asistir24] No se pudo leer la base:", error.message);
    return {};
  }
}
function writeData(data) {
  const temp = DATA_FILE + ".tmp";
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(temp, JSON.stringify(data, null, 2));
  fs.renameSync(temp, DATA_FILE);
}
function saveCollection(key, items) {
  const data = readData();
  data[key] = items;
  writeData(data);
}
const initialData = readData();
let cotizaciones = Array.isArray(initialData.cotizaciones) ? initialData.cotizaciones : [];
let emergencias = Array.isArray(initialData.emergencias) ? initialData.emergencias : [];

function readUsers() {
  const data = readData();
  return Array.isArray(data.users) ? data.users : [];
}
function writeUsers(users) {
  const data = readData();
  data.users = users;
  writeData(data);
}
function publicUser(user) {
  return { id: user.id, username: user.username, name: user.name || user.username, role: user.role, active: user.active !== false, createdAt: user.createdAt || null };
}
function passwordOk(input) {
  const provided = String(input || "");
  if (process.env.ADMIN_PASSWORD) {
    const a = crypto.createHash("sha256").update(provided).digest();
    const b = crypto.createHash("sha256").update(process.env.ADMIN_PASSWORD).digest();
    return crypto.timingSafeEqual(a, b);
  }
  const derived = crypto.scryptSync(provided, Buffer.from(FALLBACK_SALT, "hex"), 64).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(derived, "hex"), Buffer.from(FALLBACK_HASH, "hex"));
}
function makeToken(user, role, id = null) {
  return jwt.sign({ user, role, id }, JWT_SECRET, { expiresIn: "8h" });
}
function adminOnly(req, res, next) {
  if (req.user.role !== "admin") return res.status(403).json({ error: "Acceso exclusivo para administradores" });
  next();
}
function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return res.status(401).json({ error: "No autorizado" });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    if (req.user.id) {
      const current = readUsers().find(item => String(item.id) === String(req.user.id));
      if (!current || current.active === false) return res.status(401).json({ error: "Usuario bloqueado o eliminado" });
      req.user.role = current.role;
      req.user.user = current.username;
    }
    next();
  } catch {
    return res.status(401).json({ error: "Sesion vencida o token invalido" });
  }
}
function asKm(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}
function ensureFacturacion(cotizacion) {
  if (!cotizacion.facturacion || typeof cotizacion.facturacion !== "object") {
    cotizacion.facturacion = { estado: "PENDIENTE", facturaNumero: "", fechaFactura: null, cae: "", caeVencimiento: null, observaciones: "", updatedAt: null, updatedBy: null };
  }
  if (!FACTURACION_ESTADOS.includes(cotizacion.facturacion.estado)) cotizacion.facturacion.estado = "PENDIENTE";
  return cotizacion.facturacion;
}
cotizaciones.forEach(item => {
  ensureFacturacion(item);
  ensureWorkflow(item);
  if (!item.remito || typeof item.remito !== "object") item.remito = buildRemito(item);
});

function gmailConfigured() {
  return Boolean(process.env.GMAIL_CLIENT_ID && process.env.GMAIL_CLIENT_SECRET && process.env.GMAIL_REDIRECT_URI);
}
function gmailEncryptionKey() {
  return crypto.createHash("sha256").update("asistir24:gmail:" + JWT_SECRET).digest();
}
function encryptSecret(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", gmailEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64url"), tag.toString("base64url"), encrypted.toString("base64url")].join(".");
}
function decryptSecret(value) {
  const [ivText, tagText, encryptedText] = String(value || "").split(".");
  if (!ivText || !tagText || !encryptedText) throw new Error("Credencial de Gmail inválida");
  const decipher = crypto.createDecipheriv("aes-256-gcm", gmailEncryptionKey(), Buffer.from(ivText, "base64url"));
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encryptedText, "base64url")), decipher.final()]).toString("utf8");
}
function readGmailConnection() {
  const data = readData();
  return data.gmail && typeof data.gmail === "object" ? data.gmail : null;
}
function writeGmailConnection(connection) {
  const data = readData();
  if (connection) data.gmail = connection;
  else delete data.gmail;
  writeData(data);
}
function processedMailIds() {
  const data = readData();
  return new Set(Array.isArray(data.gmailProcessedIds) ? data.gmailProcessedIds : []);
}
function markMailProcessed(id, detail = {}) {
  const data = readData();
  const ids = Array.isArray(data.gmailProcessedIds) ? data.gmailProcessedIds : [];
  if (!ids.includes(id)) ids.unshift(id);
  data.gmailProcessedIds = ids.slice(0, 3000);
  const events = Array.isArray(data.gmailEvents) ? data.gmailEvents : [];
  events.unshift({ messageId: id, at: new Date().toISOString(), ...detail });
  data.gmailEvents = events.slice(0, 1000);
  writeData(data);
}
async function exchangeGmailCode(code) {
  const body = new URLSearchParams({
    code,
    client_id: process.env.GMAIL_CLIENT_ID,
    client_secret: process.env.GMAIL_CLIENT_SECRET,
    redirect_uri: process.env.GMAIL_REDIRECT_URI,
    grant_type: "authorization_code"
  });
  const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error_description || data.error || "Google no pudo completar la autorización");
  return data;
}
async function refreshGmailAccessToken() {
  const connection = readGmailConnection();
  if (!connection?.refreshToken) throw new Error("Gmail todavía no está conectado");
  const body = new URLSearchParams({
    client_id: process.env.GMAIL_CLIENT_ID,
    client_secret: process.env.GMAIL_CLIENT_SECRET,
    refresh_token: decryptSecret(connection.refreshToken),
    grant_type: "refresh_token"
  });
  const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  const data = await response.json();
  if (!response.ok || !data.access_token) throw new Error(data.error_description || data.error || "No se pudo renovar el acceso a Gmail");
  return data.access_token;
}
async function gmailApi(pathname, token) {
  const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/" + pathname, { headers: { Authorization: "Bearer " + token } });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || "Error de Gmail");
  return data;
}
function decodeBase64Url(data) {
  return Buffer.from(String(data || "").replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}
function extractBody(payload) {
  if (!payload) return "";
  if (payload.body?.data) return decodeBase64Url(payload.body.data);
  const parts = Array.isArray(payload.parts) ? payload.parts : [];
  for (const mime of ["text/plain", "text/html"]) {
    const part = parts.find(p => p.mimeType === mime && p.body?.data);
    if (part) return decodeBase64Url(part.body.data).replace(/<[^>]+>/g, " ");
  }
  for (const part of parts) {
    const body = extractBody(part);
    if (body) return body;
  }
  return "";
}
function headerValue(payload, name) {
  return (payload?.headers || []).find(x => String(x.name || "").toLowerCase() === name.toLowerCase())?.value || "";
}
function gmailAfterEpoch() {
  const connection = readGmailConnection();
  if (!connection?.connectedAt) return Math.floor(Date.now() / 1000);
  const ts = Date.parse(connection.connectedAt);
  return Number.isFinite(ts) ? Math.floor(ts / 1000) : Math.floor(Date.now() / 1000);
}
async function listRecentClaims(token) {
  const query = `from:noreply@claimservices.com.ar after:${gmailAfterEpoch()}`;
  const data = await gmailApi(`messages?q=${encodeURIComponent(query)}&maxResults=50`, token);
  return Array.isArray(data.messages) ? data.messages : [];
}
async function getGmailMessage(token, id) {
  return gmailApi(`messages/${encodeURIComponent(id)}?format=full`, token);
}
function findBaseForAddress(address) {
  const text = String(address || "").toLowerCase();
  const active = basesDoc.bases.filter(b => b.estado === "ACTIVO");
  const direct = active.find(b => text.includes(String(b.base || "").toLowerCase())) ||
    active.find(b => text.includes(String(b.zona || "").toLowerCase()));
  if (direct) return direct;
  const interior = /mendoza|cordoba|córdoba|santa fe|entre rios|entre ríos|misiones|chaco|salta|tucuman|tucumán|la pampa|santa cruz/i.test(text);
  return active.find(b => b.modalidad === (interior ? "INTERIOR" : "AMBA_CABA")) || active[0] || basesDoc.bases[0];
}
async function geocodeGoogle(address) {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) throw new Error("Google Maps todavía no está configurado en el servidor");
  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("address", address);
  url.searchParams.set("region", "ar");
  url.searchParams.set("key", key);
  const response = await fetch(url);
  const data = await response.json();
  if (!response.ok || data.status !== "OK" || !data.results?.[0]) throw new Error("No se pudo localizar: " + address);
  return data.results[0].geometry.location;
}
async function routeKmGoogle(origin, destination) {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  const response = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key, "X-Goog-FieldMask": "routes.distanceMeters" },
    body: JSON.stringify({
      origin: { location: { latLng: { latitude: origin.lat, longitude: origin.lng } } },
      destination: { location: { latLng: { latitude: destination.lat, longitude: destination.lng } } },
      travelMode: "DRIVE",
      routingPreference: "TRAFFIC_UNAWARE"
    })
  });
  const data = await response.json();
  const meters = data.routes?.[0]?.distanceMeters;
  if (!response.ok || !Number.isFinite(meters)) throw new Error(data.error?.message || "Google Maps no pudo calcular el recorrido");
  return Math.round((meters / 1000) * 10) / 10;
}
async function quoteFromMail(parsed, gmailMeta) {
  if (!parsed.asistenciaId || !parsed.patente || !parsed.origen) throw new Error("Mail incompleto para cotizar");
  const existing = cotizaciones.find(q => String(q.numeroServicio) === String(parsed.asistenciaId));
  if (existing) return { quote: existing, created: false };

  const base = findBaseForAddress(parsed.origen);
  const modalidad = base?.modalidad === "INTERIOR" ? "INTERIOR" : "AMBA_CABA";
  const tipoServicio = parsed.tipoServicio || "Liviano";
  const tarifa = TARIFA_COMPANIA;
  const baseTexto = [base.base, base.zona, "Argentina"].filter(Boolean).join(", ");
  const [baseCoord, origenCoord] = await Promise.all([
    geocodeGoogle(baseTexto),
    geocodeGoogle(parsed.origen + ", Argentina")
  ]);
  const k1 = await routeKmGoogle(baseCoord, origenCoord);
  let k2 = 0;
  let k3 = 0;
  if (parsed.destino && tipoServicio !== "Auxilio mecanico") {
    const destinoCoord = await geocodeGoogle(parsed.destino + ", Argentina");
    k2 = await routeKmGoogle(origenCoord, destinoCoord);
    if (modalidad === "INTERIOR") k3 = await routeKmGoogle(destinoCoord, baseCoord);
  }
  const kmTotal = k1 + k2 + (modalidad === "INTERIOR" ? k3 : 0);
  if (!(kmTotal > 0)) throw new Error("No se pudo obtener una distancia válida; la cotización queda pendiente de reintento");
  const subtotalKm = Math.round(kmTotal * tarifa.km);
  const total = Math.round(tarifa.movida + subtotalKm);
  const fecha = new Date().toISOString();
  const q = {
    id: "COT-" + Date.now(),
    fecha,
    operador: "gmail-auto",
    empresa: parsed.empresa || "Compañía",
    numeroServicio: String(parsed.asistenciaId),
    patente: String(parsed.patente).toUpperCase(),
    tipoCliente: "COMPANIA",
    base: { id: base.id, prestador: base.prestador, base: base.base, zona: base.zona, modalidad },
    tipoServicio,
    origen: parsed.origen,
    destino: parsed.destino || "",
    tramos: { baseOrigen: k1, origenDestino: k2, destinoBase: modalidad === "INTERIOR" ? k3 : 0 },
    kmTotal,
    tarifa: { movida: tarifa.movida, km: tarifa.km, moneda: tarifa.moneda },
    subtotalKm,
    total,
    gmail: { messageId: gmailMeta.id, threadId: gmailMeta.threadId || null, subject: gmailMeta.subject || "", receivedAt: gmailMeta.receivedAt || fecha },
    datosMail: {
      vehiculo: parsed.vehiculo || "",
      observaciones: parsed.observaciones || "",
      asegurado: parsed.asegurado || "",
      telefono: parsed.telefono || "",
      emailAsegurado: parsed.emailAsegurado || ""
    },
    facturacion: { estado: "PENDIENTE", facturaNumero: "", fechaFactura: null, cae: "", caeVencimiento: null, observaciones: "", updatedAt: null, updatedBy: null },
    flujo: {
      estado: "ESPERANDO_CONFIRMACION",
      mailRecibidoAt: fecha,
      cotizacionListaAt: fecha,
      remitoListoAt: fecha,
      confirmadoAt: null,
      confirmadoBy: null,
      whatsappListoAt: null,
      whatsappEnviadoAt: null,
      whatsappEnviadoBy: null,
      enServicioAt: null,
      finalizadoAt: null,
      updatedAt: fecha,
      updatedBy: "gmail-auto",
      historial: [
        { fecha, desde: "MAIL_RECIBIDO", hacia: "PROCESANDO", usuario: "gmail-auto", detalle: "Mail de Claims recibido" },
        { fecha, desde: "PROCESANDO", hacia: "COTIZACION_LISTA", usuario: "gmail-auto", detalle: "Cotizacion armada automaticamente" },
        { fecha, desde: "COTIZACION_LISTA", hacia: "REMITO_LISTO", usuario: "gmail-auto", detalle: "Remito preparado sin importes" },
        { fecha, desde: "REMITO_LISTO", hacia: "ESPERANDO_CONFIRMACION", usuario: "gmail-auto", detalle: "Esperando mail de asignacion" }
      ]
    }
  };
  q.remito = buildRemito(q);
  cotizaciones.unshift(q);
  cotizaciones = cotizaciones.slice(0, 5000);
  saveCollection("cotizaciones", cotizaciones);
  return { quote: q, created: true };
}
function confirmFromMail(parsed, gmailMeta) {
  if (!parsed.asistenciaId) return { quote: null, changed: false };
  const q = cotizaciones.find(item => String(item.numeroServicio) === String(parsed.asistenciaId));
  if (!q) return { quote: null, changed: false };
  const flujo = ensureWorkflow(q);
  if (["LISTO_PARA_WHATSAPP", "ENVIADO_WHATSAPP", "EN_SERVICIO", "FINALIZADO"].includes(flujo.estado)) return { quote: q, changed: false };
  cambiarEstado(q, "CONFIRMADO", "gmail-auto", "Confirmacion recibida por Gmail");
  q.flujo.confirmadoAt = q.flujo.updatedAt;
  q.flujo.confirmadoBy = "gmail-auto";
  q.gmailConfirmacion = { messageId: gmailMeta.id, threadId: gmailMeta.threadId || null, subject: gmailMeta.subject || "", receivedAt: gmailMeta.receivedAt || new Date().toISOString() };
  cambiarEstado(q, "LISTO_PARA_WHATSAPP", "gmail-auto", "Servicio habilitado para envio manual por WhatsApp");
  q.flujo.whatsappListoAt = q.flujo.updatedAt;
  saveCollection("cotizaciones", cotizaciones);
  return { quote: q, changed: true };
}
let gmailPollRunning = false;
async function pollGmail({ force = false } = {}) {
  if (gmailPollRunning || (!force && !GMAIL_AUTO_ENABLED) || !gmailConfigured() || !readGmailConnection()?.refreshToken) return { skipped: true };
  gmailPollRunning = true;
  let processed = 0, quoted = 0, confirmed = 0, errors = 0;
  try {
    const token = await refreshGmailAccessToken();
    const ids = await listRecentClaims(token);
    const seen = processedMailIds();
    for (const ref of ids.reverse()) {
      if (seen.has(ref.id)) continue;
      try {
        const msg = await getGmailMessage(token, ref.id);
        const subject = headerValue(msg.payload, "Subject");
        const body = extractBody(msg.payload);
        const parsed = parseClaimsMail({ messageId: msg.id, threadId: msg.threadId, subject, body });
        const meta = { id: msg.id, threadId: msg.threadId, subject, receivedAt: msg.internalDate ? new Date(Number(msg.internalDate)).toISOString() : new Date().toISOString() };
        if (parsed.evento === "COTIZAR") {
          const result = await quoteFromMail(parsed, meta);
          if (result.created) quoted++;
          markMailProcessed(ref.id, { evento: "COTIZAR", asistenciaId: parsed.asistenciaId, subject });
        } else if (parsed.evento === "CONFIRMACION") {
          const result = confirmFromMail(parsed, meta);
          if (result.changed) confirmed++;
          markMailProcessed(ref.id, { evento: "CONFIRMACION", asistenciaId: parsed.asistenciaId, subject });
        } else {
          markMailProcessed(ref.id, { evento: "REVISAR", asistenciaId: parsed.asistenciaId, subject });
        }
        processed++;
      } catch (error) {
        errors++;
        console.error("[Asistir24] Error procesando Gmail", ref.id, error.message);
      }
    }
    return { processed, quoted, confirmed, errors };
  } catch (error) {
    console.error("[Asistir24] Error polling Gmail:", error.message);
    return { error: error.message, processed, quoted, confirmed, errors: errors + 1 };
  } finally {
    gmailPollRunning = false;
  }
}

app.get("/health", (req, res) => res.json({ ok: true, app: "Asistir24 Plataforma Cerrada", bases: basesDoc.bases.length, version: "gmail-workflow-3", gmailAuto: GMAIL_AUTO_ENABLED }));

app.post(["/login", "/api/login"], (req, res) => {
  const { username, password } = req.body || {};
  const normalized = String(username || "").trim().toLowerCase();
  if (normalized === ADMIN_USER.toLowerCase() && passwordOk(password)) {
    return res.json({ success: true, token: makeToken(ADMIN_USER, "admin"), role: "admin", user: ADMIN_USER });
  }
  const user = readUsers().find(item => item.username.toLowerCase() === normalized);
  if (!user || user.active === false || !bcrypt.compareSync(String(password || ""), user.password)) {
    return res.status(401).json({ success: false, error: "Credenciales incorrectas o usuario bloqueado" });
  }
  res.json({ success: true, token: makeToken(user.username, user.role, user.id), role: user.role, user: user.username });
});
app.get("/api/me", auth, (req, res) => res.json({ user: req.user.user, role: req.user.role }));

app.get("/api/users", auth, adminOnly, (req, res) => res.json({ items: readUsers().map(publicUser) }));
app.post("/api/users", auth, adminOnly, (req, res) => {
  const username = String(req.body?.username || "").trim().toLowerCase();
  const name = String(req.body?.name || "").trim();
  const password = String(req.body?.password || "");
  const role = req.body?.role === "admin" ? "admin" : "operador";
  if (!/^[a-z0-9._-]{3,40}$/.test(username)) return res.status(400).json({ error: "El usuario debe tener entre 3 y 40 caracteres validos" });
  if (password.length < 8) return res.status(400).json({ error: "La contraseña debe tener al menos 8 caracteres" });
  const users = readUsers();
  if (username === ADMIN_USER.toLowerCase() || users.some(item => item.username.toLowerCase() === username)) return res.status(409).json({ error: "Ese nombre de usuario ya existe" });
  const user = { id: crypto.randomUUID(), username, name: name || username, password: bcrypt.hashSync(password, 12), role, active: true, createdAt: new Date().toISOString() };
  users.push(user);
  writeUsers(users);
  res.status(201).json({ user: publicUser(user) });
});
app.patch("/api/users/:id", auth, adminOnly, (req, res) => {
  const users = readUsers();
  const user = users.find(item => String(item.id) === req.params.id);
  if (!user) return res.status(404).json({ error: "Usuario no encontrado" });
  if (typeof req.body?.active === "boolean") user.active = req.body.active;
  if (["admin", "operador"].includes(req.body?.role)) user.role = req.body.role;
  if (req.body?.name !== undefined) user.name = String(req.body.name).trim() || user.username;
  if (req.body?.password !== undefined) {
    const p = String(req.body.password);
    if (p.length < 8) return res.status(400).json({ error: "La contraseña debe tener al menos 8 caracteres" });
    user.password = bcrypt.hashSync(p, 12);
  }
  writeUsers(users);
  res.json({ user: publicUser(user) });
});
app.delete("/api/users/:id", auth, adminOnly, (req, res) => {
  const users = readUsers();
  const index = users.findIndex(item => String(item.id) === req.params.id);
  if (index === -1) return res.status(404).json({ error: "Usuario no encontrado" });
  if (String(users[index].id) === String(req.user.id)) return res.status(400).json({ error: "No puede eliminar su propio usuario" });
  const [removed] = users.splice(index, 1);
  writeUsers(users);
  res.json({ success: true, user: publicUser(removed) });
});

app.get("/api/gmail/status", auth, adminOnly, async (req, res) => {
  const c = readGmailConnection();
  const result = { configured: gmailConfigured(), connected: Boolean(c?.refreshToken), email: c?.email || null, connectedAt: c?.connectedAt || null, autoEnabled: GMAIL_AUTO_ENABLED, pollMs: GMAIL_POLL_MS };
  if (result.connected && gmailConfigured()) {
    try {
      const token = await refreshGmailAccessToken();
      const profile = await gmailApi("profile", token);
      result.email = profile.emailAddress || result.email;
      result.verified = true;
    } catch (error) {
      result.verified = false;
      result.error = error.message;
    }
  }
  res.json(result);
});
app.get("/api/gmail/oauth/start", auth, adminOnly, (req, res) => {
  if (!gmailConfigured()) return res.status(503).json({ error: "Faltan variables OAuth de Gmail en Railway" });
  const state = jwt.sign({ purpose: "gmail-oauth", user: req.user.user }, JWT_SECRET, { expiresIn: "10m" });
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", process.env.GMAIL_CLIENT_ID);
  url.searchParams.set("redirect_uri", process.env.GMAIL_REDIRECT_URI);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GMAIL_SCOPE);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("login_hint", GMAIL_EXPECTED_ACCOUNT);
  url.searchParams.set("state", state);
  res.json({ authorizationUrl: url.toString(), account: GMAIL_EXPECTED_ACCOUNT });
});
app.get("/api/gmail/oauth/callback", async (req, res) => {
  try {
    if (req.query.error) throw new Error("Google rechazó la autorización: " + req.query.error);
    const code = String(req.query.code || "");
    const state = String(req.query.state || "");
    if (!code || !state) throw new Error("Faltan datos de autorización");
    const decoded = jwt.verify(state, JWT_SECRET);
    if (decoded.purpose !== "gmail-oauth") throw new Error("Estado OAuth inválido");
    const tokens = await exchangeGmailCode(code);
    const profile = await gmailApi("profile", tokens.access_token);
    const email = String(profile.emailAddress || "").toLowerCase();
    if (GMAIL_EXPECTED_ACCOUNT && email !== GMAIL_EXPECTED_ACCOUNT.toLowerCase()) throw new Error("Se autorizó " + email + ", pero debe conectarse " + GMAIL_EXPECTED_ACCOUNT);
    const previous = readGmailConnection();
    const refreshToken = tokens.refresh_token ? encryptSecret(tokens.refresh_token) : previous?.refreshToken;
    if (!refreshToken) throw new Error("Google no devolvió refresh token");
    const connectedAt = new Date().toISOString();
    writeGmailConnection({ email, refreshToken, scope: tokens.scope || GMAIL_SCOPE, connectedAt, connectedBy: decoded.user || "admin" });
    res.redirect("/admin?gmail=connected");
    if (GMAIL_AUTO_ENABLED) setTimeout(() => pollGmail(), 1000);
  } catch (error) {
    console.error("[Asistir24 Gmail] OAuth:", error.message);
    res.status(400).send("No se pudo conectar Gmail: " + error.message);
  }
});
app.post("/api/gmail/disconnect", auth, adminOnly, (req, res) => {
  writeGmailConnection(null);
  res.json({ success: true, connected: false });
});
app.post("/api/gmail/sync", auth, adminOnly, async (req, res) => {
  res.json({ success: true, ...(await pollGmail({ force: true })) });
});

app.get("/api/config", auth, (req, res) => {
  res.json({
    tarifa: TARIFA_COMPANIA,
    tarifas: TARIFAS,
    reglas: { AMBA_CABA: "Base -> Origen -> Destino", INTERIOR: "Base -> Origen -> Destino -> Base", AUXILIO_MECANICO: "Base -> Origen" },
    tiposServicio: ["Liviano", "Moto", "Auxilio mecanico", "Semipesado"],
    notaDistancias: "Los kilómetros Base-Origen se calculan automáticamente con Google Maps a partir de la base y la ubicación ingresada."
  });
});
app.post("/api/distancia", auth, async (req, res) => {
  try {
    const base = basesDoc.bases.find(item => item.id === req.body?.baseId);
    const origenTexto = String(req.body?.origen || "").trim();
    if (!base) return res.status(400).json({ error: "Base inválida" });
    if (!origenTexto) return res.status(400).json({ error: "Ingrese la ubicación de origen" });
    const baseTexto = [base.base, base.zona, "Argentina"].filter(Boolean).join(", ");
    const [baseCoord, origenCoord] = await Promise.all([geocodeGoogle(baseTexto), geocodeGoogle(origenTexto + ", Argentina")]);
    const km = await routeKmGoogle(baseCoord, origenCoord);
    res.json({ km, desde: baseTexto, hasta: origenTexto });
  } catch (error) {
    res.status(503).json({ error: error.message || "No se pudo calcular la distancia" });
  }
});
app.get("/api/bases", auth, (req, res) => {
  const { modalidad, estado, q } = req.query;
  let items = basesDoc.bases.slice();
  if (modalidad) items = items.filter(b => b.modalidad === modalidad);
  if (estado) items = items.filter(b => b.estado === estado);
  if (q) {
    const term = String(q).toLowerCase();
    items = items.filter(b => [b.prestador, b.base, b.zona, b.tipo, b.estado].join(" ").toLowerCase().includes(term));
  }
  res.json({ total: items.length, items });
});
app.get("/api/resumen", auth, (req, res) => {
  const count = key => basesDoc.bases.filter(b => b.modalidad === key).length;
  const billing = { pendiente: 0, listo: 0, facturado: 0, cobrado: 0 };
  cotizaciones.forEach(item => {
    const estado = ensureFacturacion(item).estado;
    if (estado === "PENDIENTE") billing.pendiente++;
    if (estado === "LISTO_PARA_FACTURAR") billing.listo++;
    if (estado === "FACTURADO") billing.facturado++;
    if (estado === "COBRADO") billing.cobrado++;
  });
  res.json({
    bases: {
      total: basesDoc.bases.length,
      ambaCaba: count("AMBA_CABA"),
      interior: count("INTERIOR"),
      activas: basesDoc.bases.filter(b => b.estado === "ACTIVO").length,
      pendientes: basesDoc.bases.filter(b => b.estado === "PENDIENTE").length
    },
    cotizaciones: cotizaciones.length,
    facturacion: billing,
    tarifa: TARIFA_COMPANIA,
    tarifas: TARIFAS
  });
});
app.post("/api/cotizar", auth, (req, res) => {
  const { baseId, modalidad, tipoServicio, tipoCliente, origen, destino, kmBaseOrigen, kmOrigenDestino, kmDestinoBase, empresa, numeroServicio, patente } = req.body || {};
  const base = basesDoc.bases.find(b => b.id === baseId);
  if (!base) return res.status(400).json({ error: "Base invalida" });
  const modalidadCotizacion = ["AMBA_CABA", "INTERIOR"].includes(modalidad) ? modalidad : base.modalidad;
  const tipoClienteCotizacion = String(tipoCliente || "").toUpperCase() === "PARTICULAR" ? "PARTICULAR" : "COMPANIA";
  const tarifa = tarifaPorTipoCliente(tipoClienteCotizacion);
  const empresaTexto = String(empresa || "").trim();
  const servicioTexto = String(numeroServicio || "").trim();
  const patenteTexto = String(patente || "").trim().toUpperCase();
  if (!empresaTexto) return res.status(400).json({ error: "Ingrese la empresa o cliente" });
  if (!servicioTexto) return res.status(400).json({ error: "Ingrese el numero de servicio" });
  if (!patenteTexto) return res.status(400).json({ error: "Ingrese la patente" });
  const aux = String(tipoServicio || "").toLowerCase().replace(/á/g, "a") === "auxilio mecanico";
  const k1 = asKm(kmBaseOrigen), k2 = aux ? 0 : asKm(kmOrigenDestino), k3 = aux ? 0 : asKm(kmDestinoBase);
  if (k1 === null || (!aux && k2 === null)) return res.status(400).json({ error: aux ? "Los kilometros Base-Origen deben ser un numero valido" : "Los kilometros Base-Origen y Origen-Destino deben ser numeros validos" });
  if (!aux && modalidadCotizacion === "INTERIOR" && k3 === null) return res.status(400).json({ error: "Para Interior debe informar Destino-Base" });
  const kmTotal = aux ? k1 : (modalidadCotizacion === "INTERIOR" ? k1 + k2 + k3 : k1 + k2);
  const subtotalKm = Math.round(kmTotal * tarifa.km);
  const total = Math.round(tarifa.movida + subtotalKm);
  const fecha = new Date().toISOString();
  const cotizacion = {
    id: "COT-" + Date.now(), fecha, operador: req.user.user,
    empresa: empresaTexto, numeroServicio: servicioTexto, patente: patenteTexto, tipoCliente: tipoClienteCotizacion,
    base: { id: base.id, prestador: base.prestador, base: base.base, zona: base.zona, modalidad: modalidadCotizacion },
    tipoServicio: tipoServicio || "Semipesado", origen: String(origen || "").trim(), destino: aux ? "" : String(destino || "").trim(),
    tramos: { baseOrigen: k1, origenDestino: k2, destinoBase: !aux && modalidadCotizacion === "INTERIOR" ? k3 : 0 },
    kmTotal, tarifa: { movida: tarifa.movida, km: tarifa.km, moneda: tarifa.moneda }, subtotalKm, total,
    facturacion: { estado: "PENDIENTE", facturaNumero: "", fechaFactura: null, cae: "", caeVencimiento: null, observaciones: "", updatedAt: null, updatedBy: null },
    flujo: {
      estado: "ESPERANDO_CONFIRMACION", mailRecibidoAt: null, cotizacionListaAt: fecha, remitoListoAt: fecha,
      confirmadoAt: null, confirmadoBy: null, whatsappListoAt: null, whatsappEnviadoAt: null, whatsappEnviadoBy: null,
      enServicioAt: null, finalizadoAt: null, updatedAt: fecha, updatedBy: req.user.user,
      historial: [
        { fecha, desde: "PROCESANDO", hacia: "COTIZACION_LISTA", usuario: req.user.user, detalle: "Cotizacion calculada y guardada" },
        { fecha, desde: "COTIZACION_LISTA", hacia: "REMITO_LISTO", usuario: req.user.user, detalle: "Remito preparado sin importes" },
        { fecha, desde: "REMITO_LISTO", hacia: "ESPERANDO_CONFIRMACION", usuario: req.user.user, detalle: "Esperando confirmacion antes de habilitar WhatsApp" }
      ]
    }
  };
  cotizacion.remito = buildRemito(cotizacion);
  cotizaciones.unshift(cotizacion);
  cotizaciones = cotizaciones.slice(0, 5000);
  saveCollection("cotizaciones", cotizaciones);
  res.json(cotizacion);
});
app.get("/api/cotizaciones", auth, (req, res) => {
  cotizaciones.forEach(item => {
    ensureFacturacion(item);
    ensureWorkflow(item);
    if (!item.remito || typeof item.remito !== "object") item.remito = buildRemito(item);
  });
  res.json({ total: cotizaciones.length, items: cotizaciones });
});
app.get("/api/cotizaciones/:id", auth, (req, res) => {
  const q = cotizaciones.find(item => item.id === req.params.id);
  if (!q) return res.status(404).json({ error: "Cotizacion no encontrada" });
  ensureFacturacion(q);
  ensureWorkflow(q);
  if (!q.remito || typeof q.remito !== "object") q.remito = buildRemito(q);
  res.json(q);
});
app.post("/api/cotizaciones/:id/confirmar", auth, (req, res) => {
  const q = cotizaciones.find(item => item.id === req.params.id);
  if (!q) return res.status(404).json({ error: "Cotizacion no encontrada" });
  const flujo = ensureWorkflow(q);
  if (["ENVIADO_WHATSAPP", "EN_SERVICIO", "FINALIZADO"].includes(flujo.estado)) return res.status(409).json({ error: "La cotizacion ya avanzo mas alla de la confirmacion" });
  cambiarEstado(q, "CONFIRMADO", req.user.user, String(req.body?.detalle || "Confirmacion recibida"));
  q.flujo.confirmadoAt = q.flujo.updatedAt;
  q.flujo.confirmadoBy = req.user.user;
  cambiarEstado(q, "LISTO_PARA_WHATSAPP", req.user.user, "Servicio habilitado para envio manual por WhatsApp");
  q.flujo.whatsappListoAt = q.flujo.updatedAt;
  saveCollection("cotizaciones", cotizaciones);
  res.json({ success: true, cotizacion: q });
});
app.post("/api/cotizaciones/:id/marcar-whatsapp-enviado", auth, (req, res) => {
  const q = cotizaciones.find(item => item.id === req.params.id);
  if (!q) return res.status(404).json({ error: "Cotizacion no encontrada" });
  const flujo = ensureWorkflow(q);
  if (flujo.estado !== "LISTO_PARA_WHATSAPP") return res.status(409).json({ error: "WhatsApp solo puede marcarse enviado despues de recibir la confirmacion" });
  cambiarEstado(q, "ENVIADO_WHATSAPP", req.user.user, String(req.body?.detalle || "Remito enviado manualmente por WhatsApp"));
  q.flujo.whatsappEnviadoAt = q.flujo.updatedAt;
  q.flujo.whatsappEnviadoBy = req.user.user;
  saveCollection("cotizaciones", cotizaciones);
  res.json({ success: true, cotizacion: q });
});
app.get("/api/facturacion", auth, adminOnly, (req, res) => {
  const estado = String(req.query.estado || "").trim();
  const term = String(req.query.q || "").trim().toLowerCase();
  let items = cotizaciones.map(item => (ensureFacturacion(item), item));
  if (FACTURACION_ESTADOS.includes(estado)) items = items.filter(item => item.facturacion.estado === estado);
  if (term) items = items.filter(item => [item.id, item.empresa, item.numeroServicio, item.patente, item.base?.base, item.base?.prestador, item.facturacion?.facturaNumero].join(" ").toLowerCase().includes(term));
  const resumen = FACTURACION_ESTADOS.reduce((acc, key) => {
    acc[key] = cotizaciones.filter(item => ensureFacturacion(item).estado === key).length;
    return acc;
  }, {});
  const importes = {
    pendiente: cotizaciones.filter(item => ["PENDIENTE", "LISTO_PARA_FACTURAR"].includes(ensureFacturacion(item).estado)).reduce((sum, item) => sum + Number(item.total || 0), 0),
    facturado: cotizaciones.filter(item => ["FACTURADO", "COBRADO"].includes(ensureFacturacion(item).estado)).reduce((sum, item) => sum + Number(item.total || 0), 0)
  };
  res.json({ total: items.length, items, resumen, importes });
});
app.patch("/api/cotizaciones/:id/facturacion", auth, adminOnly, (req, res) => {
  const q = cotizaciones.find(item => item.id === req.params.id);
  if (!q) return res.status(404).json({ error: "Cotizacion no encontrada" });
  const f = ensureFacturacion(q);
  const estado = req.body?.estado !== undefined ? String(req.body.estado) : f.estado;
  if (!FACTURACION_ESTADOS.includes(estado)) return res.status(400).json({ error: "Estado de facturacion invalido" });
  const facturaNumero = req.body?.facturaNumero !== undefined ? String(req.body.facturaNumero).trim() : f.facturaNumero;
  if (["FACTURADO", "COBRADO"].includes(estado) && !facturaNumero) return res.status(400).json({ error: "Ingrese el numero de factura antes de marcar como facturado" });
  f.estado = estado;
  f.facturaNumero = facturaNumero;
  if (req.body?.fechaFactura !== undefined) f.fechaFactura = req.body.fechaFactura || null;
  if (estado === "FACTURADO" && !f.fechaFactura) f.fechaFactura = new Date().toISOString();
  if (req.body?.cae !== undefined) f.cae = String(req.body.cae || "").trim();
  if (req.body?.caeVencimiento !== undefined) f.caeVencimiento = req.body.caeVencimiento || null;
  if (req.body?.observaciones !== undefined) f.observaciones = String(req.body.observaciones || "").trim();
  f.updatedAt = new Date().toISOString();
  f.updatedBy = req.user.user;
  saveCollection("cotizaciones", cotizaciones);
  res.json({ success: true, cotizacion: q });
});
app.post(["/emergencia", "/api/emergencia"], auth, (req, res) => {
  const { patente, modelo, color, ubicacion } = req.body || {};
  const nueva = { id: "EM-" + Date.now(), fecha: new Date().toISOString(), patente: String(patente || ""), modelo: String(modelo || ""), color: String(color || ""), ubicacion: String(ubicacion || "") };
  emergencias.unshift(nueva);
  emergencias = emergencias.slice(0, 500);
  saveCollection("emergencias", emergencias);
  res.json({ ok: true, emergencia: nueva });
});
app.get(["/emergencias", "/api/emergencias"], auth, (req, res) => res.json({ total: emergencias.length, items: emergencias }));

app.use(express.static(path.join(__dirname, "public"), { index: false, maxAge: "5m" }));
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "public", "login.html")));
app.get("/admin", (req, res) => res.sendFile(path.join(__dirname, "public", "admin.html")));
app.get("/facturacion", (req, res) => res.sendFile(path.join(__dirname, "public", "facturacion.html")));
app.get("*", (req, res) => res.status(404).json({ error: "Ruta no encontrada" }));

app.listen(PORT, () => console.log("Asistir24 Plataforma Cerrada activa en puerto " + PORT));
if (GMAIL_AUTO_ENABLED) {
  setTimeout(() => pollGmail(), 5000);
  setInterval(() => pollGmail(), GMAIL_POLL_MS).unref();
}
