(() => {
  const geocodeCache = new Map();
  let lastNominatimAt = 0;
  let requestId = 0;

  const OLC_ALPHABET = "23456789CFGHJMPQRVWX";
  const OLC_PAIR_RESOLUTIONS = [20, 1, 0.05, 0.0025, 0.000125];

  // Coordenadas fijas para bases cuyo nombre no es una dirección postal.
  // Evita depender del geocodificador para ubicar la base cada vez.
  const BASE_POINTS = {
    "nahuel-ruso-parque-siguiman": {
      lat: -31.34635,
      lon: -64.482483,
      label: "Villa Parque Siquiman, Córdoba, Argentina"
    }
  };

  const BASE_ALIASES = {
    "eugenio-casanova": "Isidro Casanova, Buenos Aires, Argentina",
    "agustin-varela": "Florencio Varela, Buenos Aires, Argentina",
    "mm-remolques-devoto": "Villa Devoto, Ciudad Autónoma de Buenos Aires, Argentina",
    "javy-burzaco": "Burzaco, Buenos Aires, Argentina",
    "charly-caba": "Ciudad Autónoma de Buenos Aires, Argentina",
    "nahuel-ruso-parque-siguiman": "Villa Parque Siquiman, Punilla, Córdoba, Argentina"
  };

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  function normalizeText(value) {
    return String(value || "")
      .replace(/\u00a0/g, " ")
      .replace(/^[\s>›»•·\-–—:;|]+/, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function canonicalize(value) {
    return normalizeText(value)
      .replace(/parque\s+siguiman/gi, "Villa Parque Siquiman")
      .replace(/parque\s+síquiman/gi, "Villa Parque Siquiman")
      .replace(/lopedevega/gi, "Lope de Vega")
      .replace(/lope\s+de\s+vega/gi, "Lope de Vega")
      .replace(/(?:francisco\s+)?beir[oó]/gi, "Francisco Beiró")
      .replace(/juan\s*b\.?\s*justo/gi, "Juan B. Justo")
      .replace(/gral\.?\s*paz/gi, "General Paz")
      .replace(/generalpaz/gi, "General Paz")
      .replace(/\bbrig\.?\s*gral\.?\s+/gi, "Brigadier General ")
      .replace(/\bavda?\.?\s+/gi, "Avenida ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function validPoint(lat, lon) {
    return Number.isFinite(lat) && Number.isFinite(lon) &&
      lat >= -56 && lat <= -20 && lon >= -74 && lon <= -52;
  }

  function basePoint(base) {
    const fixed = BASE_POINTS[base?.id];
    if (fixed && validPoint(fixed.lat, fixed.lon)) return { ...fixed, provider: "Base registrada" };
    const lat = Number(base?.lat);
    const lon = Number(base?.lon);
    if (validPoint(lat, lon)) return { lat, lon, label: base.base, provider: "Base registrada" };
    return null;
  }

  function baseAddress(base) {
    if (BASE_ALIASES[base.id]) return BASE_ALIASES[base.id];
    const zone = normalizeText(base.zona);
    const generic = new Set(["ZONA OESTE", "ZONA NORTE", "ZONA SUR", "SIN DATO", "PROVINCIA DE BUENOS AIRES"]);
    if (zone && !generic.has(zone)) return `${canonicalize(base.base)}, ${zone}, Argentina`;
    if (base.modalidad === "AMBA_CABA") return `${canonicalize(base.base)}, Buenos Aires, Argentina`;
    return `${canonicalize(base.base)}, Argentina`;
  }

  function addressHasContext(text) {
    return /,/.test(text) || /\b(caba|buenos aires|córdoba|cordoba|santa fe|mendoza|salta|tucum[aá]n|misiones|chaco|entre r[ií]os|la pampa|santa cruz|jujuy|san luis|san juan|neuqu[eé]n|r[ií]o negro|chubut|formosa|catamarca|la rioja|santiago del estero|tierra del fuego)\b/i.test(text);
  }

  function contextualAddress(value, base) {
    const text = canonicalize(value).replace(/,?\s*argentina\s*$/i, "").trim();
    if (!text) return "";
    if (addressHasContext(text)) return `${text}, Argentina`;
    const zone = normalizeText(base?.zona);
    if (zone && !["SIN DATO", "ZONA OESTE", "ZONA NORTE", "ZONA SUR", "PROVINCIA DE BUENOS AIRES"].includes(zone)) {
      return `${text}, ${zone}, Argentina`;
    }
    if (base?.modalidad === "AMBA_CABA") return `${text}, Buenos Aires, Argentina`;
    return `${text}, Argentina`;
  }

  function encodeOlc(lat, lon, length = 10) {
    lat = Math.max(-90, Math.min(90, Number(lat)));
    lon = Number(lon);
    while (lon < -180) lon += 360;
    while (lon >= 180) lon -= 360;
    if (lat === 90) lat -= 1e-12;

    let latVal = lat + 90;
    let lonVal = lon + 180;
    let raw = "";
    const pairCount = Math.min(5, Math.ceil(length / 2));
    for (let i = 0; i < pairCount; i++) {
      const res = OLC_PAIR_RESOLUTIONS[i];
      const latDigit = Math.floor(latVal / res);
      const lonDigit = Math.floor(lonVal / res);
      raw += OLC_ALPHABET[latDigit] + OLC_ALPHABET[lonDigit];
      latVal -= latDigit * res;
      lonVal -= lonDigit * res;
    }
    raw = raw.slice(0, length);
    return raw.slice(0, 8) + "+" + raw.slice(8);
  }

  function decodeOlc(fullCode) {
    const clean = String(fullCode || "").toUpperCase().replace(/\+/g, "").replace(/0/g, "");
    if (clean.length < 2) throw new Error("Plus Code inválido");
    let lat = -90;
    let lon = -180;
    let precision = 20;
    const pairLength = Math.min(clean.length, 10);
    for (let i = 0, pair = 0; i + 1 < pairLength; i += 2, pair++) {
      const latDigit = OLC_ALPHABET.indexOf(clean[i]);
      const lonDigit = OLC_ALPHABET.indexOf(clean[i + 1]);
      if (latDigit < 0 || lonDigit < 0) throw new Error("Plus Code inválido");
      precision = OLC_PAIR_RESOLUTIONS[pair];
      lat += latDigit * precision;
      lon += lonDigit * precision;
    }
    const point = { lat: lat + precision / 2, lon: lon + precision / 2 };
    if (!validPoint(point.lat, point.lon)) throw new Error("Plus Code fuera de Argentina");
    return point;
  }

  function parsePlusCode(value) {
    const text = normalizeText(value).toUpperCase();
    const match = text.match(/^([23456789CFGHJMPQRVWX0]{2,8}\+[23456789CFGHJMPQRVWX]{0,7})\s*(.*)$/i);
    if (!match) return null;
    return { code: match[1].toUpperCase(), locality: normalizeText(match[2]).replace(/^,\s*/, "") };
  }

  function recoverShortPlusCode(code, refLat, refLon) {
    const sep = code.indexOf("+");
    if (sep < 0 || sep >= 8) return decodeOlc(code);
    const missing = 8 - sep;
    const prefix = encodeOlc(refLat, refLon, 10).replace("+", "").slice(0, missing);
    const candidate = decodeOlc(prefix + code);
    const resolution = Math.pow(20, 2 - missing / 2);
    const half = resolution / 2;

    let lat = candidate.lat;
    let lon = candidate.lon;
    if (refLat + half < lat && lat - resolution >= -90) lat -= resolution;
    else if (refLat - half > lat && lat + resolution <= 90) lat += resolution;
    if (refLon + half < lon) lon -= resolution;
    else if (refLon - half > lon) lon += resolution;

    if (!validPoint(lat, lon)) throw new Error("Plus Code fuera de Argentina");
    return { lat, lon };
  }

  async function geocodeNominatim(query) {
    const normalized = normalizeText(query);
    const key = `osm:${normalized.toLowerCase()}`;
    if (geocodeCache.has(key)) return geocodeCache.get(key);

    const wait = Math.max(0, 1100 - (Date.now() - lastNominatimAt));
    if (wait) await sleep(wait);
    lastNominatimAt = Date.now();

    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.searchParams.set("q", normalized);
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("limit", "1");
    url.searchParams.set("countrycodes", "ar");
    url.searchParams.set("addressdetails", "1");

    const response = await fetch(url, { headers: { "Accept": "application/json", "Accept-Language": "es-AR,es;q=0.9" } });
    if (!response.ok) throw new Error(`servicio de ubicación HTTP ${response.status}`);
    const items = await response.json();
    const item = items?.[0];
    if (!item) throw new Error(`No se pudo localizar: ${normalized}`);
    const lat = Number(item.lat);
    const lon = Number(item.lon);
    if (!validPoint(lat, lon)) throw new Error(`Ubicación inválida: ${normalized}`);
    const point = { lat, lon, label: item.display_name || normalized, provider: "OpenStreetMap" };
    geocodeCache.set(key, point);
    return point;
  }

  async function geocodeGeoref(query) {
    const normalized = normalizeText(query).replace(/,?\s*argentina\s*$/i, "");
    if (!normalized) return null;
    const key = `georef:${normalized.toLowerCase()}`;
    if (geocodeCache.has(key)) return geocodeCache.get(key);
    try {
      const url = new URL("https://apis.datos.gob.ar/georef/api/v2.0/direcciones");
      url.searchParams.set("direccion", normalized);
      const response = await fetch(url, { headers: { "Accept": "application/json" } });
      if (!response.ok) return null;
      const data = await response.json();
      const item = data?.direcciones?.[0];
      const lat = Number(item?.ubicacion?.lat);
      const lon = Number(item?.ubicacion?.lon);
      if (!validPoint(lat, lon)) return null;
      const point = { lat, lon, label: item.nomenclatura || normalized, provider: "Georef Argentina" };
      geocodeCache.set(key, point);
      return point;
    } catch {
      return null;
    }
  }

  async function geocodeRegular(value, base) {
    const query = contextualAddress(value, base);
    const georef = await geocodeGeoref(query);
    if (georef) return georef;

    const variants = [query];
    const raw = canonicalize(value);
    if (raw && query !== `${raw}, Argentina`) variants.push(`${raw}, Argentina`);
    let lastError = null;
    for (const variant of [...new Set(variants.filter(Boolean))]) {
      try {
        return await geocodeNominatim(variant);
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error(`No se pudo localizar: ${raw}`);
  }

  async function geocodeFlexible(value, base) {
    const plus = parsePlusCode(value);
    if (!plus) return geocodeRegular(value, base);

    const sep = plus.code.indexOf("+");
    if (sep === 8) {
      const point = decodeOlc(plus.code);
      return { ...point, label: value, provider: "Plus Code" };
    }

    let reference;
    if (plus.locality) {
      reference = await geocodeRegular(plus.locality, base);
    } else {
      reference = basePoint(base) || await geocodeRegular(baseAddress(base), base);
    }
    const point = recoverShortPlusCode(plus.code, reference.lat, reference.lon);
    return { ...point, label: value, provider: "Plus Code" };
  }

  async function geocodeBase(base) {
    const fixed = basePoint(base);
    if (fixed) return fixed;
    return geocodeNominatim(baseAddress(base));
  }

  async function snapToRoad(point, routerBase) {
    try {
      const url = `${routerBase}/nearest/v1/driving/${point.lon},${point.lat}?number=1`;
      const response = await fetch(url, { headers: { "Accept": "application/json" } });
      if (!response.ok) return point;
      const data = await response.json();
      const location = data?.waypoints?.[0]?.location;
      const lon = Number(location?.[0]);
      const lat = Number(location?.[1]);
      return validPoint(lat, lon) ? { ...point, lat, lon } : point;
    } catch {
      return point;
    }
  }

  async function routeWith(router, from, to) {
    const [a, b] = await Promise.all([snapToRoad(from, router), snapToRoad(to, router)]);
    const url = `${router}/route/v1/driving/${a.lon},${a.lat};${b.lon},${b.lat}?overview=false&steps=false&alternatives=false`;
    const response = await fetch(url, { headers: { "Accept": "application/json" } });
    if (!response.ok) throw new Error(`servidor de rutas HTTP ${response.status}`);
    const data = await response.json();
    const meters = Number(data?.routes?.[0]?.distance);
    if (!Number.isFinite(meters)) throw new Error(data?.message || "sin recorrido vehicular");
    return Math.round((meters / 1000) * 10) / 10;
  }

  async function routeKm(from, to) {
    const routers = ["https://router.project-osrm.org", "https://routing.openstreetmap.de/routed-car"];
    let lastError;
    for (const router of routers) {
      try {
        return await routeWith(router, from, to);
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error("No se pudo calcular la ruta vehicular");
  }

  function setAuto(input, value) {
    input.value = Number(value).toFixed(1);
    input.dataset.auto = "true";
  }

  function clearAuto(input) {
    if (!input) return;
    if (input.dataset.auto === "true") input.value = "";
    input.dataset.auto = "false";
  }

  async function calculateAutomaticKm({ silent = false } = {}) {
    const base = selectedBase();
    const modalidad = currentModalidad();
    const auxilio = isAuxilioMecanico($("tipoServicio").value);
    const origen = normalizeText($("origen").value);
    const destino = auxilio ? "" : normalizeText($("destino").value);

    if (!base || !origen) {
      if (!silent) setKmStatus("Seleccione una base e ingrese el origen.", true);
      return false;
    }
    if (!auxilio && !destino) {
      if (!silent) setKmStatus("Ingrese el destino para calcular el recorrido completo.", true);
      return false;
    }

    const myRequest = ++requestId;
    const button = $("calcKmButton");
    if (button) button.disabled = true;
    setKmStatus("Ubicando base, origen y destino... calculando ruta real.");

    try {
      const baseCoord = await geocodeBase(base);
      const origenCoord = await geocodeFlexible(origen, base);
      if (myRequest !== requestId) return false;

      const k1 = await routeKm(baseCoord, origenCoord);
      if (myRequest !== requestId) return false;
      setAuto($("kmBaseOrigen"), k1);
      $("kmBaseOrigen").dataset.baseId = base.id;
      $("kmBaseOrigen").dataset.origen = origen;

      let k2 = 0;
      let k3 = 0;
      let destinoCoord = null;

      if (auxilio) {
        clearAuto($("kmOrigenDestino"));
        clearAuto($("kmDestinoBase"));
      } else {
        destinoCoord = await geocodeFlexible(destino, base);
        if (myRequest !== requestId) return false;
        k2 = await routeKm(origenCoord, destinoCoord);
        setAuto($("kmOrigenDestino"), k2);

        if (modalidad === "INTERIOR") {
          k3 = await routeKm(destinoCoord, baseCoord);
          setAuto($("kmDestinoBase"), k3);
        } else {
          clearAuto($("kmDestinoBase"));
        }
      }

      const parts = [`Base → Origen ${k1.toFixed(1)} km`];
      if (!auxilio) parts.push(`Origen → Destino ${k2.toFixed(1)} km`);
      if (!auxilio && modalidad === "INTERIOR") parts.push(`Destino → Base ${k3.toFixed(1)} km`);
      const provider = [origenCoord.provider, destinoCoord?.provider].filter(Boolean).join(" / ");
      setKmStatus(`${parts.join(" · ")} · cálculo automático correcto${provider ? ` (${provider})` : ""}.`);
      return true;
    } catch (error) {
      clearAuto($("kmBaseOrigen"));
      clearAuto($("kmOrigenDestino"));
      clearAuto($("kmDestinoBase"));
      setKmStatus(`No se pudo calcular automáticamente: ${error.message}. Revise que la ubicación incluya localidad/provincia o use un Plus Code.`, true);
      return false;
    } finally {
      if (myRequest === requestId && button) button.disabled = false;
    }
  }

  // Reemplaza el cálculo anterior usado por app.js.
  calculateBaseOriginKm = calculateAutomaticKm;

  if ($("calcKmButton")) $("calcKmButton").textContent = "Calcular kilómetros automáticamente";

  $("destino").addEventListener("input", () => {
    clearAuto($("kmOrigenDestino"));
    clearAuto($("kmDestinoBase"));
  });
  $("destino").addEventListener("blur", () => {
    if ($("destino").value.trim() && $("origen").value.trim()) calculateAutomaticKm({ silent: true });
  });
  $("tipoServicio").addEventListener("change", () => {
    if ($("origen").value.trim() && (isAuxilioMecanico($("tipoServicio").value) || $("destino").value.trim())) {
      calculateAutomaticKm({ silent: true });
    }
  });
})();
