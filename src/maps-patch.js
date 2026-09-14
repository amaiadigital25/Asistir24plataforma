// Asistir24 routing without Google dependency.
// Geocoding: Nominatim -> Photon. Routing: OSRM.
// Public Nominatim is rate-limited deliberately; move endpoints to self-hosted/provider via env when volume grows.
const nativeFetch = global.fetch;

if (typeof nativeFetch !== "function") {
  throw new Error("Asistir24 maps requiere Node.js con fetch global");
}

const USER_AGENT = process.env.OSM_USER_AGENT || "Asistir24/1.1 (operaciones@asistir24.com.ar)";
const REQUEST_TIMEOUT_MS = Math.max(3000, Number(process.env.MAPS_TIMEOUT_MS || 10000));
const NOMINATIM_URL = process.env.NOMINATIM_URL || "https://nominatim.openstreetmap.org";
const PHOTON_URL = process.env.PHOTON_URL || "https://photon.komoot.io";
const OSRM_URLS = String(process.env.OSRM_URLS || "https://router.project-osrm.org,https://routing.openstreetmap.de/routed-car").split(",").map(v => v.trim()).filter(Boolean);
let lastNominatimAt = 0;
const geocodeCache = new Map();

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try { return await nativeFetch(url, { ...options, signal: controller.signal }); }
  finally { clearTimeout(timer); }
}

function cleanAddress(value) {
  return String(value || "")
    .replace(/\bZONA\s+(NORTE|SUR|OESTE)\b/gi, "")
    .replace(/\bSIN DATO\b/gi, "")
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
    [/\bCasanova\b/gi, "Isidro Casanova, La Matanza"],
    [/\bDon Torcuato\b/gi, "Don Torcuato, Tigre"],
    [/\bVilla Dominico\b/gi, "Villa Domínico, Avellaneda"],
    [/\bMoron\b/gi, "Morón"],
    [/\bGeneral San Martin\b/gi, "General San Martín"]
  ];
  for (const [pattern, replacement] of aliases) {
    if (pattern.test(original)) variants.push(cleanAddress(original.replace(pattern, replacement)));
  }
  const parts = original.split(",").map(v => v.trim()).filter(Boolean);
  if (parts.length > 2) variants.push(parts.slice(0, 3).join(", "));
  if (parts.length > 1) variants.push(parts.slice(-3).join(", "));
  return [...new Set(variants.filter(Boolean))];
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
  const best = Array.isArray(data) ? data.find(item => Number.isFinite(Number(item.lat)) && Number.isFinite(Number(item.lon))) : null;
  if (!best) throw new Error("Nominatim sin resultado");
  return { lat: Number(best.lat), lng: Number(best.lon), displayName: best.display_name || "" };
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
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new Error("Photon devolvió coordenadas inválidas");
  return { lat, lng, displayName: arg?.properties?.name || "" };
}

async function geocodeOSM(address) {
  const cacheKey = withArgentina(address).toLowerCase();
  if (geocodeCache.has(cacheKey)) return geocodeCache.get(cacheKey);
  const errors = [];
  for (const variant of addressVariants(address)) {
    for (const provider of [nominatimGeocode, photonGeocode]) {
      try {
        const point = await provider(variant);
        geocodeCache.set(cacheKey, point);
        return point;
      } catch (error) { errors.push(error.message); }
    }
  }
  throw new Error(`No se pudo localizar: ${cleanAddress(address)}. ${errors.join(" | ")}`);
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
  const errors = [];
  for (const baseUrl of OSRM_URLS) {
    try { return await osrmRoute(origin, destination, baseUrl); }
    catch (error) { errors.push(error.message); }
  }
  throw new Error(`No se pudo calcular el recorrido. ${errors.join(" | ")}`);
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}

global.fetch = async function patchedFetch(input, init = {}) {
  const url = typeof input === "string" ? input : input?.url;

  // Keep server.js compatible: intercept its old Google geocode URL, but never call Google.
  if (url && url.startsWith("https://maps.googleapis.com/maps/api/geocode/json")) {
    const parsed = new URL(url);
    const address = parsed.searchParams.get("address") || "";
    try {
      const point = await geocodeOSM(address);
      console.log(`[Asistir24 Maps] OSM geocodificó: ${cleanAddress(address)} -> ${point.lat},${point.lng}`);
      return jsonResponse({ status: "OK", results: [{ formatted_address: point.displayName, geometry: { location: { lat: point.lat, lng: point.lng } } }] });
    } catch (error) {
      console.error("[Asistir24 Maps] Error geocodificando:", error.message);
      return jsonResponse({ status: "ZERO_RESULTS", results: [], error_message: error.message });
    }
  }

  // Keep server.js compatible: intercept its old Google Routes URL, but route only through OSRM.
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

console.log("[Asistir24 Maps] Google desactivado; OpenStreetMap/Photon + OSRM activos");
