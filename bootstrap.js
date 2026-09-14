const fs = require("fs");
const path = require("path");
const Module = require("module");

const dataFile = process.env.DATA_FILE || path.join(__dirname, "database.json");
const legacyFile = path.join(__dirname, "database.json");

function initializePersistentData() {
  if (fs.existsSync(dataFile)) return;

  fs.mkdirSync(path.dirname(dataFile), { recursive: true });

  const seed = process.env.DATABASE_SEED_BASE64;
  if (seed) {
    try {
      const decoded = Buffer.from(seed, "base64").toString("utf8");
      const parsed = JSON.parse(decoded);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("seed invalido");
      fs.writeFileSync(dataFile, JSON.stringify(parsed, null, 2));
      console.log(`[Asistir24] Base persistente inicializada desde respaldo en ${dataFile}`);
      return;
    } catch (error) {
      console.error("[Asistir24] No se pudo restaurar DATABASE_SEED_BASE64:", error.message);
    }
  }

  if (dataFile !== legacyFile && fs.existsSync(legacyFile)) {
    fs.copyFileSync(legacyFile, dataFile);
    console.log(`[Asistir24] Base persistente inicializada desde ${legacyFile}`);
    return;
  }

  fs.writeFileSync(dataFile, JSON.stringify({ users: [], services: [], cotizaciones: [] }, null, 2));
  console.log(`[Asistir24] Base persistente nueva creada en ${dataFile}`);
}

