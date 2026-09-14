(() => {
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
    if (!base || !origen) {
      if (!silent) setKmStatus("Seleccione una base e ingrese el origen.", true);
      return false;
    }
    if (!auxilio && !destino) {
      if (!silent) setKmStatus("Ingrese el destino para calcular el recorrido completo.", true);
      return false;
    }
    const button = $("calcKmButton");
    if (button) button.disabled = true;
    setKmStatus("Ubicando puntos y calculando la ruta desde el servidor...");
    try {
      const data = await api("/api/ruta-completa", {
        method: "POST",
        headers: {"Content-Type":"application/json"},
        body: JSON.stringify({
          baseId: base.id,
          modalidad: currentModalidad(),
          tipoServicio: $("tipoServicio").value,
          origen,
          destino
        })
      });
      const t = data.tramos || {};
      setAuto($("kmBaseOrigen"), t.baseOrigen, { baseId: base.id, origen });
      if (auxilio) {
        clearAuto($("kmOrigenDestino"));
        clearAuto($("kmDestinoBase"));
      } else {
        setAuto($("kmOrigenDestino"), t.origenDestino);
        if (currentModalidad() === "INTERIOR") setAuto($("kmDestinoBase"), t.destinoBase);
        else clearAuto($("kmDestinoBase"));
      }
      const parts = [`Base → Origen ${Number(t.baseOrigen || 0).toFixed(1)} km`];
      if (!auxilio) parts.push(`Origen → Destino ${Number(t.origenDestino || 0).toFixed(1)} km`);
      if (!auxilio && currentModalidad() === "INTERIOR") parts.push(`Destino → Base ${Number(t.destinoBase || 0).toFixed(1)} km`);
      setKmStatus(parts.join(" · ") + " · cálculo automático correcto.");
      return true;
    } catch (error) {
      clearAuto($("kmBaseOrigen"));
      clearAuto($("kmOrigenDestino"));
      clearAuto($("kmDestinoBase"));
      setKmStatus(`No se pudo localizar automáticamente: ${error.message}. Podés ingresar coordenadas como -34.60,-58.38 o cargar los kilómetros manualmente para continuar.`, true);
      return false;
    } finally {
      if (button) button.disabled = false;
    }
  }
  calculateBaseOriginKm = calculateServerKm;
  $("destino").addEventListener("input", () => { clearAuto($("kmOrigenDestino")); clearAuto($("kmDestinoBase")); });
  $("destino").addEventListener("blur", () => {
    if ($("origen").value.trim() && ($("destino").value.trim() || isAuxilioMecanico($("tipoServicio").value))) calculateServerKm({silent:true});
  });
  $("tipoServicio").addEventListener("change", () => {
    if ($("origen").value.trim() && (isAuxilioMecanico($("tipoServicio").value) || $("destino").value.trim())) calculateServerKm({silent:true});
  });
})();