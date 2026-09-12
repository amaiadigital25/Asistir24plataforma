function normalize(value) {
  return String(value || "").replace(/\r/g, "").trim();
}

function classifyClaimsEmail(subject, body) {
  const text = `${normalize(subject)}\n${normalize(body)}`.toLowerCase();
  if (/se te asign[oó]|factura procesada|confirmaci[oó]n|servicio asignado/.test(text)) return "IGNORAR";
  if (/para cotizar/.test(text)) return "COTIZAR";
  return "REVISAR";
}

function field(text, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = normalize(text).match(new RegExp(`-\\s*${escaped}\\s*:\\s*(.*)`, "i"));
  return match ? match[1].trim() : "";
}

function parseClaimsService({ messageId, threadId, subject, body }) {
  return {
    gmailMessageId: messageId,
    gmailThreadId: threadId,
    clasificacion: classifyClaimsEmail(subject, body),
    asistenciaId: field(body, "ID Asistencia"),
    tipoAsistencia: field(body, "Tipo de asistencia"),
    origen: field(body, "Origen") || field(body, "Punto de encuentro"),
    destino: field(body, "Destino"),
    vehiculo: field(body, "Vehículo a asistir"),
    patente: field(body, "Patente del vehículo a asistir"),
    observaciones: field(body, "Observaciones"),
    asegurado: field(body, "Asegurado"),
    subject: normalize(subject)
  };
}

module.exports = { classifyClaimsEmail, parseClaimsService };
