function normalize(value) {
  return String(value ?? "").replace(/\r/g, "").trim();
}

function field(text, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = normalize(text).match(new RegExp(`(?:^|\\n)\\s*-?\\s*${escaped}\\s*:\\s*([^\\n]*)`, "i"));
  return match ? match[1].trim() : "";
}

function classify(subject, body) {
  const text = `${normalize(subject)}\n${normalize(body)}`.toLowerCase();
  if (/se te asign[oó]|servicio asignado/.test(text)) return "CONFIRMACION";
  if (/para cotizar/.test(text)) return "COTIZAR";
  return "REVISAR";
}

function companyFromBody(body) {
  const lines = normalize(body).split("\n").map(v => v.trim()).filter(Boolean);
  return [...lines].reverse().find(v => /seguros?(?:\s+s\.a\.?)?$/i.test(v)) || "";
}

function parseClaimsMail({ messageId, threadId, subject, body }) {
  const tipoAsistencia = field(body, "Tipo de asistencia");
  const puntoEncuentro = field(body, "Punto de encuentro");

  return {
    gmailMessageId: messageId,
    gmailThreadId: threadId,
    evento: classify(subject, body),
    asistenciaId: field(body, "ID Asistencia"),
    tipoAsistencia,
    tipoServicio: tipoAsistencia,
    origen: field(body, "Origen") || puntoEncuentro,
    destino: field(body, "Destino"),
    puntoEncuentro,
    vehiculo: field(body, "Vehículo a asistir"),
    marca: field(body, "Marca") || field(body, "Marca del vehículo"),
    modelo: field(body, "Modelo") || field(body, "Modelo del vehículo"),
    color: field(body, "Color") || field(body, "Color del vehículo"),
    fechaServicio: field(body, "Cuándo es el servicio") || field(body, "Fecha del servicio"),
    condicionServicio: field(body, "Condición servicio") || field(body, "Condición del servicio"),
    transmision: field(body, "Transmisión"),
    especificaciones: field(body, "Especificaciones"),
    personasTrasladar: field(body, "Personas a trasladar"),
    siniestro: field(body, "¿Es por siniestro?") || field(body, "Es por siniestro"),
    enCochera: field(body, "¿Está en cochera?") || field(body, "Está en cochera"),
    poseeCarga: field(body, "¿Posee carga?") || field(body, "Posee carga"),
    vehiculoRueda: field(body, "¿El vehículo rueda?") || field(body, "El vehículo rueda"),
    tieneTrailer: field(body, "¿El vehículo tiene trailer?") || field(body, "El vehículo tiene trailer"),
    requiereExtraccion: field(body, "¿Requiere extracción?") || field(body, "Requiere extracción"),
    informacionTecnica: field(body, "Información técnica"),
    patente: field(body, "Patente del vehículo a asistir"),
    observaciones: field(body, "Observaciones"),
    asegurado: field(body, "Asegurado"),
    telefono: field(body, "Teléfono del asegurado"),
    emailAsegurado: field(body, "Mail del asegurado"),
    empresa: companyFromBody(body),
    subject: normalize(subject)
  };
}

module.exports = { classify, parseClaimsMail };
