function normalize(value) {
  return String(value ?? "").replace(/\r/g, "").trim();
}

function field(text, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = normalize(text).match(new RegExp(`-\\s*${escaped}\\s*:\\s*([^\\n]*)`, "i"));
  return match ? match[1].trim() : "";
}

function classify(subject, body) {
  const text = `${normalize(subject)}\n${normalize(body)}`.toLowerCase();
  if (/se te asign[oó]|servicio asignado/.test(text)) return "CONFIRMACION";
  if (/para cotizar/.test(text)) return "COTIZAR";
  return "REVISAR";
}

function parseClaimsMail({ messageId, threadId, subject, body }) {
  return {
    gmailMessageId: messageId,
    gmailThreadId: threadId,
    evento: classify(subject, body),
    asistenciaId: field(body, "ID Asistencia"),
    tipoAsistencia: field(body, "Tipo de asistencia"),
    origen: field(body, "Origen"),
    destino: field(body, "Destino"),
    puntoEncuentro: field(body, "Punto de encuentro"),
    vehiculo: field(body, "Vehículo a asistir"),
    informacionTecnica: field(body, "Información técnica"),
    patente: field(body, "Patente del vehículo a asistir"),
    observaciones: field(body, "Observaciones"),
    asegurado: field(body, "Asegurado"),
    telefono: field(body, "Teléfono del asegurado"),
    emailAsegurado: field(body, "Mail del asegurado"),
    subject: normalize(subject)
  };
}

module.exports = { classify, parseClaimsMail };
