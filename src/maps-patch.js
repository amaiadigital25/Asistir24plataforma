// Asistir24 routing without Google dependency.
// Geocoding: coordinates -> Georef Argentina (direcciones/localidades) -> Nominatim -> Photon. Routing: OSRM.
const nativeFetch = global.fetch;

if (typeof nativeFetch !== "function") throw new Error("Asistir24 maps requiere Node.js con fetch global");

// server.js mantiene una validación histórica de esta variable antes de llamar
// a fetch. El valor local habilita esa ruta; las solicitudes se interceptan más
// abajo y se resuelven con Georef/OSM/Photon y OSRM, sin enviar esta clave.
if (!process.env.GOOGLE_MAPS_API_KEY) process.env.GOOGLE_MAPS_API_KEY = "asistir24-osm-fallback";

const USER_AGENT = process.env.OSM_USER_AGENT || "Asistir24/1.3 (operaciones@asistir24.com.ar)";
const REQUEST_TIMEOUT_MS = Math.max(3000, Number(process.env.MAPS_TIMEOUT_MS || 10000));
const NOMINATIM_URL = process.env.NOMINATIM_URL || "https://nominatim.openstreetmap.org";
const PHOTON_URL = process.env.PHOTON_URL || "https://photon.komoot.io";
const GEOREF_URL = process.env.GEOREF_URL || "https://apis.datos.gob.ar/georef/api/v2.0";
const OSRM_URLS = String(process.env.OSRM_URLS || "https://router.project-osrm.org,https://routing.openstreetmap.de/routed-car").split(",").map(v => v.trim()).filter(Boolean);
let lastNominatimAt = 0;
const geocodeCache = new Map();
const routeCache = new Map();
const CACHE_MAX = 5000;
function cacheSet(cache, key, value) {
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(key, value);
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
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
  return String(value || "")
    .replace(/\bZONA\s+(NORTE|SUR|OESTE)\b/gi, "")
    .replace(/\bSIN DATO\b/gi, "")
    .replace(/\bPROVINCIA DE BUENOS AIRES\b(?=\s*,?\s*(SALTA|TUCUMAN|TUCUMÁN|MENDOZA|LA PAMPA|MISIONES|CHACO|SANTA FE|ENTRE RIOS|ENTRE RÍOS|CORDOBA|CÓRDOBA|SANTA CRUZ))/gi, "")
    .replace(/\s+/g, " ")
    .replace(/\s*,\s*/g, ", ")
    .replace(/(?:,\s*){2,}/g, ", ")
    .replace(/^\s*,+\s*/, "")
    .replace(/\s*,+\s*$/, "")
    .trim();
}
function withArgentina(value) {
  const text = cleanAddress(value);
  if (!text) return text;
  return /argentina/i.test(text) ? text : `${text}, Argentina`;
}
function addressVariants(address) {
  const original = cleanAddress(address);
  const variants = [original];
  const aliases = [
    [/\bCasanova\b/gi, "Isidro Casanova, La Matanza, Buenos Aires"],
    [/\bVarela\b/gi, "Florencio Varela, Buenos Aires"],
    [/\bDon Torcuato\b/gi, "Don Torcuato, Tigre, Buenos Aires"],
    [/\bVilla Dominico\b/gi, "Villa Domínico, Avellaneda, Buenos Aires"],
    [/\bMoron\b/gi, "Morón, Buenos Aires"],
    [/\bGeneral San Martin\b/gi, "General San Martín, Buenos Aires"],
    [/\bBerazategui\b/gi, "Berazategui, Buenos Aires"],
    [/\bLomas de Zamora\b/gi, "Lomas de Zamora, Buenos Aires"],
    [/\bGarin\b/gi, "Garín, Escobar, Buenos Aires"],
    [/\bJose C\.? Paz\b/gi, "José C. Paz, Buenos Aires"],
    [/\bJose Leon Suarez\b/gi, "José León Suárez, General San Martín, Buenos Aires"],
    [/\bValentin Alsina\b/gi, "Valentín Alsina, Lanús, Buenos Aires"],
    [/\bVilla Tesei\b/gi, "Villa Tesei, Hurlingham, Buenos Aires"],
    [/\bEl Pato\b/gi, "El Pato, Berazategui, Buenos Aires"],
    [/\bBurzaco\b/gi, "Burzaco, Almirante Brown, Buenos Aires"],
    [/\bDevoto\b/gi, "Villa Devoto, Ciudad Autónoma de Buenos Aires"],
    [/\bCABA\b/gi, "Ciudad Autónoma de Buenos Aires"],
    [/\bZarate\b/gi, "Zárate, Buenos Aires"],
    [/\bJunin\b/gi, "Junín, Buenos Aires"],
    [/\bOlavarria\b/gi, "Olavarría, Buenos Aires"],
    [/\bBahia Blanca\b/gi, "Bahía Blanca, Buenos Aires"],
    [/\bMar de Ajo\b/gi, "Mar de Ajó, Buenos Aires"],
    [/\bJose C Paz\b/gi, "José C. Paz, Buenos Aires"]
  ];
  for (const [pattern, replacement] of aliases) {
    pattern.lastIndex = 0;
    if (pattern.test(original)) {
      pattern.lastIndex = 0;
      variants.push(cleanAddress(original.replace(pattern, replacement)));
    }
  }
  const parts = original.split(",").map(v => v.trim()).filter(Boolean);
  if (parts.length > 2) variants.push(parts.slice(0, 3).join(", "));
  if (parts.length > 1) variants.push(parts.slice(-3).join(", "));
  return [...new Set(variants.filter(Boolean))];
}
function localityCandidate(address) {
  const text = cleanAddress(address).replace(/,?\s*argentina\s*$/i, "");
  const parts = text.split(",").map(v => v.trim()).filter(Boolean);
  if (!parts.length) return "";
  const first = parts[0]
    .replace(/\b(av(?:enida)?|calle|ruta|rn|rp)\.?\s*/gi, "")
    .replace(/\b\d+[a-z]?\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  return first || parts[0];
}
async function georefGeocode(address) {
  const normalized = cleanAddress(address).replace(/,?\s*argentina\s*$/i, "");
  if (!normalized) throw new Error("Georef sin dirección");
  const url = new URL(`${GEOREF_URL.replace(/\/$/, "")}/direcciones`);
  url.searchParams.set("direccion", normalized);
  url.searchParams.set("max", "5");
  const response = await fetchWithTimeout(url, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`Georef direcciones HTTP ${response.status}`);
  const data = await response.json();
  const items = Array.isArray(data?.direcciones) ? data.direcciones : [];
  const best = items.find(item => validArgentinaPoint(Number(item?.ubicacion?.lat), Number(item?.ubicacion?.lon)));
  if (!best) throw new Error("Georef direcciones sin resultado");
  return { lat: Number(best.ubicacion.lat), lng: Number(best.ubicacion.lon), displayName: best.nomenclatura || normalized, provider: "Georef Argentina" };
}
async function georefLocalityGeocode(address) {
  const name = localityCandidate(address);
  if (!name || name.length < 3) throw new Error("Georef localidades sin nombre");
  const endpoints = [
    `${GEOREF_URL.replace(/\/$/, "")}/localidades`,
    "https://apis.datos.gob.ar/georef/api/localidades"
  ];
  let lastError = null;
  for (const endpoint of endpoints) {
    try {
      const url = new URL(endpoint);
      url.searchParams.set("nombre", name);
      url.searchParams.set("max", "5");
      const response = await fetchWithTimeout(url, { headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      const items = Array.isArray(data?.localidades) ? data.localidades : [];
      const best = items.find(item => validArgentinaPoint(Number(item?.centroide?.lat ?? item?.ubicacion?.lat), Number(item?.centroide?.lon ?? item?.ubicacion?.lon)));
      if (!best) throw new Error("sin resultado");
      const lat = Number(best?.centroide?.lat ?? best?.ubicacion?.lat);
      const lng = Number(best?.centroide?.lon ?? best?.ubicacion?.lon);
      const displayName = [best?.nombre, best?.departamento?.nombre, best?.provincia?.nombre].filter(Boolean).join(", ") || name;
      return { lat, lng, displayName, provider: "Georef Localidades" };
    } catch (error) { lastError = error; }
  }
  throw new Error(`Georef localidades ${lastError?.message || "sin resultado"}`);
}
async function nominatimGeocode(address) {
  const wait = Math.max(0, 1100 - (Date.now() - lastNominatimAt));
  if (wait) await sleep(wait);
  lastNominatimAt = Date.now();
  const url = new URL(`${NOMINATIM_URL.replace(/\/$/, "")}/search`);
  url.searchParams.set("q", withArgentina(address));
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "5");
  url.searchParams.set("countrycodes", "ar");
  url.searchParams.set("addressdetails", "1");
  const response = await fetchWithTimeout(url, { headers: { "User-Agent": USER_AGENT, "Accept-Language": "es-AR,es;q=0.9" } });
  if (!response.ok) throw new Error(`Nominatim HTTP ${response.status}`);
  const data = await response.json();
  const best = Array.isArray(data) ? data.find(item => validArgentinaPoint(Number(item.lat), Number(item.lon))) : null;
  if (!best) throw new Error("Nominatim sin resultado");
  return { lat: Number(best.lat), lng: Number(best.lon), displayName: best.display_name || "", provider: "OpenStreetMap" };
}
async function photonGeocode(address) {
  const url = new URL(`${PHOTON_URL.replace(/\/$/, "")}/api/`);
  url.searchParams.set("q", withArgentina(address));
  url.searchParams.set("limit", "5");
  url.searchParams.set("lang", "es");
  const response = await fetchWithTimeout(url, { headers: { "User-Agent": USER_AGENT } });
  if (!response.ok) throw new Error(`Photon HTTP ${response.status}`);
  const data = await response.json();
  const features = Array.isArray(data?.features) ? data.features : [];
  const arg = features.find(f => String(f?.properties?.country || "").toLowerCase().includes("argentina")) || features[0];
  const coords = arg?.geometry?.coordinates;
  if (!Array.isArray(coords) || coords.length < 2) throw new Error("Photon sin resultado");
  const lng = Number(coords[0]); const lat = Number(coords[1]);
  if (!validArgentinaPoint(lat, lng)) throw new Error("Photon devolvió coordenadas inválidas");
  return { lat, lng, displayName: arg?.properties?.name || "", provider: "Photon" };
}
async function geocodeOSM(address) {
  const coordinate = parseCoordinates(cleanAddress(address).replace(/,?\s*argentina\s*$/i, ""));
  if (coordinate) return coordinate;
  const cacheKey = withArgentina(address).toLowerCase();
  if (geocodeCache.has(cacheKey)) return geocodeCache.get(cacheKey);
  const errors = [];
  for (const variant of addressVariants(address)) {
    for (const provider of [georefGeocode, georefLocalityGeocode, nominatimGeocode, photonGeocode]) {
      try {
        const point = await provider(variant);
        cacheSet(geocodeCache, cacheKey, point);
        console.log(`[Asistir24 Maps] ${point.provider || "Geocoder"}: ${cleanAddress(variant)} -> ${point.lat},${point.lng}`);
        return point;
      } catch (error) { errors.push(error.message); }
    }
  }
  throw new Error(`No se pudo localizar: ${cleanAddress(address)}. ${errors.slice(-8).join(" | ")}`);
}
async function osrmRoute(origin, destination, baseUrl) {
  const coords = `${origin.lng},${origin.lat};${destination.lng},${destination.lat}`;
  const url = `${baseUrl.replace(/\/$/, "")}/route/v1/driving/${coords}?overview=false&steps=false&alternatives=false`;
  const response = await fetchWithTimeout(url, { headers: { "User-Agent": USER_AGENT } });
  if (!response.ok) throw new Error(`OSRM HTTP ${response.status}`);
  const data = await response.json();
  const meters = Number(data?.routes?.[0]?.distance);
  if (!Number.isFinite(meters) || meters <= 0) throw new Error("OSRM sin distancia válida");
  return meters;
}
async function routeOSM(origin, destination) {
  const routeKey = `${origin.lat.toFixed(5)},${origin.lng.toFixed(5)}>${destination.lat.toFixed(5)},${destination.lng.toFixed(5)}`;
  if (routeCache.has(routeKey)) return routeCache.get(routeKey);
  const errors = [];
  for (const baseUrl of OSRM_URLS) {
    try { const meters = await osrmRoute(origin, destination, baseUrl); cacheSet(routeCache, routeKey, meters); return meters; }
    catch (error) { errors.push(error.message); }
  }
  throw new Error(`No se pudo calcular el recorrido. ${errors.join(" | ")}`);
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
      const point = await geocodeOSM(address);
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
      const meters = await routeOSM(origin, destination);
      console.log(`[Asistir24 Maps] OSRM calculó ${(meters / 1000).toFixed(1)} km`);
      return jsonResponse({ routes: [{ distanceMeters: Math.round(meters) }] });
    } catch (error) {
      console.error("[Asistir24 Maps] Error de ruta:", error.message);
      return jsonResponse({ error: { message: error.message } }, 503);
    }
  }
  return nativeFetch(input, init);
};

console.log("[Asistir24 Maps] Automatización de localización activa: coordenadas + Georef direcciones/localidades + OSM/Photon + OSRM");
