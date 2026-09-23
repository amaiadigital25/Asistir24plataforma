const crypto = require("crypto");

function normalizeText(value) {
  return String(value ?? "").replace(/\r/g, "").trim();
}

function parseCoordinatePair(value) {
  const text = normalizeText(value);
  const m = text.match(/(-?\d{1,2}(?:[.,]\d+)?)\s*[,; ]\s*(-?\d{1,3}(?:[.,]\d+)?)/);
  if (!m) return null;
  const lat = Number(m[1].replace(",", "."));
  const lng = Number(m[2].replace(",", "."));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -56 || lat > -20 || lng < -74 || lng > -52) return null;
  return { lat, lng };
}

function first(obj, paths) {
  for (const path of paths) {
    let value = obj;
    for (const key of path.split(".")) value = value && value[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
  }
  return "";
}

function parseClaimsPayload(payload = {}) {
  const asistenciaId = normalizeText(first(payload, ["asistenciaId","idAsistencia","assistanceId","serviceId","id"]));
  const lat = Number(first(payload, ["lat","latitude","origen.lat","origin.lat","ubicacion.lat","location.lat"]));
  const lng = Number(first(payload, ["lng","lon","longitude","origen.lng","origin.lng","ubicacion.lng","location.lng"]));
  const coordinate = Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } :
    parseCoordinatePair(first(payload, ["coordenadas","coordinates","origen","origin","ubicacion","location"]));
  const origenTexto = normalizeText(first(payload, ["origen.direccion","origin.address","direccionOrigen","pickupAddress","puntoEncuentro","meetingPoint","origen","origin"]));
  const destino = normalizeText(first(payload, ["destino.direccion","destination.address","direccionDestino","dropoffAddress","destino","destination"]));
  const tipoServicio = normalizeText(first(payload, ["tipoServicio","tipoAsistencia","serviceType","assistanceType"]));

  return {
    asistenciaId,
    tipoServicio,
    origen: coordinate ? `${coordinate.lat},${coordinate.lng}` : origenTexto,
    origenTexto,
    coordenadasOrigen: coordinate,
    destino,
    rawHash: crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex")
  };
}

function claimsServiceKey(service) {
  return service.asistenciaId || service.rawHash;
}

module.exports = { parseClaimsPayload, claimsServiceKey, parseCoordinatePair };
