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
const TARIFA_COMPANIA = Object.freeze({ movida: 43989, km: 1199, moneda: "ARS", configured: true });
const TARIFA_PARTICULAR = Object.freeze({ movida: 60000, km: 2000, moneda: "ARS", configured: true });
const TARIFAS = Object.freeze({ COMPANIA: TARIFA_COMPANIA, PARTICULAR: TARIFA_PARTICULAR });

function tarifaPorTipoCliente(tipoCliente) {
  return String(tipoCliente || "").toUpperCase() === "PARTICULAR" ? TARIFAS.PARTICULAR : TARIFAS.COMPANIA;
}
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, "database.json");
const FACTURACION_ESTADOS = ["PENDIENTE", "LISTO_PARA_FACTURAR", "FACTURADO", "COBRADO"];

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
  }
  catch { return res.status(401).json({ error: "Sesion vencida o token invalido" }); }
}

function asKm(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function ensureFacturacion(cotizacion) {
  if (!cotizacion.facturacion || typeof cotizacion.facturacion !== "object") {
    cotizacion.facturacion = {
      estado: "PENDIENTE",
      facturaNumero: "",
      fechaFactura: null,
      cae: "",
      caeVencimiento: null,
      observaciones: "",
      updatedAt: null,
      updatedBy: null
    };
  }
  if (!FACTURACION_ESTADOS.includes(cotizacion.facturacion.estado)) cotizacion.facturacion.estado = "PENDIENTE";
  return cotizacion.facturacion;
}

cotizaciones.forEach(ensureFacturacion);

app.get("/health", (req, res) => {
  res.json({ ok: true, app: "Asistir24 Plataforma Cerrada", bases: basesDoc.bases.length, version: "facturacion-1" });
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
    tarifa: TARIFA_COMPANIA,
    tarifas: TARIFAS,
    reglas: { AMBA_CABA: "Base -> Origen -> Destino", INTERIOR: "Base -> Origen -> Destino -> Base", AUXILIO_MECANICO: "Base -> Origen" },
    tiposServicio: ["Liviano", "Moto", "Auxilio mecanico", "Semipesado"],
    notaDistancias: "Los kilómetros Base-Origen se calculan automáticamente con Google Maps a partir de la base y la ubicación ingresada."
  });
});

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
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": key,
      "X-Goog-FieldMask": "routes.distanceMeters"
    },
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
    items = items.filter(b => [b.prestador,b.base,b.zona,b.tipo,b.estado].join(" ").toLowerCase().includes(term));
  }
  res.json({ total: items.length, items });
});

