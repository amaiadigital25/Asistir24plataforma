const ESTADOS_FLUJO = Object.freeze([
  "MAIL_RECIBIDO",
  "PROCESANDO",
  "COTIZACION_LISTA",
  "REMITO_LISTO",
  "ESPERANDO_CONFIRMACION",
  "CONFIRMADO",
  "LISTO_PARA_WHATSAPP",
  "ENVIADO_WHATSAPP",
  "EN_SERVICIO",
  "FINALIZADO"
]);

function nowIso() {
  return new Date().toISOString();
}

function ensureWorkflow(cotizacion) {
  if (!cotizacion.flujo || typeof cotizacion.flujo !== "object") {
    cotizacion.flujo = {
      estado: "ESPERANDO_CONFIRMACION",
      mailRecibidoAt: null,
      cotizacionListaAt: cotizacion.fecha || null,
      remitoListoAt: cotizacion.fecha || null,
      confirmadoAt: null,
      confirmadoBy: null,
      whatsappListoAt: null,
      whatsappEnviadoAt: null,
      whatsappEnviadoBy: null,
      enServicioAt: null,
      finalizadoAt: null,
      updatedAt: cotizacion.fecha || nowIso(),
      updatedBy: cotizacion.operador || null,
      historial: []
    };
  }

  if (!ESTADOS_FLUJO.includes(cotizacion.flujo.estado)) {
    cotizacion.flujo.estado = "ESPERANDO_CONFIRMACION";
  }

  if (!Array.isArray(cotizacion.flujo.historial)) {
    cotizacion.flujo.historial = [];
  }

  return cotizacion.flujo;
}

function cambiarEstado(cotizacion, estado, usuario, detalle = "") {
  if (!ESTADOS_FLUJO.includes(estado)) throw new Error("Estado de flujo invalido");
  const flujo = ensureWorkflow(cotizacion);
  const anterior = flujo.estado;
  const fecha = nowIso();
  flujo.estado = estado;
  flujo.updatedAt = fecha;
  flujo.updatedBy = usuario || null;
  flujo.historial.unshift({ fecha, desde: anterior, hacia: estado, usuario: usuario || null, detalle: detalle || "" });
  flujo.historial = flujo.historial.slice(0, 100);
  return flujo;
}

function buildRemito(cotizacion) {
  const auxilio = String(cotizacion.tipoServicio || "").toLowerCase().replace(/á/g, "a") === "auxilio mecanico";
  const interior = cotizacion.base?.modalidad === "INTERIOR";
  const recorrido = auxilio
    ? `Base -> Origen: ${Number(cotizacion.tramos?.baseOrigen || 0).toFixed(1)} km`
    : interior
      ? `Base -> Origen: ${Number(cotizacion.tramos?.baseOrigen || 0).toFixed(1)} km | Origen -> Destino: ${Number(cotizacion.tramos?.origenDestino || 0).toFixed(1)} km | Destino -> Base: ${Number(cotizacion.tramos?.destinoBase || 0).toFixed(1)} km`
      : `Base -> Origen: ${Number(cotizacion.tramos?.baseOrigen || 0).toFixed(1)} km | Origen -> Destino: ${Number(cotizacion.tramos?.origenDestino || 0).toFixed(1)} km`;

  const lines = [
    "ASISTIR24 - REMITO DE SERVICIO",
    "",
    `Empresa / cliente: ${cotizacion.empresa || "-"}`,
    `Nº de servicio: ${cotizacion.numeroServicio || "-"}`,
    `Patente: ${cotizacion.patente || "-"}`,
    `Tipo de servicio: ${cotizacion.tipoServicio || "-"}`,
    `Base asignada: ${cotizacion.base?.base || "-"} - ${cotizacion.base?.prestador || "-"}`,
    `Origen: ${cotizacion.origen || "-"}`,
    ...(!auxilio ? [`Destino: ${cotizacion.destino || "-"}`] : []),
    `Recorrido: ${recorrido}`,
    `Km totales: ${Number(cotizacion.kmTotal || 0).toFixed(1)} km`,
    `ID cotizacion: ${cotizacion.id || "-"}`
  ];

  return {
    version: 1,
    preparadoAt: nowIso(),
    texto: lines.join("\n"),
    incluyeImportes: false
  };
}

module.exports = {
  ESTADOS_FLUJO,
  ensureWorkflow,
  cambiarEstado,
  buildRemito
};