function loadServerWithRuntimeFixes() {
  const serverPath = require.resolve("./server");
  const source = fs.readFileSync(serverPath, "utf8");

  const oldLine = 'if (part) return decodeBase64Url(part.body.data).replace(/<[^>]+>/g, " ");';
  const newLine = 'if (part) { const raw = decodeBase64Url(part.body.data); const decoded = mime === "text/html" ? raw.replace(/<br\\s*\\/?\\s*>/gi, "\\n").replace(/<\\/p\\s*>/gi, "\\n").replace(/<\\/li\\s*>/gi, "\\n").replace(/<li\\b[^>]*>/gi, "- ").replace(/<[^>]+>/g, " ") : raw; if (decoded.trim()) return decoded; }';
  let fixed = source.includes(oldLine) ? source.replace(oldLine, newLine) : source;

  const start = fixed.indexOf("async function quoteFromMail(parsed, gmailMeta) {");
  const end = fixed.indexOf("function confirmFromMail(parsed, gmailMeta) {");
  if (start !== -1 && end !== -1 && end > start) {
    const replacement = [
      'async function quoteFromMail(parsed, gmailMeta) {',
      '  if (!parsed.asistenciaId || !parsed.patente || !parsed.origen) throw new Error("Mail incompleto para registrar servicio");',
      '  const existing = cotizaciones.find(q => String(q.numeroServicio) === String(parsed.asistenciaId));',
      '  if (existing) return { quote: existing, created: false };',
      '',
      '  const fecha = new Date().toISOString();',
      '  const tipoServicio = parsed.tipoServicio || "";',
      '  const tarifa = TARIFA_COMPANIA;',
      '  const q = {',
      '    id: "COT-" + Date.now(), fecha, operador: "gmail-auto", empresa: parsed.empresa || "Compañía",',
      '    numeroServicio: String(parsed.asistenciaId), patente: String(parsed.patente).toUpperCase(),',
      '    tipoCliente: "COMPANIA", base: null, tipoServicio, origen: parsed.origen, destino: parsed.destino || "",',
      '    tramos: { baseOrigen: null, origenDestino: null, destinoBase: null }, kmTotal: null,',
      '    tarifa: { movida: tarifa.movida, km: tarifa.km, moneda: tarifa.moneda }, subtotalKm: null, total: null,',
      '    calculo: { estado: "PENDIENTE", error: null, updatedAt: null },',
      '    gmail: { messageId: gmailMeta.id, threadId: gmailMeta.threadId || null, subject: gmailMeta.subject || "", receivedAt: gmailMeta.receivedAt || fecha },',
      '    datosMail: { vehiculo: parsed.vehiculo || "", observaciones: parsed.observaciones || "", asegurado: parsed.asegurado || "", telefono: parsed.telefono || "", emailAsegurado: parsed.emailAsegurado || "" },',
      '    facturacion: { estado: "PENDIENTE", facturaNumero: "", fechaFactura: null, cae: "", caeVencimiento: null, observaciones: "", updatedAt: null, updatedBy: null },',
      '    flujo: { estado: "ESPERANDO_CONFIRMACION", mailRecibidoAt: fecha, cotizacionListaAt: null, remitoListoAt: fecha, confirmadoAt: null, confirmadoBy: null, whatsappListoAt: null, whatsappEnviadoAt: null, whatsappEnviadoBy: null, enServicioAt: null, finalizadoAt: null, updatedAt: fecha, updatedBy: "gmail-auto", historial: [',
      '      { fecha, desde: "MAIL_RECIBIDO", hacia: "REMITO_LISTO", usuario: "gmail-auto", detalle: "Remito operativo preparado con datos del mail; independiente del cálculo" },',
      '      { fecha, desde: "REMITO_LISTO", hacia: "ESPERANDO_CONFIRMACION", usuario: "gmail-auto", detalle: "Esperando confirmación para habilitar WhatsApp" }',
      '    ] }',
      '  };',
      '',
      '  const d = q.datosMail || {};',
      '  const remitoLines = [',
      '    "ASISTIR24 - REMITO DE SERVICIO", "",',
      '    "Empresa / cliente: " + (q.empresa || "-"),',
      '    "Nº de servicio: " + (q.numeroServicio || "-"),',
      '    "Tipo de asistencia: " + (q.tipoServicio || "-"),',
      '    "Patente: " + (q.patente || "-"),',
      '    "Vehículo: " + (d.vehiculo || "-"),',
      '    "Asegurado: " + (d.asegurado || "-"),',
      '    "Teléfono: " + (d.telefono || "-"),',
      '    "Origen / punto de encuentro: " + (q.origen || "-"),',
      '    ...(q.destino ? ["Destino: " + q.destino] : []),',
      '    "Observaciones: " + (d.observaciones || "-")',
      '  ];',
      '  q.remito = { version: 2, preparadoAt: fecha, incluyeImportes: false, independienteCalculo: true, texto: remitoLines.join("\\n") };',
      '',
      '  cotizaciones.unshift(q);',
      '  cotizaciones = cotizaciones.slice(0, 5000);',
      '  saveCollection("cotizaciones", cotizaciones);',
      '',
      '  try {',
      '    const base = findBaseForAddress(parsed.origen);',
      '    const modalidad = base?.modalidad === "INTERIOR" ? "INTERIOR" : "AMBA_CABA";',
      '    const baseTexto = [base.base, base.zona, "Argentina"].filter(Boolean).join(", ");',
      '    const [baseCoord, origenCoord] = await Promise.all([geocodeGoogle(baseTexto), geocodeGoogle(parsed.origen + ", Argentina")]);',
      '    const k1 = await routeKmGoogle(baseCoord, origenCoord);',
      '    let k2 = 0; let k3 = 0;',
      '    if (parsed.destino && tipoServicio !== "Auxilio mecanico") {',
      '      const destinoCoord = await geocodeGoogle(parsed.destino + ", Argentina");',
      '      k2 = await routeKmGoogle(origenCoord, destinoCoord);',
      '      if (modalidad === "INTERIOR") k3 = await routeKmGoogle(destinoCoord, baseCoord);',
      '    }',
      '    const kmTotal = k1 + k2 + (modalidad === "INTERIOR" ? k3 : 0);',
      '    if (!(kmTotal > 0)) throw new Error("No se pudo obtener una distancia válida");',
      '    q.base = { id: base.id, prestador: base.prestador, base: base.base, zona: base.zona, modalidad };',
      '    q.tramos = { baseOrigen: k1, origenDestino: k2, destinoBase: modalidad === "INTERIOR" ? k3 : 0 };',
      '    q.kmTotal = kmTotal; q.subtotalKm = Math.round(kmTotal * tarifa.km); q.total = Math.round(tarifa.movida + q.subtotalKm);',
      '    q.calculo = { estado: "LISTO", error: null, updatedAt: new Date().toISOString() };',
      '    q.flujo.cotizacionListaAt = q.calculo.updatedAt;',
      '  } catch (error) {',
      '    q.calculo = { estado: "PENDIENTE", error: error.message, updatedAt: new Date().toISOString() };',
      '    console.warn("[Asistir24] Servicio guardado y remito listo; cálculo pendiente:", parsed.asistenciaId, error.message);',
      '  }',
      '  saveCollection("cotizaciones", cotizaciones);',
      '  return { quote: q, created: true };',
      '}',
      ''
    ].join("\n");
    fixed = fixed.slice(0, start) + replacement + fixed.slice(end);
    console.log("[Asistir24] Remito desacoplado de Maps: registro inmediato activo");
  } else {
    console.warn("[Asistir24] No se encontró quoteFromMail para aplicar desacople de remito");
  }

  const serverModule = new Module(serverPath, module);
  serverModule.filename = serverPath;
  serverModule.paths = Module._nodeModulePaths(path.dirname(serverPath));
  serverModule._compile(fixed, serverPath);
}

initializePersistentData();
loadServerWithRuntimeFixes();
