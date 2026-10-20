// Asistir24 routing with TomTom as the production maps provider.\n// Existing Google-shaped calls are intercepted so the rest of the cotizador remains unchanged.
const nativeFetch = global.fetch;

if (typeof nativeFetch !== "function") throw new Error("Asistir24 maps requiere Node.js con fetch global");

// server.js mantiene una validación histórica de esta variable antes de llamar
// a fetch. El valor local habilita esa ruta; las solicitudes se interceptan más
// abajo y se resuelven con Georef/OSM/Photon y OSRM, sin enviar esta clave.
if (!process.env.GOOGLE_MAPS_API_KEY) process.env.GOOGLE_MAPS_API_KEY = "asistir24-osm-fallback";

const REQUEST_TIMEOUT_MS = Math.max(3000, Number(process.env.MAPS_TIMEOUT_MS || 10000));
const TOMTOM_API_KEY = String(process.env.TOMTOM_API_KEY || "").trim();
if (!TOMTOM_API_KEY) throw new Error("TOMTOM_API_KEY no configurada");

const geocodeCache = new Map();
const routeCache = new Map();
const CACHE_MAX = 5000;
function cacheSet(cache, key, value) {
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(key, value);
}
async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try { return await nativeFetch(url, { ...options, signal: controller.signal }); }
  finally { clearTimeout(timer); }
}
function validArgentinaPoint(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -56 && lat <= -20 && lng >= -74 && lng <= -52;
}
function parseCoordinates(value) {
  const text = String(value || "").trim();
  const match = text.match(/^\(?\s*(-?\d{1,2}(?:[.,]\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:[.,]\d+)?)\s*\)?$/);
  if (!match) return null;
  const lat = Number(match[1].replace(",", "."));
  const lng = Number(match[2].replace(",", "."));
  return validArgentinaPoint(lat, lng) ? { lat, lng, displayName: text, provider: "Coordenadas" } : null;
}
function cleanAddress(value) {
  return String(value || "").replace(/\s+/g, " ").replace(/\s*,\s*/g, ", ").trim();
}
function normalizePlace(value) {
  return String(value || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\b(provincia|province|prov)\s+(de\s+)?/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
function resultAdminText(result) {
  const a = result?.address || {};
  return normalizePlace([
    a.countrySubdivision, a.countrySecondarySubdivision, a.municipality,
    a.municipalitySubdivision, a.localName, a.freeformAddress
  ].filter(Boolean).join(" "));
}
function resultMatchesRequestedArea(address, result) {
  const parts = cleanAddress(address).split(",").map(p => p.trim()).filter(Boolean);
  const expected = parts.slice(1).filter(p => !/^argentina$/i.test(p));
  if (!expected.length) return true;
  const admin = resultAdminText(result);
  const lastExpected = normalizePlace(expected[expected.length - 1]);
  const subdivision = normalizePlace(result?.address?.countrySubdivision || "");
  // Never accept a result from a different province when the query names one.
  if (lastExpected && subdivision && lastExpected !== subdivision &&
      !subdivision.includes(lastExpected) && !lastExpected.includes(subdivision)) return false;
  // Prefer an administrative match; if the provider returned no usable admin fields,
  // fail closed instead of quoting with an unrelated Argentine result.
  return expected.some(part => {
    const token = normalizePlace(part);
    return token.length >= 3 && (admin.includes(token) || (subdivision && token.includes(subdivision)));
  });
}
function withArgentina(value) {
  const text = cleanAddress(value);
  return /argentina/i.test(text) ? text : `${text}, Argentina`;
}
async function tomtomGeocode(address) {
  const direct = parseCoordinates(cleanAddress(address).replace(/,?\s*argentina\s*$/i, ""));
  if (direct) return direct;
  // Corrección puntual para la referencia genérica RP11 confirmada por el operador.
  // Se aplica aquí porque este módulo intercepta las consultas de mapas en producción.
  const normalizedAddress = cleanAddress(address).toLowerCase().replaceAll(" ", "");
  if (normalizedAddress.includes("rp11") && normalizedAddress.includes("provinciadebuenosaires") && !normalizedAddress.includes("km")) {
    const point = { lat: -36.441328656727094, lng: -57.361992906705154, displayName: "RP11, punto confirmado por coordenadas, Provincia de Buenos Aires", provider: "coordenadas-confirmadas" };
    cacheSet(geocodeCache, normalizedAddress, point);
    console.log(`[Asistir24 Maps] RP11 corregida por coordenadas confirmadas: ${point.lat},${point.lng}`);
    return point;
  }
  const query = withArgentina(address);
  const cacheKey = query.toLowerCase();
  if (geocodeCache.has(cacheKey)) return geocodeCache.get(cacheKey);
  const url = new URL(`https://api.tomtom.com/search/2/geocode/${encodeURIComponent(query)}.json`);
  url.searchParams.set("key", TOMTOM_API_KEY);
  url.searchParams.set("countrySet", "AR");
  url.searchParams.set("limit", "5");
  url.searchParams.set("language", "es-AR");
  const response = await fetchWithTimeout(url, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`TomTom geocode HTTP ${response.status}`);
  const data = await response.json();
  const results = Array.isArray(data?.results) ? data.results : [];
  const candidates = results.filter(r => validArgentinaPoint(Number(r?.position?.lat), Number(r?.position?.lon)));
  const best = candidates.find(r => resultMatchesRequestedArea(address, r));
  if (!best) {
    const areas = candidates.map(r => r?.address?.freeformAddress || r?.address?.countrySubdivision || "ubicación sin datos administrativos").slice(0, 3);
    throw new Error(`TomTom sin resultado compatible con la localidad/provincia solicitada: ${cleanAddress(address)}${areas.length ? `. Resultados descartados: ${areas.join(" | ")}` : ""}`);
  }
  const point = { lat: Number(best.position.lat), lng: Number(best.position.lon), displayName: best?.address?.freeformAddress || query, provider: "TomTom" };
  cacheSet(geocodeCache, cacheKey, point);
  console.log(`[Asistir24 Maps] TomTom geocode: ${cleanAddress(address)} -> ${point.lat},${point.lng}`);
  return point;
}
async function tomtomRoute(origin, destination) {
  const routeKey = `${origin.lat.toFixed(5)},${origin.lng.toFixed(5)}>${destination.lat.toFixed(5)},${destination.lng.toFixed(5)}`;
  if (routeCache.has(routeKey)) return routeCache.get(routeKey);
  const locations = `${origin.lat},${origin.lng}:${destination.lat},${destination.lng}`;
  const url = new URL(`https://api.tomtom.com/routing/1/calculateRoute/${locations}/json`);
  url.searchParams.set("key", TOMTOM_API_KEY);
  url.searchParams.set("travelMode", "car");
  url.searchParams.set("routeType", "fastest");
  url.searchParams.set("traffic", "true");
  const response = await fetchWithTimeout(url, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`TomTom route HTTP ${response.status}`);
  const data = await response.json();
  const meters = Number(data?.routes?.[0]?.summary?.lengthInMeters);
  if (!Number.isFinite(meters) || meters <= 0) throw new Error("TomTom no devolvió una distancia válida");
  cacheSet(routeCache, routeKey, meters);
  console.log(`[Asistir24 Maps] TomTom route: ${(meters / 1000).toFixed(1)} km`);
  return meters;
}
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}
global.fetch = async function patchedFetch(input, init = {}) {
  const url = typeof input === "string" ? input : (input instanceof URL ? input.toString() : input?.url);
  if (url && url.startsWith("https://maps.googleapis.com/maps/api/geocode/json")) {
    const parsed = new URL(url);
    const address = parsed.searchParams.get("address") || "";
    try {
      const point = await tomtomGeocode(address);
      return jsonResponse({ status: "OK", results: [{ formatted_address: point.displayName, geometry: { location: { lat: point.lat, lng: point.lng } } }] });
    } catch (error) {
      console.error("[Asistir24 Maps] Error geocodificando:", error.message);
      return jsonResponse({ status: "ZERO_RESULTS", results: [], error_message: error.message });
    }
  }
  if (url === "https://routes.googleapis.com/directions/v2:computeRoutes") {
    try {
      const body = typeof init.body === "string" ? JSON.parse(init.body) : (init.body || {});
      const o = body?.origin?.location?.latLng; const d = body?.destination?.location?.latLng;
      const origin = { lat: Number(o?.latitude), lng: Number(o?.longitude) };
      const destination = { lat: Number(d?.latitude), lng: Number(d?.longitude) };
      if (![origin.lat, origin.lng, destination.lat, destination.lng].every(Number.isFinite)) throw new Error("Coordenadas inválidas para el recorrido");
      const meters = await tomtomRoute(origin, destination);
      
      return jsonResponse({ routes: [{ distanceMeters: Math.round(meters) }] });
    } catch (error) {
      console.error("[Asistir24 Maps] Error de ruta:", error.message);
      return jsonResponse({ error: { message: error.message } }, 503);
    }
  }
  return nativeFetch(input, init);
};

console.log("[Asistir24 Maps] TomTom activo: geocodificación + routing en producción");
