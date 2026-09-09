(() => {
  const geocodeCache = new Map();
  let lastNominatimAt = 0;
  let autoRequestId = 0;
  let submitGuard = false;

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  function normalizeText(value) {
    return String(value || "")
      .replace(/\u00a0/g, " ")
      .replace(/^[\s>›»•·\-–—:;|]+/, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function validArgentinaPoint(lat, lon) {
    return Number.isFinite(lat) && Number.isFinite(lon) &&
      lat >= -56 && lat <= -20 && lon >= -74 && lon <= -52;
  }

  function canonicalizeCommonStreetNames(value) {
    let text = normalizeText(value);
    if (!text) return "";

    text = text
      .replace(/lopedevega/gi, "Lope de Vega")
      .replace(/lope\s+de\s+vega/gi, "Lope de Vega")
      .replace(/(?:francisco\s+)?beir[oó]/gi, "Francisco Beiró")
      .replace(/juan\s*b\.?\s*justo/gi, "Juan B. Justo")
      .replace(/gral\.?\s*paz/gi, "General Paz")
      .replace(/generalpaz/gi, "General Paz")
      .replace(/\bbrig\.?\s*gral\.?\s+/gi, "Brigadier General ")
      .replace(/\bav\.?\s+/gi, "Avenida ")
      .replace(/\bavda\.?\s+/gi, "Avenida ")
      .replace(/\s+/g, " ")
      .trim();

    return text;
  }

  function normalizeAddress(value) {
    const text = canonicalizeCommonStreetNames(value).replace(/[;,\s]+$/, "");
    if (!text) return "";
    return /\bargentina\b/i.test(text) ? text : `${text}, Argentina`;
  }

  function georefText(value) {
    let text = canonicalizeCommonStreetNames(value)
      .replace(/\s+(?:esq(?:uina)?\.?|y|e|&)\s+/gi, " esquina ")
      .replace(/,?\s*argentina\s*$/i, "")
      .trim();

    if (/Lope de Vega/i.test(text) && /Francisco Beir[oó]/i.test(text) && !/,/.test(text)) {
      text += ", Ciudad Autónoma de Buenos Aires";
    }
    return text;
  }

  function nominatimVariants(address) {
    const primary = normalizeAddress(address);
    const canonical = canonicalizeCommonStreetNames(address);
    const withoutCountry = canonical.replace(/,?\s*argentina\s*$/i, "").trim();
    const intersectionAmp = withoutCountry.replace(/\s+(?:esq(?:uina)?\.?|y|e)\s+/gi, " & ");
    const intersectionY = withoutCountry.replace(/\s+(?:esq(?:uina)?\.?|&)\s+/gi, " y ");

    const variants = [
      primary,
      canonical ? `${canonical.replace(/,?\s*argentina\s*$/i, "")}, Argentina` : "",
      intersectionAmp !== withoutCountry ? `${intersectionAmp}, Argentina` : "",
      intersectionY !== withoutCountry ? `${intersectionY}, Argentina` : ""
    ];

    if (/Lope de Vega/i.test(withoutCountry) && /Francisco Beir[oó]/i.test(withoutCountry)) {
      variants.unshift("Avenida Lope de Vega 3091, Ciudad Autónoma de Buenos Aires, Argentina");
      variants.push("Avenida Lope de Vega & Avenida Francisco Beiró, Ciudad Autónoma de Buenos Aires, Argentina");
    }

    return [...new Set(variants.map(normalizeText).filter(Boolean))];
  }

  function baseAddress(base) {
    const aliases = {
      "eugenio-casanova": "Isidro Casanova, Buenos Aires, Argentina",
      "agustin-varela": "Florencio Varela, Buenos Aires, Argentina",
      "mm-remolques-devoto": "Villa Devoto, Ciudad Autónoma de Buenos Aires, Argentina",
      "javy-burzaco": "Burzaco, Buenos Aires, Argentina",
      "charly-caba": "Ciudad Autónoma de Buenos Aires, Argentina"
    };
    if (aliases[base.id]) return aliases[base.id];

    const zone = normalizeText(base.zona);
    const genericZones = new Set(["ZONA OESTE", "ZONA NORTE", "ZONA SUR", "SIN DATO", "PROVINCIA DE BUENOS AIRES"]);
    if (zone && !genericZones.has(zone)) return `${base.base}, ${zone}, Argentina`;
    if (base.modalidad === "AMBA_CABA") return `${base.base}, Buenos Aires, Argentina`;
    return `${base.base}, Argentina`;
  }

  async function geocodeGeoref(address) {
    const query = georefText(address);
    if (!query) return null;

    const key = `georef:${query.toLowerCase()}`;
    if (geocodeCache.has(key)) {
      const cached = geocodeCache.get(key);
      if (validArgentinaPoint(cached?.lat, cached?.lon)) return cached;
      geocodeCache.delete(key);
    }

    try {
      const url = new URL("https://apis.datos.gob.ar/georef/api/v2.0/direcciones");
      url.searchParams.set("direccion", query);
      const response = await fetch(url, { headers: { "Accept": "application/json" } });
      if (!response.ok) return null;
      const data = await response.json();
      const item = data?.direcciones?.[0];
      const rawLat = item?.ubicacion?.lat;
      const rawLon = item?.ubicacion?.lon;
      if (rawLat === null || rawLat === undefined || rawLon === null || rawLon === undefined) return null;

      const lat = Number(rawLat);
      const lon = Number(rawLon);
      if (!validArgentinaPoint(lat, lon)) return null;

      const point = { lat, lon, label: item.nomenclatura || query, provider: "Georef" };
      geocodeCache.set(key, point);
      return point;
    } catch {
      return null;
    }
  }

  async function geocodeNominatim(address) {
    const variants = nominatimVariants(address);
    const cacheKey = variants[0]?.toLowerCase();
    if (cacheKey && geocodeCache.has(`osm:${cacheKey}`)) {
      const cached = geocodeCache.get(`osm:${cacheKey}`);
      if (validArgentinaPoint(cached?.lat, cached?.lon)) return cached;
      geocodeCache.delete(`osm:${cacheKey}`);
    }

    let lastQuery = variants[0] || normalizeText(address);
    for (const query of variants) {
      lastQuery = query;
      const key = `osm:${query.toLowerCase()}`;
      if (geocodeCache.has(key)) {
        const cached = geocodeCache.get(key);
        if (validArgentinaPoint(cached?.lat, cached?.lon)) return cached;
        geocodeCache.delete(key);
      }

      const wait = Math.max(0, 1100 - (Date.now() - lastNominatimAt));
      if (wait) await sleep(wait);
      lastNominatimAt = Date.now();

      const url = new URL("https://nominatim.openstreetmap.org/search");
      url.searchParams.set("q", query);
      url.searchParams.set("format", "jsonv2");
      url.searchParams.set("limit", "1");
      url.searchParams.set("countrycodes", "ar");
      const response = await fetch(url, { headers: { "Accept": "application/json", "Accept-Language": "es-AR,es;q=0.9" } });
      if (!response.ok) continue;
      const items = await response.json();
      const item = items?.[0];
      if (!item) continue;

      const lat = Number(item.lat);
      const lon = Number(item.lon);
      if (!validArgentinaPoint(lat, lon)) continue;

      const point = { lat, lon, label: item.display_name || query, provider: "OpenStreetMap" };
      geocodeCache.set(key, point);
      if (cacheKey) geocodeCache.set(`osm:${cacheKey}`, point);
      return point;
    }

    throw new Error(`No se pudo localizar: ${canonicalizeCommonStreetNames(lastQuery)}`);
  }

  async function geocodeFlexible(address) {
    const georef = await geocodeGeoref(address);
    if (georef && validArgentinaPoint(georef.lat, georef.lon)) return georef;
    return geocodeNominatim(address);
  }

  async function snapToRoad(point, routerBase) {
    if (!validArgentinaPoint(point?.lat, point?.lon)) throw new Error("coordenadas inválidas");

    const url = `${routerBase}/nearest/v1/driving/${point.lon},${point.lat}?number=1`;
    const response = await fetch(url, { headers: { "Accept": "application/json" } });
    if (!response.ok) return point;
    const data = await response.json();
    const location = data?.waypoints?.[0]?.location;
    if (!Array.isArray(location) || location.length < 2) return point;
    const lon = Number(location[0]);
    const lat = Number(location[1]);
    if (!validArgentinaPoint(lat, lon)) return point;
    return { ...point, lat, lon };
  }

  async function routeKmWithRouter(from, to, routerBase) {
    if (!validArgentinaPoint(from?.lat, from?.lon) || !validArgentinaPoint(to?.lat, to?.lon)) {
      throw new Error("una de las ubicaciones no tiene coordenadas válidas en Argentina");
    }

    const [fromRoad, toRoad] = await Promise.all([
      snapToRoad(from, routerBase),
      snapToRoad(to, routerBase)
    ]);

    const coords = `${fromRoad.lon},${fromRoad.lat};${toRoad.lon},${toRoad.lat}`;
    const url = `${routerBase}/route/v1/driving/${coords}?overview=false&steps=false&alternatives=false`;
    const response = await fetch(url, { headers: { "Accept": "application/json" } });
    if (!response.ok) throw new Error(`servidor de rutas HTTP ${response.status}`);
    const data = await response.json();
    const meters = Number(data?.routes?.[0]?.distance);
    if (!Number.isFinite(meters)) throw new Error(data?.message || "sin recorrido vehicular");
    return Math.round((meters / 1000) * 10) / 10;
  }

  async function routeKm(from, to) {
    const routers = [
      "https://router.project-osrm.org",
      "https://routing.openstreetmap.de/routed-car"
    ];
    let lastError = null;

    for (const router of routers) {
      try {
        return await routeKmWithRouter(from, to, router);
      } catch (error) {
        lastError = error;
      }
    }

    throw new Error(lastError?.message || "No se pudo calcular la ruta vehicular");
  }

  async function routeSegment(label, from, to) {
    try {
      return await routeKm(from, to);
    } catch (error) {
      throw new Error(`${label}: ${error.message}`);
    }
  }

  function setAutoValue(input, value) {
    input.value = Number(value).toFixed(1);
    input.dataset.auto = "true";
  }

  function clearAutoValue(input) {
    if (input?.dataset.auto === "true") input.value = "";
    if (input) input.dataset.auto = "false";
  }

  async function calculateAutomaticKm({ silent = false } = {}) {
    const base = selectedBase();
    const modalidad = typeof currentModalidad === "function" ? currentModalidad() : base?.modalidad;
    const origen = normalizeText($("origen").value);
    const auxilio = isAuxilioMecanico($("tipoServicio").value);
    const destino = auxilio ? "" : normalizeText($("destino").value);

    if (origen) $("origen").value = origen;
    if (destino) $("destino").value = destino;

    if (!base || !origen) {
      if (!silent) setKmStatus("Ingrese la base y el origen para calcular los kilómetros.");
      return false;
    }
    if (!auxilio && !destino) {
      if (!silent) setKmStatus("Ingrese origen y destino para calcular todos los tramos.");
      return false;
    }

    const requestId = ++autoRequestId;
    const button = $("calcKmButton");
    if (button) button.disabled = true;
    setKmStatus("Buscando las ubicaciones y calculando la ruta...");

    try {
      const baseCoord = await geocodeNominatim(baseAddress(base));
      const origenCoord = await geocodeFlexible(origen);
      if (requestId !== autoRequestId) return false;

      const k1 = await routeSegment("Base → Origen", baseCoord, origenCoord);
      if (requestId !== autoRequestId) return false;

      const k1Input = $("kmBaseOrigen");
      setAutoValue(k1Input, k1);
      k1Input.dataset.baseId = base.id;
      k1Input.dataset.origen = origen;

      let k2 = 0;
      let k3 = 0;
      if (!auxilio) {
        const destinoCoord = await geocodeFlexible(destino);
        if (requestId !== autoRequestId) return false;
        k2 = await routeSegment("Origen → Destino", origenCoord, destinoCoord);
        setAutoValue($("kmOrigenDestino"), k2);

        if (modalidad === "INTERIOR") {
          k3 = await routeSegment("Destino → Base", destinoCoord, baseCoord);
          setAutoValue($("kmDestinoBase"), k3);
        }
      }

      const partes = [`Base → Origen: ${k1.toFixed(1)} km`];
      if (!auxilio) partes.push(`Origen → Destino: ${k2.toFixed(1)} km`);
      if (!auxilio && modalidad === "INTERIOR") partes.push(`Destino → Base: ${k3.toFixed(1)} km`);
      const proveedor = origenCoord.provider ? ` · ubicación: ${origenCoord.provider}` : "";
      setKmStatus(`${partes.join(" · ")} · cálculo automático de ruta${proveedor}.`);
      return true;
    } catch (error) {
      setKmStatus(`No se pudo calcular automáticamente: ${error.message}. Puede cargar los km manualmente.`, true);
      return false;
    } finally {
      if (requestId === autoRequestId && button) button.disabled = false;
    }
  }

  calculateBaseOriginKm = calculateAutomaticKm;

  const calcButton = $("calcKmButton");
  if (calcButton) calcButton.textContent = "Calcular kilómetros automáticamente";
  $("kmBaseOrigen").placeholder = "Se calcula automáticamente";
  $("kmOrigenDestino").placeholder = "Se calcula automáticamente";
  $("kmDestinoBase").placeholder = "Se calcula automáticamente";

  $("origen").addEventListener("input", () => {
    clearAutoValue($("kmOrigenDestino"));
    clearAutoValue($("kmDestinoBase"));
  });
  $("destino").addEventListener("input", () => {
    clearAutoValue($("kmOrigenDestino"));
    clearAutoValue($("kmDestinoBase"));
  });
  $("destino").addEventListener("blur", () => calculateAutomaticKm({ silent: true }));
  $("tipoServicio").addEventListener("change", () => {
    if ($("origen").value.trim()) calculateAutomaticKm({ silent: true });
  });

  $("quoteForm").addEventListener("submit", async event => {
    if (submitGuard) return;
    event.preventDefault();
    event.stopImmediatePropagation();

    const ok = await calculateAutomaticKm({ silent: true });
    if (!ok && !$("kmBaseOrigen").value) {
      $("kmBaseOrigen").focus();
      return;
    }

    submitGuard = true;
    try {
      $("quoteForm").requestSubmit();
    } finally {
      setTimeout(() => { submitGuard = false; }, 0);
    }
  }, true);
})();