(() => {
  let lastRouteMapUrl = "";
  function routeMapButton(url = "") {
    const button = $("openRouteMap");
    lastRouteMapUrl = url;
    if (!button) return;
    button.disabled = !url;
    button.classList.toggle("hidden", !url);
  }
  function coordText(point) { return point && Number.isFinite(Number(point.lat)) && Number.isFinite(Number(point.lng)) ? `${Number(point.lat)},${Number(point.lng)}` : ""; }
  function buildRouteMap(data, auxilio) {
    const c = data?.coordenadas || {};
    const base = coordText(c.base), origen = coordText(c.origen), destino = coordText(c.destino);
    if (!base || !origen) return "";
    const url = new URL("https://www.google.com/maps/dir/");
    url.searchParams.set("api", "1");
    url.searchParams.set("origin", base);
    url.searchParams.set("destination", auxilio ? origen : (currentModalidad() === "INTERIOR" ? base : destino));
    if (!auxilio && destino) url.searchParams.set("waypoints", currentModalidad() === "INTERIOR" ? `${origen}|${destino}` : origen);
    url.searchParams.set("travelmode", "driving");
    return url.toString();
  }
  function setAuto(input, value, extra = {}) {
    if (!input) return;
    input.value = Number(value || 0).toFixed(1);
    input.dataset.auto = "true";
    Object.entries(extra).forEach(([k,v]) => input.dataset[k] = String(v));
  }
  function clearAuto(input) {
    if (!input) return;
    if (input.dataset.auto === "true") input.value = "";
    input.dataset.auto = "false";
    delete input.dataset.baseId;
    delete input.dataset.origen;
  }
  async function calculateServerKm({ silent = false } = {}) {
    const base = selectedBase();
    const origen = $("origen").value.trim();
    const auxilio = isAuxilioMecanico($("tipoServicio").value);
    const destino = auxilio ? "" : $("destino").value.trim();
    routeMapButton();
    if (!base || !origen) { if (!silent) setKmStatus("Seleccione una base e ingrese el origen.", true); return false; }
    if (!auxilio && !destino) { if (!silent) setKmStatus("Ingrese el destino para calcular el recorrido completo.", true); return false; }
    const button = $("calcKmButton");
    if (button) button.disabled = true;
    setKmStatus("Ubicando puntos y calculando la ruta desde el servidor...");
    try {
      const data = await api("/api/ruta-completa", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ baseId:base.id, modalidad:currentModalidad(), tipoServicio:$("tipoServicio").value, origen, destino }) });
      const t = data.tramos || {};
      setAuto($("kmBaseOrigen"), t.baseOrigen, { baseId:base.id, origen });
      if (auxilio) { clearAuto($("kmOrigenDestino")); clearAuto($("kmDestinoBase")); }
      else { setAuto($("kmOrigenDestino"), t.origenDestino); if(currentModalidad()==="INTERIOR") setAuto($("kmDestinoBase"), t.destinoBase); else clearAuto($("kmDestinoBase")); }
      const parts=[`Base → Origen ${Number(t.baseOrigen||0).toFixed(1)} km`];
      if(!auxilio) parts.push(`Origen → Destino ${Number(t.origenDestino||0).toFixed(1)} km`);
      if(!auxilio&&currentModalidad()==="INTERIOR") parts.push(`Destino → Base ${Number(t.destinoBase||0).toFixed(1)} km`);
      routeMapButton(buildRouteMap(data, auxilio));
      setKmStatus(parts.join(" · ") + " · ruta calculada. Podés abrirla en el mapa.");
      return true;
    } catch(error) {
      clearAuto($("kmBaseOrigen")); clearAuto($("kmOrigenDestino")); clearAuto($("kmDestinoBase")); routeMapButton();
      setKmStatus(`No se pudo localizar automáticamente: ${error.message}. Podés ingresar coordenadas como -34.60,-58.38 o cargar los kilómetros manualmente para continuar.`, true); return false;
    } finally { if(button) button.disabled=false; }
  }
  calculateBaseOriginKm=calculateServerKm;
  const mapButton=$("openRouteMap"); if(mapButton) mapButton.addEventListener("click",()=>{ if(lastRouteMapUrl) window.open(lastRouteMapUrl,"_blank","noopener,noreferrer"); });
  $("destino").addEventListener("input",()=>{clearAuto($("kmOrigenDestino"));clearAuto($("kmDestinoBase"));routeMapButton();});
  $("destino").addEventListener("blur",()=>{if($("origen").value.trim()&&($("destino").value.trim()||isAuxilioMecanico($("tipoServicio").value)))calculateServerKm({silent:true});});
  $("tipoServicio").addEventListener("change",()=>{routeMapButton();if($("origen").value.trim()&&(isAuxilioMecanico($("tipoServicio").value)||$("destino").value.trim()))calculateServerKm({silent:true});});
})();