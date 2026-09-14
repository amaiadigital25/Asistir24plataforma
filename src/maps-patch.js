// Asistir24 maps fallback: Google Maps first, OpenStreetMap/OSRM only on failure.
const nativeFetch = global.fetch;

if (typeof nativeFetch !== "function") {
  throw new Error("Asistir24 maps fallback requiere Node.js con fetch global");
}

const USER_AGENT = process.env.OSM_USER_AGENT || "Asistir24/1.0 (operaciones@asistir24.com.ar)";
const REQUEST_TIMEOUT_MS = Math.max(3000, Number(process.env.MAPS_TIMEOUT_MS || 10000));
let lastNominatimAt = 0;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await nativeFetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
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

async function nominatimGeocode(address) {
  const wait = Math.max(0, 1100 - (Date.now() - lastNominatimAt));
  if (wait) await sleep(wait);
  lastNominatimAt = Date.now();

  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", withArgentina(address));
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "5");
  url.searchParams.set("countrycodes", "ar");
  url.searchParams.set("addressdetails", "1");

  const response = await fetchWithTimeout(url, {
    headers: { "User-Agent": USER_AGENT, "Accept-Language": "es-AR,es;q=0.9" }
  });
  if (!response.ok) throw new Error(`Nominatim HTTP ${response.status}`);
  const data = await response.json();
  const best = Array.isArray(data) ? data.find(item => Number.isFinite(Number(item.lat)) && Number.isFinite(Number(item.lon))) : null;
  if (!best) throw new Error("Nominatim no encontró la dirección");
  return { lat: Number(best.lat), lng: Number(best.lon), displayName: best.display_name || "" };
}

async function photonGeocode(address) {
  const url = new URL("https://photon.komoot.io/api/");
  url.searchParams.set("q", withArgentina(address));
  url.searchParams.set("limit", "5");
  url.searchParams.set("lang", "es");

  const response = await fetchWithTimeout(url, { headers: { "User-Agent": USER_AGENT } });
  if (!response.ok) throw new Error(`Photon HTTP ${response.status}`);
  const data = await response.json();
  const features = Array.isArray(data?.features) ? data.features : [];
  const arg = features.find(f => String(f?.properties?.country || "").toLowerCase().includes("argentina")) || features[0];
  const coords = arg?.geometry?.coordinates;
  if (!Array.isArray(coords) || coords.length < 2) throw new Error("Photon no encontró la dirección");
  const lng = Number(coords[0]);
  const lat = Number(coords[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new Error("Photon devolvió coordenadas inválidas");
  return { lat, lng, displayName: arg?.properties?.name || "" };
}

async function geocodeOSM(address) {
  const errors = [];
  for (const provider of [nominatimGeocode, photonGeocode]) {
    try {
      return await provider(address);
    } catch (error) {
      errors.push(error.message);
    }
  }
  throw new Error(`No se pudo localizar: ${address}. ${errors.join(" | ")}`);
}

async function osrmRoute(origin, destination, baseUrl) {
  const coords = `${origin.lng},${origin.lat};${destination.lng},${destination.lat}`;
  const url = `${baseUrl}/route/v1/driving/${coords}?overview=false&steps=false&alternatives=false`;
  const response = await fetchWithTimeout(url, { headers: { "User-Agent": USER_AGENT } });
  if (!response.ok) throw new Error(`OSRM HTTP ${response.status}`);
  const data = await response.json();
  const meters = Number(data?.routes?.[0]?.distance);
  if (!Number.isFinite(meters) || meters <= 0) throw new Error("OSRM no devolvió una distancia válida");
  return meters;
}

async function routeOSM(origin, destination) {
  const providers = [
    "https://router.project-osrm.org",
    "https://routing.openstreetmap.de/routed-car"
  ];
  const errors = [];
  for (const baseUrl of providers) {
    try {
      return await osrmRoute(origin, destination, baseUrl);
    } catch (error) {
      errors.push(error.message);
    }
  }
  throw new Error(`No se pudo calcular el recorrido. ${errors.join(" | ")}`);
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" }
  });
}

global.fetch = async function patchedFetch(input, init = {}) {
  const url = typeof input === "string" ? input : input?.url;

  if (url && url.startsWith("https://maps.googleapis.com/maps/api/geocode/json")) {
    try {
      const googleResponse = await nativeFetch(input, init);
      const googleData = await googleResponse.clone().json();
      if (googleResponse.ok && googleData?.status === "OK" && googleData?.results?.[0]) {
        console.log("[Asistir24 Maps] Google geocoding OK");
        return googleResponse;
      }
      console.warn(`[Asistir24 Maps] Google geocoding no disponible: ${googleData?.status || googleResponse.status}`);
    } catch (error) {
      console.warn("[Asistir24 Maps] Google geocoding falló:", error.message);
    }

    const parsed = new URL(url);
    const address = parsed.searchParams.get("address") || "";
    try {
      const point = await geocodeOSM(address);
      console.log(`[Asistir24 Maps] OSM geocodificó: ${cleanAddress(address)} -> ${point.lat},${point.lng}`);
      return jsonResponse({
        status: "OK",
        results: [{ formatted_address: point.displayName, geometry: { location: { lat: point.lat, lng: point.lng } } }]
      });
    } catch (error) {
      console.error("[Asistir24 Maps] Error geocodificando:", error.message);
      return jsonResponse({ status: "ZERO_RESULTS", results: [], error_message: error.message });
    }
  }

  if (url === "https://routes.googleapis.com/directions/v2:computeRoutes") {
    try {
      const googleResponse = await nativeFetch(input, init);
      const googleData = await googleResponse.clone().json();
      const meters = Number(googleData?.routes?.[0]?.distanceMeters);
      if (googleResponse.ok && Number.isFinite(meters) && meters > 0) {
        console.log("[Asistir24 Maps] Google Routes OK");
        return googleResponse;
      }
      console.warn(`[Asistir24 Maps] Google Routes no disponible: ${googleData?.error?.message || googleResponse.status}`);
    } catch (error) {
      console.warn("[Asistir24 Maps] Google Routes falló:", error.message);
    }

    try {
      const body = typeof init.body === "string" ? JSON.parse(init.body) : (init.body || {});
      const o = body?.origin?.location?.latLng;
      const d = body?.destination?.location?.latLng;
      const origin = { lat: Number(o?.latitude), lng: Number(o?.longitude) };
      const destination = { lat: Number(d?.latitude), lng: Number(d?.longitude) };
      if (![origin.lat, origin.lng, destination.lat, destination.lng].every(Number.isFinite)) {
        throw new Error("Coordenadas inválidas para el recorrido");
      }
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

console.log("[Asistir24 Maps] Google primero; OpenStreetMap/OSRM fallback activo");
