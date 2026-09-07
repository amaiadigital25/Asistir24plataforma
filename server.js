const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const basesDoc = require("./data/bases.json");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "100kb" }));
app.use(cors({ origin: process.env.APP_ORIGIN || true, credentials: false }));

const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(64).toString("hex");
if (!process.env.JWT_SECRET) console.warn("[Asistir24] JWT_SECRET no configurado: clave temporal por arranque.");

const ADMIN_USER = process.env.ADMIN_USER || "admin";
const FALLBACK_SALT = "939d696df209329913ecaa38ae8b0ca2";
const FALLBACK_HASH = "e260eb5c451c4702ca7b611408f2aff4125c08384d012ce6f158a0c513f3f9f766270bbd9e26723ed59bb3251a5f6f247b93a6b79226eb0d6924cf3ca2e46939";
const TARIFA = Object.freeze({ movida: 43989, km: 1199, moneda: "ARS" });
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, "database.json");

let cotizaciones = [];
let emergencias = [];

function readUsers() {
  try {
    const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    return Array.isArray(data.users) ? data.users : [];
  } catch (error) {
    console.error("[Asistir24] No se pudo leer la base de usuarios:", error.message);
    return [];
  }
}

function writeUsers(users) {
  let data = {};
  try { data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); } catch {}
  data.users = users;
  const temp = DATA_FILE + ".tmp";
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(temp, JSON.stringify(data, null, 2));
  fs.renameSync(temp, DATA_FILE);
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
  }
  catch { return res.status(401).json({ error: "Sesion vencida o token invalido" }); }
}

function asKm(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

app.get("/health", (req, res) => {
  res.json({ ok: true, app: "Asistir24 Plataforma Cerrada", bases: basesDoc.bases.length, version: "prueba-1" });
});

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
  users.push(user); writeUsers(users);
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
    const password = String(req.body.password);
    if (password.length < 8) return res.status(400).json({ error: "La contraseña debe tener al menos 8 caracteres" });
    user.password = bcrypt.hashSync(password, 12);
  }
  writeUsers(users); res.json({ user: publicUser(user) });
});

app.delete("/api/users/:id", auth, adminOnly, (req, res) => {
  const users = readUsers();
  const index = users.findIndex(item => String(item.id) === req.params.id);
  if (index === -1) return res.status(404).json({ error: "Usuario no encontrado" });
  if (String(users[index].id) === String(req.user.id)) return res.status(400).json({ error: "No puede eliminar su propio usuario" });
  const [removed] = users.splice(index, 1); writeUsers(users);
  res.json({ success: true, user: publicUser(removed) });
});

app.get("/api/config", auth, (req, res) => {
  res.json({
    tarifa: TARIFA,
    reglas: { AMBA_CABA: "Base -> Origen -> Destino", INTERIOR: "Base -> Origen -> Destino -> Base" },
    tiposServicio: ["Liviano", "Auxilio mecanico", "Semipesado"],
    notaDistancias: "En esta prueba los kilometros se cargan manualmente. El PDF informa bases/localidades, pero no direcciones exactas ni coordenadas para calcular rutas automaticamente."
  });
});

app.get("/api/bases", auth, (req, res) => {
  const { modalidad, estado, q } = req.query;
  let items = basesDoc.bases.slice();
  if (modalidad) items = items.filter(b => b.modalidad === modalidad);
  if (estado) items = items.filter(b => b.estado === estado);
  if (q) {
    const term = String(q).toLowerCase();
    items = items.filter(b => [b.prestador,b.base,b.zona,b.tipo,b.estado].join(" ").toLowerCase().includes(term));
  }
  res.json({ total: items.length, items });
});

app.get("/api/resumen", auth, (req, res) => {
  const count = key => basesDoc.bases.filter(b => b.modalidad === key).length;
  res.json({
    bases: {
      total: basesDoc.bases.length,
      ambaCaba: count("AMBA_CABA"),
      interior: count("INTERIOR"),
      activas: basesDoc.bases.filter(b => b.estado === "ACTIVO").length,
      pendientes: basesDoc.bases.filter(b => b.estado === "PENDIENTE").length
    },
    cotizaciones: cotizaciones.length,
    tarifa: TARIFA
  });
});

app.post("/api/cotizar", auth, (req, res) => {
  const { baseId, tipoServicio, origen, destino, kmBaseOrigen, kmOrigenDestino, kmDestinoBase } = req.body || {};
  const base = basesDoc.bases.find(b => b.id === baseId);
  if (!base) return res.status(400).json({ error: "Base invalida" });

  const k1 = asKm(kmBaseOrigen), k2 = asKm(kmOrigenDestino), k3 = asKm(kmDestinoBase);
  if (k1 === null || k2 === null) return res.status(400).json({ error: "Los kilometros Base-Origen y Origen-Destino deben ser numeros validos" });
  if (base.modalidad === "INTERIOR" && k3 === null) return res.status(400).json({ error: "Para Interior debe informar Destino-Base" });

  const kmTotal = base.modalidad === "INTERIOR" ? k1 + k2 + k3 : k1 + k2;
  const subtotalKm = Math.round(kmTotal * TARIFA.km);
  const total = Math.round(TARIFA.movida + subtotalKm);

  const cotizacion = {
    id: "COT-" + Date.now(), fecha: new Date().toISOString(), operador: req.user.user,
    base: { id: base.id, prestador: base.prestador, base: base.base, zona: base.zona, modalidad: base.modalidad },
    tipoServicio: tipoServicio || "Semipesado", origen: String(origen || "").trim(), destino: String(destino || "").trim(),
    tramos: { baseOrigen: k1, origenDestino: k2, destinoBase: base.modalidad === "INTERIOR" ? k3 : 0 },
    kmTotal, tarifa: TARIFA, subtotalKm, total
  };
  cotizaciones.unshift(cotizacion);
  cotizaciones = cotizaciones.slice(0, 500);
  res.json(cotizacion);
});

app.get("/api/cotizaciones", auth, (req, res) => res.json({ total: cotizaciones.length, items: cotizaciones }));

app.post(["/emergencia", "/api/emergencia"], auth, (req, res) => {
  const { patente, modelo, color, ubicacion } = req.body || {};
  const nueva = { id: "EM-" + Date.now(), fecha: new Date().toISOString(), patente: String(patente || ""), modelo: String(modelo || ""), color: String(color || ""), ubicacion: String(ubicacion || "") };
  emergencias.unshift(nueva); emergencias = emergencias.slice(0, 500);
  res.json({ ok: true, emergencia: nueva });
});
app.get(["/emergencias", "/api/emergencias"], auth, (req, res) => res.json({ total: emergencias.length, items: emergencias }));

app.use(express.static(path.join(__dirname, "public"), { index: false, maxAge: "5m" }));
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "public", "login.html")));
app.get("/admin", (req, res) => res.sendFile(path.join(__dirname, "public", "admin.html")));
app.get("*", (req, res) => res.status(404).json({ error: "Ruta no encontrada" }));

app.listen(PORT, () => console.log("Asistir24 Plataforma Cerrada activa en puerto " + PORT));