app.get("/api/resumen", auth, (req, res) => {
  const count = key => basesDoc.bases.filter(b => b.modalidad === key).length;
  const billing = { pendiente: 0, listo: 0, facturado: 0, cobrado: 0 };
  cotizaciones.forEach(item => {
    const estado = ensureFacturacion(item).estado;
    if (estado === "PENDIENTE") billing.pendiente += 1;
    if (estado === "LISTO_PARA_FACTURAR") billing.listo += 1;
    if (estado === "FACTURADO") billing.facturado += 1;
    if (estado === "COBRADO") billing.cobrado += 1;
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
  const tarifaCotizacion = tarifaPorTipoCliente(tipoClienteCotizacion);
  if (!tarifaCotizacion.configured) {
    return res.status(400).json({ error: "La tarifa para particulares todavía no está configurada. Cargue movida y valor por km antes de cotizar." });
  }

  const empresaTexto = String(empresa || "").trim();
  const servicioTexto = String(numeroServicio || "").trim();
  const patenteTexto = String(patente || "").trim().toUpperCase();
  if (!empresaTexto) return res.status(400).json({ error: "Ingrese la empresa o cliente" });
  if (!servicioTexto) return res.status(400).json({ error: "Ingrese el numero de servicio" });
  if (!patenteTexto) return res.status(400).json({ error: "Ingrese la patente" });

  const esAuxilioMecanico = String(tipoServicio || "").toLowerCase().replace(/á/g, "a") === "auxilio mecanico";
  const k1 = asKm(kmBaseOrigen), k2 = esAuxilioMecanico ? 0 : asKm(kmOrigenDestino), k3 = esAuxilioMecanico ? 0 : asKm(kmDestinoBase);
  if (k1 === null || (!esAuxilioMecanico && k2 === null)) return res.status(400).json({ error: esAuxilioMecanico ? "Los kilometros Base-Origen deben ser un numero valido" : "Los kilometros Base-Origen y Origen-Destino deben ser numeros validos" });
  if (!esAuxilioMecanico && modalidadCotizacion === "INTERIOR" && k3 === null) return res.status(400).json({ error: "Para Interior debe informar Destino-Base" });

  const kmTotal = esAuxilioMecanico ? k1 : (modalidadCotizacion === "INTERIOR" ? k1 + k2 + k3 : k1 + k2);
  const subtotalKm = Math.round(kmTotal * tarifaCotizacion.km);
  const total = Math.round(tarifaCotizacion.movida + subtotalKm);

  const cotizacion = {
    id: "COT-" + Date.now(), fecha: new Date().toISOString(), operador: req.user.user,
    empresa: empresaTexto, numeroServicio: servicioTexto, patente: patenteTexto, tipoCliente: tipoClienteCotizacion,
    base: { id: base.id, prestador: base.prestador, base: base.base, zona: base.zona, modalidad: modalidadCotizacion },
    tipoServicio: tipoServicio || "Semipesado", origen: String(origen || "").trim(), destino: esAuxilioMecanico ? "" : String(destino || "").trim(),
    tramos: { baseOrigen: k1, origenDestino: k2, destinoBase: !esAuxilioMecanico && modalidadCotizacion === "INTERIOR" ? k3 : 0 },
    kmTotal, tarifa: { movida: tarifaCotizacion.movida, km: tarifaCotizacion.km, moneda: tarifaCotizacion.moneda }, subtotalKm, total,
    facturacion: {
      estado: "PENDIENTE",
      facturaNumero: "",
      fechaFactura: null,
      cae: "",
      caeVencimiento: null,
      observaciones: "",
      updatedAt: null,
      updatedBy: null
    }
  };
  cotizaciones.unshift(cotizacion);
  cotizaciones = cotizaciones.slice(0, 5000);
  saveCollection("cotizaciones", cotizaciones);
  res.json(cotizacion);
});

app.get("/api/cotizaciones", auth, (req, res) => {
  cotizaciones.forEach(ensureFacturacion);
  res.json({ total: cotizaciones.length, items: cotizaciones });
});

app.get("/api/facturacion", auth, adminOnly, (req, res) => {
  const estado = String(req.query.estado || "").trim();
  const term = String(req.query.q || "").trim().toLowerCase();
  let items = cotizaciones.map(item => {
    ensureFacturacion(item);
    return item;
  });
  if (FACTURACION_ESTADOS.includes(estado)) items = items.filter(item => item.facturacion.estado === estado);
  if (term) {
    items = items.filter(item => [item.id, item.empresa, item.numeroServicio, item.patente, item.base?.base, item.base?.prestador, item.facturacion?.facturaNumero].join(" ").toLowerCase().includes(term));
  }
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
  const cotizacion = cotizaciones.find(item => item.id === req.params.id);
  if (!cotizacion) return res.status(404).json({ error: "Cotizacion no encontrada" });
  const facturacion = ensureFacturacion(cotizacion);
  const estado = req.body?.estado !== undefined ? String(req.body.estado) : facturacion.estado;
  if (!FACTURACION_ESTADOS.includes(estado)) return res.status(400).json({ error: "Estado de facturacion invalido" });

  const facturaNumero = req.body?.facturaNumero !== undefined ? String(req.body.facturaNumero).trim() : facturacion.facturaNumero;
  if (["FACTURADO", "COBRADO"].includes(estado) && !facturaNumero) return res.status(400).json({ error: "Ingrese el numero de factura antes de marcar como facturado" });

  facturacion.estado = estado;
  facturacion.facturaNumero = facturaNumero;
  if (req.body?.fechaFactura !== undefined) facturacion.fechaFactura = req.body.fechaFactura || null;
  if (estado === "FACTURADO" && !facturacion.fechaFactura) facturacion.fechaFactura = new Date().toISOString();
  if (req.body?.cae !== undefined) facturacion.cae = String(req.body.cae || "").trim();
  if (req.body?.caeVencimiento !== undefined) facturacion.caeVencimiento = req.body.caeVencimiento || null;
  if (req.body?.observaciones !== undefined) facturacion.observaciones = String(req.body.observaciones || "").trim();
  facturacion.updatedAt = new Date().toISOString();
  facturacion.updatedBy = req.user.user;

  saveCollection("cotizaciones", cotizaciones);
  res.json({ success: true, cotizacion });
});

app.post(["/emergencia", "/api/emergencia"], auth, (req, res) => {
  const { patente, modelo, color, ubicacion } = req.body || {};
  const nueva = { id: "EM-" + Date.now(), fecha: new Date().toISOString(), patente: String(patente || ""), modelo: String(modelo || ""), color: String(color || ""), ubicacion: String(ubicacion || "") };
  emergencias.unshift(nueva); emergencias = emergencias.slice(0, 500);
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