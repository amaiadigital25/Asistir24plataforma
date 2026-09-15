(() => {
  const $ = id => document.getElementById(id);

  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"})[c]);
  }

  function fecha(iso) {
    try { return new Intl.DateTimeFormat("es-AR", {dateStyle:"short", timeStyle:"short"}).format(new Date(iso)); }
    catch { return "-"; }
  }

  function estado(q) {
    const e = q?.flujo?.estado || "MAIL_RECIBIDO";
    const labels = {
      MAIL_RECIBIDO:"Nuevo", PROCESANDO:"Procesando", COTIZACION_LISTA:"Cotización lista",
      REMITO_LISTO:"Remito listo", ESPERANDO_CONFIRMACION:"Esperando confirmación",
      CONFIRMADO:"Confirmado", LISTO_PARA_WHATSAPP:"Listo para WhatsApp",
      ENVIADO_WHATSAPP:"Enviado por WhatsApp", EN_SERVICIO:"En servicio", FINALIZADO:"Finalizado"
    };
    return labels[e] || e;
  }

  function setSelect(id, value) {
    const el = $(id);
    if (!el || value == null) return;
    const wanted = String(value).toLowerCase();
    const option = [...el.options].find(o => String(o.value).toLowerCase() === wanted || String(o.textContent).toLowerCase() === wanted);
    if (option) el.value = option.value;
  }

  function cargar(q) {
    if ($("empresa")) $("empresa").value = q.empresa || "";
    if ($("numeroServicio")) $("numeroServicio").value = q.numeroServicio || "";
    if ($("patente")) $("patente").value = q.patente || "";
    if ($("origen")) $("origen").value = q.origen || "";
    if ($("destino")) $("destino").value = q.destino || "";
    setSelect("tipoServicio", q.tipoServicio);
    if (q.base?.id) setSelect("baseId", q.base.id);
    if (q.base?.modalidad) setSelect("modalidad", q.base.modalidad);
    if ($("kmBaseOrigen") && q.tramos?.baseOrigen != null) $("kmBaseOrigen").value = q.tramos.baseOrigen;
    if ($("kmOrigenDestino") && q.tramos?.origenDestino != null) $("kmOrigenDestino").value = q.tramos.origenDestino;
    if ($("kmDestinoBase") && q.tramos?.destinoBase != null) $("kmDestinoBase").value = q.tramos.destinoBase;
    $("quoteForm")?.scrollIntoView({behavior:"smooth", block:"start"});
    $("origen")?.dispatchEvent(new Event("input", {bubbles:true}));
  }

  async function cargarEntrantes() {
    const body = $("incomingRows");
    const count = $("incomingCount");
    if (!body || typeof api !== "function") return;
    try {
      const data = await api("/api/cotizaciones");
      const items = (data.items || []).filter(q => q.gmail?.messageId).slice(0, 50);
      if (count) count.textContent = `${items.length} servicios`;
      body.innerHTML = items.map((q, i) => `
        <tr>
          <td>${esc(fecha(q.gmail?.receivedAt || q.fecha))}</td>
          <td><strong>${esc(q.numeroServicio || "-")}</strong><br><small>${esc(estado(q))}</small></td>
          <td>${esc(q.empresa || "-")}</td>
          <td>${esc(q.patente || "-")}</td>
          <td>${esc(q.tipoServicio || q.datosMail?.vehiculo || "-")}</td>
          <td>${esc(q.origen || "-")}</td>
          <td>${esc(q.destino || "-")}</td>
          <td>${esc(q.datosMail?.observaciones || "-")}</td>
          <td><button class="btn primary small incoming-open" data-index="${i}" type="button">Abrir / Cotizar</button></td>
        </tr>`).join("") || `<tr><td colspan="9" class="muted">Todavía no ingresaron servicios desde el mail.</td></tr>`;
      body.querySelectorAll(".incoming-open").forEach(btn => btn.addEventListener("click", () => cargar(items[Number(btn.dataset.index)])));
    } catch (e) {
      body.innerHTML = `<tr><td colspan="9" class="error">No se pudieron cargar los servicios entrantes: ${esc(e.message)}</td></tr>`;
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    cargarEntrantes();
    $("refreshIncoming")?.addEventListener("click", cargarEntrantes);
    setInterval(cargarEntrantes, 60000);
  });
})();