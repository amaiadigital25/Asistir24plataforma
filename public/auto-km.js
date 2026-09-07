(() => {
  const geocodeCache = new Map();
  let lastGeocodeAt = 0;
  let autoRequestId = 0;
  let submitGuard = false;

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  function normalizeText(value) {
    return String(value || "").trim();
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

  async function geocode(address) {
    const key = normalizeText(address).toLowerCase();
    if (geocodeCache.has(key)) return geocodeCache.get(key);

    const wait = Math.max(0, 1100 - (Date.now() - lastGeocodeAt));
    if (wait) await sleep(wait);
    lastGeocodeAt = Date.now();

    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.searchParams.set("q", address);
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("limit", "1");
    url.searchParams.set("countrycodes", "ar");
    const response = await fetch(url, { headers: { "Accept": "application/json", "Accept-Language": "es-AR,es;q=0.9" } });
    if (!response.ok) throw new Error("No se pudo consultar el mapa");
    const items = await response.json();
    const item = items?.[0];
    if (!item) throw new Error(`No se pudo localizar: ${address}`);

    const point = { lat: Number(item.lat), lon: Number(item.lon), label: item.display_name || address };
    if (!Number.isFinite(point.lat) || !Number.isFinite(point.lon)) throw new Error(`Ubicación inválida: ${address}`);
    geocodeCache.set(key, point);
    return point;
  }

  async function routeKm(from, to) {
    const coords = `${from.lon},${from.lat};${to.lon},${to.lat}`;
    const url = `https://router.project-osrm.org/route/v1/driving/${coords}?overview=false&steps=false`;
    const response = await fetch(url, { headers: { "Accept": "application/json" } });
    if (!response.ok) throw new Error("No se pudo calcular la ruta");
    const data = await response.json();
    const meters = Number(data?.routes?.[0]?.distance);
    if (!Number.isFinite(meters)) throw new Error("No se encontró un recorrido vehicular");
    return Math.round((meters / 1000) * 10) / 10;
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
    const origen = normalizeText($("origen").value);
    const auxilio = isAuxilioMecanico($("tipoServicio").value);
    const destino = auxilio ? "" : normalizeText($("destino").value);

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
    setKmStatus("Calculando kilómetros automáticamente...");

    try {
      const baseCoord = await geocode(baseAddress(base));
      const origenCoord = await geocode(`${origen}, Argentina`);
      if (requestId !== autoRequestId) return false;

      const k1 = await routeKm(baseCoord, origenCoord);
      if (requestId !== autoRequestId) return false;

      const k1Input = $("kmBaseOrigen");
      setAutoValue(k1Input, k1);
      k1Input.dataset.google = "true";
      k1Input.dataset.baseId = base.id;
      k1Input.dataset.origen = origen;

      let k2 = 0;
      let k3 = 0;
      if (!auxilio) {
        const destinoCoord = await geocode(`${destino}, Argentina`);
        if (requestId !== autoRequestId) return false;
        k2 = await routeKm(origenCoord, destinoCoord);
        setAutoValue($("kmOrigenDestino"), k2);

        if (base.modalidad === "INTERIOR") {
          k3 = await routeKm(destinoCoord, baseCoord);
          setAutoValue($("kmDestinoBase"), k3);
        }
      }

      const partes = [`Base → Origen: ${k1.toFixed(1)} km`];
      if (!auxilio) partes.push(`Origen → Destino: ${k2.toFixed(1)} km`);
      if (!auxilio && base.modalidad === "INTERIOR") partes.push(`Destino → Base: ${k3.toFixed(1)} km`);
      setKmStatus(`${partes.join(" · ")} · cálculo automático de ruta.`);
      return true;
    } catch (error) {
      $("kmBaseOrigen").dataset.google = "false";
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
    await calculateAutomaticKm({ silent: true });
    submitGuard = true;
    try {
      $("quoteForm").requestSubmit();
    } finally {
      setTimeout(() => { submitGuard = false; }, 0);
    }
  }, true);
})();
