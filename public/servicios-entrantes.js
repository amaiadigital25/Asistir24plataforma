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
    localStorage.setItem(SEEN_KEY, JSON.stringify([...ids].slice(-200)));
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
      banner.innerHTML = `🔔 NUEVO SERVICIO · ${esc(q.empresa || "Compañía")} · Nº ${esc(q.numeroServicio || "-")} · ${esc(q.patente || "-")} · ${esc(q.origen || "-")}`;
      banner.scrollIntoView({behavior:"smooth", block:"center"});
    }
    beep();
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification("Asistir24 · Nuevo servicio", {body:`${q.empresa || "Compañía"} · ${q.numeroServicio || "Sin número"} · ${q.patente || "Sin patente"}`});
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
      const allItems = (data.items || []).filter(q => q.gmail?.messageId);
      const items = allItems.slice(0, 3);
      if (count) count.textContent = `${allItems.length} servicios · últimos 3`;

      const seen = seenIds();
      if (initialized) {
        const nuevos = allItems.filter(q => !seen.has(String(q.gmail?.messageId || q.id)));
        if (nuevos.length) alertNew(nuevos[0]);
      }
      allItems.forEach(q => seen.add(String(q.gmail?.messageId || q.id)));
      saveSeen(seen);
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
