(() => {
  const $ = id => document.getElementById(id);
  const SEEN_KEY = "a24_incoming_seen_ids";
  let initialized = false;

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

  function seenIds() {
    try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || "[]")); }
    catch { return new Set(); }
  }

  function saveSeen(ids) {
    // Guardar los IDs mas recientes. Antes se conservaban los ultimos insertados
    // del Set y, al recorrer cotizaciones de nueva a vieja, podia expulsarse
    // justamente el servicio nuevo y volver a alertar cada 15 segundos.
    localStorage.setItem(SEEN_KEY, JSON.stringify([...ids].slice(0, 500)));
  }

  function beep() {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.frequency.value = 880; gain.gain.value = 0.12;
      osc.start(); gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.45);
      osc.stop(ctx.currentTime + 0.45);
    } catch {}
  }

  function alertNew(q) {
    const section = $("serviciosEntrantes");
    if (section) {
      section.style.boxShadow = "0 0 0 4px rgba(255,45,120,.35)";
      section.style.transition = "box-shadow .25s ease";
      setTimeout(() => { section.style.boxShadow = ""; }, 5000);
    }
    let banner = $("newServiceAlert");
    if (!banner && section) {
      banner = document.createElement("div");
      banner.id = "newServiceAlert";
      banner.className = "notice";
      banner.style.cssText = "margin-bottom:12px;font-weight:800;font-size:16px";
      section.insertBefore(banner, section.firstChild);
    }
    if (banner) {
      banner.innerHTML = `<span>🔔 NUEVO SERVICIO · ${esc(q.empresa || "Compañía")} · Nº ${esc(q.numeroServicio || "-")} · ${esc(q.patente || "-")} · ${esc(q.origen || "-")}</span><small style="display:block;margin-top:6px;font-weight:700">Tocá este aviso para abrir y cotizar</small>`;
      banner.setAttribute("role", "button");
      banner.setAttribute("tabindex", "0");
      banner.setAttribute("aria-label", "Abrir el servicio nuevo en el cotizador");
      banner.style.cursor = "pointer";
      banner.onclick = () => cargar(q);
      banner.onkeydown = event => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          cargar(q);
        }
      };
      banner.scrollIntoView({behavior:"smooth", block:"center"});
    }
    beep();
    if ("Notification" in window && Notification.permission === "granted" && "serviceWorker" in navigator) {
      navigator.serviceWorker.ready
        .then(registration => registration.showNotification("Asistir24 · Nuevo servicio", {
          body:`${q.empresa || "Compañía"} · ${q.numeroServicio || "Sin número"} · ${q.patente || "Sin patente"}`,
          icon:"/icon-192.png.png",
          badge:"/icon-192.png.png",
          tag:`servicio-${q.numeroServicio || q.gmail?.messageId || q.id}`,
          data:{url:"/app", servicioId:q.id || null}
        }))
        .catch(error => console.warn("No se pudo mostrar la notificación:", error));
    }
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
    if ($("asegurado")) $("asegurado").value = q.datosMail?.asegurado || "";
    if ($("telefono")) $("telefono").value = q.datosMail?.telefono || "";
    if ($("emailAsegurado")) $("emailAsegurado").value = q.datosMail?.emailAsegurado || "";
    if ($("marca")) $("marca").value = q.datosMail?.marca || "";
    if ($("modelo")) $("modelo").value = q.datosMail?.modelo || q.datosMail?.vehiculo || "";
    if ($("colorVehiculo")) $("colorVehiculo").value = q.datosMail?.color || "";
    if ($("fechaServicio")) $("fechaServicio").value = q.datosMail?.fechaServicio || "";
    if ($("condicionServicio")) $("condicionServicio").value = q.datosMail?.condicionServicio || "INMEDIATO";
    if ($("transmision")) $("transmision").value = q.datosMail?.transmision || "";
    if ($("especificaciones")) $("especificaciones").value = q.datosMail?.especificaciones || q.datosMail?.informacionTecnica || "";
    if ($("personasTrasladar")) $("personasTrasladar").value = q.datosMail?.personasTrasladar || "0";
    if ($("siniestro")) $("siniestro").value = q.datosMail?.siniestro || "NO";
    if ($("enCochera")) $("enCochera").value = q.datosMail?.enCochera || "NO";
    if ($("poseeCarga")) $("poseeCarga").value = q.datosMail?.poseeCarga || "NO";
    if ($("vehiculoRueda")) $("vehiculoRueda").value = q.datosMail?.vehiculoRueda || "SI";
    if ($("tieneTrailer")) $("tieneTrailer").value = q.datosMail?.tieneTrailer || "NO";
    if ($("requiereExtraccion")) $("requiereExtraccion").value = q.datosMail?.requiereExtraccion || "NO";
    if ($("observaciones")) $("observaciones").value = q.datosMail?.observaciones || "";
    if ($("origen")) $("origen").value = q.origen || "";
    if ($("destino")) $("destino").value = q.destino || "";
    setSelect("tipoServicio", q.tipoServicio);
    if (q.base?.id) setSelect("baseId", q.base.id);
    if (q.base?.modalidad) setSelect("modalidad", q.base.modalidad);
    if ($("kmBaseOrigen") && q.tramos?.baseOrigen != null) $("kmBaseOrigen").value = q.tramos.baseOrigen;
    if ($("kmOrigenDestino") && q.tramos?.origenDestino != null) $("kmOrigenDestino").value = q.tramos.origenDestino;
    if ($("kmDestinoBase") && q.tramos?.destinoBase != null) $("kmDestinoBase").value = q.tramos.destinoBase;
    const form = $("quoteForm");
    form?.scrollIntoView({behavior:"smooth", block:"start"});
    form?.animate(
      [{boxShadow:"0 0 0 0 rgba(0,90,200,0)"},{boxShadow:"0 0 0 5px rgba(0,90,200,.35)"},{boxShadow:"0 0 0 0 rgba(0,90,200,0)"}],
      {duration:1600, easing:"ease-out"}
    );
    $("origen")?.dispatchEvent(new Event("input", {bubbles:true}));
  }

  async function cargarEntrantes() {
    const body = $("incomingRows");
    const count = $("incomingCount");
    const refreshButton = $("refreshIncoming");
    const originalText = refreshButton?.textContent || "Actualizar";
    if (refreshButton) { refreshButton.disabled = true; refreshButton.textContent = "Actualizando..."; }
    if (!body || typeof api !== "function") return;
    try {
      const data = await api("/api/cotizaciones");
      const allItems = (data.items || []).filter(q => q.gmail?.messageId);
      const items = allItems.slice(0, 3);
      if (count) count.textContent = `${allItems.length} servicios · últimos 3`;
      if (refreshButton) { refreshButton.textContent = "Actualizado ✓"; setTimeout(() => { refreshButton.textContent = originalText; refreshButton.disabled = false; }, 1000); }

      const seen = seenIds();
      if (initialized) {
        const ahora = Date.now();
        const MAX_ALERT_AGE_MS = 10 * 60 * 1000; // solo alertar servicios recibidos en los últimos 10 minutos
        const nuevos = allItems.filter(q => {
          const id = String(q.gmail?.messageId || q.id);
          if (seen.has(id)) return false;

          // Verificar fecha y hora real de recepción del servicio antes de alertar.
          const fechaHora = q.gmail?.receivedAt || q.fecha;
          const recibidoAt = Date.parse(fechaHora || "");
          if (!Number.isFinite(recibidoAt)) return false;

          const antiguedad = ahora - recibidoAt;
          return antiguedad >= 0 && antiguedad <= MAX_ALERT_AGE_MS;
        });
        if (nuevos.length) {
          nuevos.sort((a, b) =>
            Date.parse(b.gmail?.receivedAt || b.fecha || 0) -
            Date.parse(a.gmail?.receivedAt || a.fecha || 0)
          );
          alertNew(nuevos[0]);
        }
      }
      // Reconstruir el conjunto poniendo primero los servicios actuales/nuevos.
      // Asi un servicio ya marcado permanece visto entre cada polling.
      const currentIds = allItems.slice(0, 500).map(q => String(q.gmail?.messageId || q.id));
      const stableSeen = new Set([...currentIds, ...seen]);
      saveSeen(stableSeen);
      initialized = true;

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
      if (refreshButton) { refreshButton.textContent = "Reintentar"; refreshButton.disabled = false; }
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    if ("Notification" in window && Notification.permission === "default") {
      document.addEventListener("click", () => Notification.requestPermission().catch(()=>{}), {once:true});
    }
    cargarEntrantes();
    $("refreshIncoming")?.addEventListener("click", cargarEntrantes);
    setInterval(cargarEntrantes, 15000);
  });
})();
