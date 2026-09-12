function normalize(value) {
  return String(value || "").replace(/\r/g, "").trim();
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
  const infoTecnica = field(body, "Información técnica");
  const peso = Number((infoTecnica.match(/peso\s*:\s*([0-9.,]+)/i)?.[1] || "0").replace(",", "."));
  const vehiculo = field(body, "Vehículo a asistir");
  const tipoAsistencia = field(body, "Tipo de asistencia");
  let tipoServicio = "Liviano";
  if (/moto/i.test(`${vehiculo} ${tipoAsistencia}`)) tipoServicio = "Moto";
  else if (/auxilio|mecanico|mecánico/i.test(tipoAsistencia)) tipoServicio = "Auxilio mecanico";
  else if (peso >= 1800) tipoServicio = "Semipesado";

  const lines = normalize(body).split("\n").map(v => v.trim()).filter(Boolean);
  const empresa = [...lines].reverse().find(v => /seguros|seguro|s\.a\.?$/i.test(v)) || "Compañía";

  return {
    gmailMessageId: messageId,
    gmailThreadId: threadId,
    evento: classify(subject, body),
    asistenciaId: field(body, "ID Asistencia"),
    tipoAsistencia,
    origen: field(body, "Origen") || field(body, "Punto de encuentro"),
    destino: field(body, "Destino"),
    vehiculo,
    peso,
    patente: field(body, "Patente del vehículo a asistir").toUpperCase(),
    observaciones: field(body, "Observaciones"),
    asegurado: field(body, "Asegurado"),
    telefono: field(body, "Teléfono del asegurado"),
    emailAsegurado: field(body, "Mail del asegurado"),
    empresa,
    tipoServicio,
    subject: normalize(subject)
  };
}

module.exports = { classify, parseClaimsMail };
