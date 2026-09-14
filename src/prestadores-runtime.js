function patchServerSource(source) {
  let fixed = source;

  fixed = fixed.replace('app.use(express.json({ limit: "100kb" }));', 'app.use(express.json({ limit: "8mb" }));');
  fixed = fixed.replace('const role = req.body?.role === "admin" ? "admin" : "operador";', 'const role = ["admin", "operador", "prestador"].includes(req.body?.role) ? req.body.role : "operador";');
  fixed = fixed.replace('if (["admin", "operador"].includes(req.body?.role)) user.role = req.body.role;', 'if (["admin", "operador", "prestador"].includes(req.body?.role)) user.role = req.body.role;');

  const constantsMarker = 'const FACTURACION_ESTADOS = ["PENDIENTE", "LISTO_PARA_FACTURAR", "FACTURADO", "COBRADO"];';
  if (fixed.includes(constantsMarker) && !fixed.includes('const PRESTADOR_FACTURA_ESTADOS')) {
    fixed = fixed.replace(constantsMarker, constantsMarker + '\nconst PRESTADOR_FACTURA_ESTADOS = ["PENDIENTE_REVISION", "OC_DESPACHADA", "RECHAZADA"];\nconst PRESTADOR_FACTURAS_DIR = process.env.PRESTADOR_FACTURAS_DIR || path.join(path.dirname(DATA_FILE), "facturas-prestadores");');
  }

  const helperMarker = 'function gmailConfigured() {';
  if (fixed.includes(helperMarker) && !fixed.includes('function readPrestadorFacturas()')) {
    const helpers = [
      'function readPrestadorFacturas() {',
      '  const data = readData();',
      '  return Array.isArray(data.prestadorFacturas) ? data.prestadorFacturas : [];',
      '}',
      'function writePrestadorFacturas(items) {',
      '  const data = readData();',
      '  data.prestadorFacturas = items;',
      '  writeData(data);',
      '}',
      'function cleanText(value, max = 300) {',
      '  return String(value || "").trim().slice(0, max);',
      '}',
      'function publicPrestadorFactura(item) {',
      '  return {',
      '    id: item.id, numeroServicio: item.numeroServicio, cotizacionId: item.cotizacionId,',
      '    prestadorUserId: item.prestadorUserId, prestadorUsername: item.prestadorUsername, prestadorNombre: item.prestadorNombre,',
      '    cuit: item.cuit, facturaNumero: item.facturaNumero, fechaFactura: item.fechaFactura, importe: item.importe,',
      '    observaciones: item.observaciones, archivo: item.archivo ? { id: item.archivo.id, nombre: item.archivo.nombre, mime: item.archivo.mime, size: item.archivo.size } : null,',
      '    estado: item.estado, createdAt: item.createdAt, updatedAt: item.updatedAt, updatedBy: item.updatedBy,',
      '    revision: item.revision || null, oc: item.oc || null',
      '  };',
      '}',
      'function decodePrestadorFile(fileData) {',
      '  const match = /^data:(application\\/pdf|image\\/jpeg|image\\/png);base64,([A-Za-z0-9+/=]+)$/.exec(String(fileData || ""));',
      '  if (!match) throw new Error("La factura debe ser PDF, JPG o PNG");',
      '  const mime = match[1];',
      '  const buffer = Buffer.from(match[2], "base64");',
      '  if (!buffer.length || buffer.length > 5 * 1024 * 1024) throw new Error("El archivo debe pesar entre 1 byte y 5 MB");',
      '  const isPdf = mime === "application/pdf" && buffer.slice(0, 5).toString("ascii") === "%PDF-";',
      '  const isPng = mime === "image/png" && buffer.slice(0, 8).toString("hex") === "89504e470d0a1a0a";',
      '  const isJpg = mime === "image/jpeg" && buffer.slice(0, 3).toString("hex") === "ffd8ff";',
      '  if (!isPdf && !isPng && !isJpg) throw new Error("El contenido del archivo no coincide con un PDF/JPG/PNG válido");',
      '  return { mime, buffer, extension: mime === "application/pdf" ? ".pdf" : (mime === "image/png" ? ".png" : ".jpg") };',
      '}',
      'function escapeHtml(value) {',
      '  return String(value ?? "").replace(/[&<>"\\']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\\\"": "&quot;", "\\\'": "&#39;" }[ch] || ch));',
      '}',
      ''
    ].join('\n');
    fixed = fixed.replace(helperMarker, helpers + helperMarker);
  }

  const apiMarker = 'app.post(["/emergencia", "/api/emergencia"], auth, (req, res) => {';
  if (fixed.includes(apiMarker) && !fixed.includes('app.post("/api/prestadores/facturas"')) {
    const api = [
      'app.get("/api/prestadores/servicios/:numero", auth, (req, res) => {',
      '  if (req.user.role !== "prestador" && req.user.role !== "admin") return res.status(403).json({ error: "Acceso exclusivo para prestadores" });',
      '  const numero = cleanText(req.params.numero, 80);',
      '  const q = cotizaciones.find(item => String(item.numeroServicio || "").trim() === numero);',
      '  if (!q) return res.status(404).json({ error: "No encontramos ese número de servicio" });',
      '  const previa = readPrestadorFacturas().find(item => item.numeroServicio === numero && item.estado !== "RECHAZADA");',
      '  res.json({',
      '    servicio: { id: q.id, numeroServicio: q.numeroServicio, empresa: q.empresa || "", patente: q.patente || "", tipoServicio: q.tipoServicio || "", origen: q.origen || "", destino: q.destino || "", fecha: q.fecha || null },',
      '    yaFacturado: Boolean(previa), estadoFactura: previa?.estado || null',
      '  });',
      '});',
      '',
      'app.get("/api/prestadores/mis-facturas", auth, (req, res) => {',
      '  if (req.user.role !== "prestador") return res.status(403).json({ error: "Acceso exclusivo para prestadores" });',
      '  const items = readPrestadorFacturas().filter(item => String(item.prestadorUserId) === String(req.user.id)).map(publicPrestadorFactura);',
      '  res.json({ total: items.length, items });',
      '});',
      '',
      'app.post("/api/prestadores/facturas", auth, (req, res) => {',
      '  if (req.user.role !== "prestador") return res.status(403).json({ error: "Acceso exclusivo para prestadores" });',
      '  try {',
      '    const numeroServicio = cleanText(req.body?.numeroServicio, 80);',
      '    const facturaNumero = cleanText(req.body?.facturaNumero, 80);',
      '    const fechaFactura = cleanText(req.body?.fechaFactura, 20);',
      '    const cuit = String(req.body?.cuit || "").replace(/\\D/g, "");',
      '    const importe = Number(req.body?.importe);',
      '    const observaciones = cleanText(req.body?.observaciones, 1000);',
      '    const archivoNombre = cleanText(req.body?.archivoNombre, 160) || "factura";',
      '    if (!numeroServicio) return res.status(400).json({ error: "Ingrese el número de servicio" });',
      '    if (!facturaNumero) return res.status(400).json({ error: "Ingrese el número de factura" });',
      '    if (!/^\\d{11}$/.test(cuit)) return res.status(400).json({ error: "El CUIT debe tener 11 dígitos" });',
      '    if (!fechaFactura || !/^\\d{4}-\\d{2}-\\d{2}$/.test(fechaFactura)) return res.status(400).json({ error: "Ingrese una fecha de factura válida" });',
      '    if (!Number.isFinite(importe) || importe <= 0 || importe > 1000000000) return res.status(400).json({ error: "Ingrese un importe válido" });',
      '    const q = cotizaciones.find(item => String(item.numeroServicio || "").trim() === numeroServicio);',
      '    if (!q) return res.status(404).json({ error: "El número de servicio no existe en el cotizador" });',
      '    const items = readPrestadorFacturas();',
      '    const duplicada = items.find(item => item.numeroServicio === numeroServicio && item.estado !== "RECHAZADA");',
      '    if (duplicada) return res.status(409).json({ error: "Este servicio ya posee una factura registrada", codigo: "SERVICIO_YA_FACTURADO" });',
      '    const file = decodePrestadorFile(req.body?.archivoData);',
      '    fs.mkdirSync(PRESTADOR_FACTURAS_DIR, { recursive: true });',
      '    const archivoId = crypto.randomUUID() + file.extension;',
      '    fs.writeFileSync(path.join(PRESTADOR_FACTURAS_DIR, archivoId), file.buffer, { flag: "wx" });',
      '    const userRecord = readUsers().find(user => String(user.id) === String(req.user.id));',
      '    const now = new Date().toISOString();',
      '    const item = {',
      '      id: "PF-" + crypto.randomUUID(), numeroServicio, cotizacionId: q.id,',
      '      prestadorUserId: req.user.id, prestadorUsername: req.user.user, prestadorNombre: userRecord?.name || req.user.user,',
      '      cuit, facturaNumero, fechaFactura, importe: Math.round(importe * 100) / 100, observaciones,',
      '      archivo: { id: archivoId, nombre: archivoNombre, mime: file.mime, size: file.buffer.length },',
      '      estado: "PENDIENTE_REVISION", createdAt: now, updatedAt: now, updatedBy: req.user.user,',
      '      revision: null, oc: null',
      '    };',
      '    items.unshift(item);',
      '    writePrestadorFacturas(items.slice(0, 10000));',
      '    res.status(201).json({ success: true, factura: publicPrestadorFactura(item) });',
      '  } catch (error) {',
      '    res.status(400).json({ error: error.message || "No se pudo cargar la factura" });',
      '  }',
      '});',
      '',
      'app.get("/api/prestadores/facturas", auth, adminOnly, (req, res) => {',
      '  const estado = cleanText(req.query.estado, 40);',
      '  const q = cleanText(req.query.q, 100).toLowerCase();',
      '  let items = readPrestadorFacturas();',
      '  if (PRESTADOR_FACTURA_ESTADOS.includes(estado)) items = items.filter(item => item.estado === estado);',
      '  if (q) items = items.filter(item => [item.numeroServicio, item.facturaNumero, item.cuit, item.prestadorNombre, item.prestadorUsername, item.oc?.numero].join(" ").toLowerCase().includes(q));',
      '  const resumen = PRESTADOR_FACTURA_ESTADOS.reduce((acc, key) => { acc[key] = items.filter(item => item.estado === key).length; return acc; }, {});',
      '  res.json({ total: items.length, items: items.map(publicPrestadorFactura), resumen });',
      '});',
      '',
      'app.patch("/api/prestadores/facturas/:id/revision", auth, adminOnly, (req, res) => {',
      '  const items = readPrestadorFacturas();',
      '  const item = items.find(row => row.id === req.params.id);',
      '  if (!item) return res.status(404).json({ error: "Factura no encontrada" });',
      '  if (item.estado !== "PENDIENTE_REVISION") return res.status(409).json({ error: "Esta factura ya fue revisada" });',
      '  const accion = cleanText(req.body?.accion, 20).toUpperCase();',
      '  const motivo = cleanText(req.body?.motivo, 500);',
      '  const now = new Date().toISOString();',
      '  if (accion === "RECHAZAR") {',
      '    if (!motivo) return res.status(400).json({ error: "Indique el motivo del rechazo" });',
      '    item.estado = "RECHAZADA";',
      '    item.revision = { accion: "RECHAZAR", motivo, fecha: now, usuario: req.user.user };',
      '  } else if (accion === "APROBAR") {',
      '    const numero = "OC-" + now.slice(0, 10).replace(/-/g, "") + "-" + crypto.randomBytes(3).toString("hex").toUpperCase();',
      '    item.estado = "OC_DESPACHADA";',
      '    item.revision = { accion: "APROBAR", motivo, fecha: now, usuario: req.user.user };',
      '    item.oc = { numero, emitidaAt: now, despachadaAt: now, emitidaBy: req.user.user };',
      '  } else {',
      '    return res.status(400).json({ error: "Acción inválida" });',
      '  }',
      '  item.updatedAt = now;',
      '  item.updatedBy = req.user.user;',
      '  writePrestadorFacturas(items);',
      '  res.json({ success: true, factura: publicPrestadorFactura(item) });',
      '});',
      '',
      'app.get("/api/prestadores/facturas/:id/archivo", auth, (req, res) => {',
      '  const item = readPrestadorFacturas().find(row => row.id === req.params.id);',
      '  if (!item) return res.status(404).json({ error: "Factura no encontrada" });',
      '  const own = req.user.role === "prestador" && String(item.prestadorUserId) === String(req.user.id);',
      '  if (req.user.role !== "admin" && !own) return res.status(403).json({ error: "Sin permiso para ver este archivo" });',
      '  const filePath = path.join(PRESTADOR_FACTURAS_DIR, item.archivo.id);',
      '  if (!fs.existsSync(filePath)) return res.status(404).json({ error: "Archivo no disponible" });',
      '  res.type(item.archivo.mime);',
      '  res.setHeader("Content-Disposition", "inline; filename*=UTF-8\\'\\'" + encodeURIComponent(item.archivo.nombre));',
      '  res.sendFile(filePath);',
      '});',
      '',
      'app.get("/api/prestadores/facturas/:id/oc", auth, (req, res) => {',
      '  const item = readPrestadorFacturas().find(row => row.id === req.params.id);',
      '  if (!item) return res.status(404).json({ error: "Factura no encontrada" });',
      '  const own = req.user.role === "prestador" && String(item.prestadorUserId) === String(req.user.id);',
      '  if (req.user.role !== "admin" && !own) return res.status(403).json({ error: "Sin permiso para ver esta OC" });',
      '  if (!item.oc || item.estado !== "OC_DESPACHADA") return res.status(409).json({ error: "La orden de compra todavía no fue emitida" });',
      '  const q = cotizaciones.find(row => row.id === item.cotizacionId) || {};',
      '  const html = "<!doctype html><html><head><meta charset=\\"utf-8\\"><title>" + escapeHtml(item.oc.numero) + "</title><style>body{font-family:Arial,sans-serif;margin:42px;color:#172033}.head{display:flex;justify-content:space-between;border-bottom:3px solid #1677ff;padding-bottom:18px}.box{margin-top:24px;border:1px solid #d7deea;border-radius:12px;padding:20px}.row{display:grid;grid-template-columns:190px 1fr;padding:7px 0}.total{font-size:22px;font-weight:700}.muted{color:#64748b}@media print{button{display:none}}</style></head><body><div class=\\"head\\"><div><strong>ASISTIR24</strong><h1>Orden de compra</h1></div><div><strong>" + escapeHtml(item.oc.numero) + "</strong><br><span class=\\"muted\\">" + escapeHtml(new Date(item.oc.emitidaAt).toLocaleString("es-AR")) + "</span></div></div><div class=\\"box\\"><div class=\\"row\\"><b>Prestador</b><span>" + escapeHtml(item.prestadorNombre) + "</span></div><div class=\\"row\\"><b>CUIT</b><span>" + escapeHtml(item.cuit) + "</span></div><div class=\\"row\\"><b>Servicio</b><span>" + escapeHtml(item.numeroServicio) + "</span></div><div class=\\"row\\"><b>Empresa</b><span>" + escapeHtml(q.empresa || "-") + "</span></div><div class=\\"row\\"><b>Factura</b><span>" + escapeHtml(item.facturaNumero) + "</span></div><div class=\\"row\\"><b>Fecha factura</b><span>" + escapeHtml(item.fechaFactura) + "</span></div><div class=\\"row total\\"><b>Importe autorizado</b><span>$ " + escapeHtml(Number(item.importe).toLocaleString("es-AR", { minimumFractionDigits: 2 })) + "</span></div></div><p class=\\"muted\\">Orden de compra emitida y despachada desde el módulo de Prestadores de Asistir24.</p><button onclick=\\"window.print()\\">Imprimir / Guardar PDF</button></body></html>";',
      '  res.type("html").send(html);',
      '});',
      '',
      apiMarker
    ].join('\n');
    fixed = fixed.replace(apiMarker, api);
  }

  const routeMarker = 'app.get("/facturacion", (req, res) => res.sendFile(path.join(__dirname, "public", "facturacion.html")));';
  if (fixed.includes(routeMarker) && !fixed.includes('app.get("/prestador"')) {
    fixed = fixed.replace(routeMarker, routeMarker + '\napp.get("/prestador", (req, res) => res.sendFile(path.join(__dirname, "public", "prestador.html")));\napp.get("/prestadores-revision", (req, res) => res.sendFile(path.join(__dirname, "public", "prestadores-revision.html")));');
  }

  console.log("[Asistir24] Módulo Prestadores: facturación, anti-duplicado y OC activos");
  return fixed;
}

module.exports = { patchServerSource };
