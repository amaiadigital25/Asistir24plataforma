const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const path = require("path");
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

let cotizaciones = [];
let emergencias = [];

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

function makeToken() {
  return jwt.sign({ user: ADMIN_USER, role: "admin" }, JWT_SECRET, { expiresIn: "8h" });
}

function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return res.status(401).json({ error: "No autorizado" });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
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
  if (String(username || "") !== ADMIN_USER || !passwordOk(password)) {
    return res.status(401).json({ success: false, error: "Credenciales incorrectas" });
  }
  res.json({ success: true, token: makeToken(), role: "admin", user: ADMIN_USER });
});

app.get("/api/me", auth, (req, res) => res.json({ user: req.user.user, role: req.user.role }));

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
app.get("*", (req, res) => res.status(404).json({ error: "Ruta no encontrada" }));

app.listen(PORT, () => console.log("Asistir24 Plataforma Cerrada activa en puerto " + PORT));