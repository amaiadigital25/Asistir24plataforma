const token = localStorage.getItem("a24_token");
if (!token) location.href = "/";
const $ = id => document.getElementById(id);
let bases = [];

async function api(path, options = {}) {
  const headers = Object.assign({}, options.headers || {}, {"Authorization": "Bearer " + token});
  const requestOptions = Object.assign({cache: "no-store"}, options, {headers});
  const res = await fetch(path, requestOptions);
  if (res.status === 401) {
    localStorage.removeItem("a24_token");
    location.href = "/";
    throw new Error("Sesion vencida");
  }
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Error");
  return data;
}

function ars(value) {
  return new Intl.NumberFormat("es-AR", {style:"currency", currency:"ARS", maximumFractionDigits:0}).format(value);
}

function dateTime(iso) {
  return new Intl.DateTimeFormat("es-AR", {dateStyle:"short", timeStyle:"short"}).format(new Date(iso));
}

function isAuxilioMecanico(tipoServicio) {
  return String(tipoServicio || "").toLowerCase().replace(/á/g, "a") === "auxilio mecanico";
}

function routeLabel(modalidad, tipoServicio) {
  if (isAuxilioMecanico(tipoServicio)) return "Base -> Origen";
  return modalidad === "INTERIOR" ? "Base -> Origen -> Destino -> Base" : "Base -> Origen -> Destino";
}

function billingLabel(estado) {
  return ({
    PENDIENTE: "Pendiente",
    LISTO_PARA_FACTURAR: "Listo para facturar",
    FACTURADO: "Facturado",
    COBRADO: "Cobrado"
  })[estado] || "Pendiente";
}

function selectedBase() {
  return bases.find(b => b.id === $("baseId").value);
}

function currentModalidad() {
  return $("modalidad").value === "INTERIOR" ? "INTERIOR" : "AMBA_CABA";
}

function syncModalidadWithBase() {
  const base = selectedBase();
  if (!base) return;
  $("modalidad").value = base.modalidad === "INTERIOR" ? "INTERIOR" : "AMBA_CABA";
}

function setKmStatus(message, isError = false) {
  const status = $("kmStatus");
  status.textContent = message;
  status.classList.toggle("error", isError);
}

function invalidateRouteKm() {
  const input = $("kmBaseOrigen");
  if (input.dataset.auto === "true") input.value = "";
  input.dataset.auto = "false";
  delete input.dataset.baseId;
  delete input.dataset.origen;
}

async function calculateBaseOriginKm({silent = false} = {}) {
  if (!silent) setKmStatus("Cargando el servicio de cálculo de rutas...");
  return false;
}

function updateRouteUI() {
  const base = selectedBase();
  if (!base) return;
  const modalidad = currentModalidad();
  const auxilio = isAuxilioMecanico($("tipoServicio").value);
  $("routeRule").textContent = routeLabel(modalidad, $("tipoServicio").value);
  $("destinationWrap").style.display = auxilio ? "none" : "grid";
  $("kmOriginDestinationWrap").style.display = auxilio ? "none" : "grid";
  $("destino").required = !auxilio;
  $("kmOrigenDestino").required = !auxilio;
  $("returnWrap").style.display = !auxilio && modalidad === "INTERIOR" ? "grid" : "none";
  $("kmDestinoBase").required = !auxilio && modalidad === "INTERIOR";
  if (auxilio) {
    $("destino").value = "";
    $("kmOrigenDestino").value = "";
    $("kmDestinoBase").value = "";
  } else if (modalidad !== "INTERIOR") {
    $("kmDestinoBase").value = "";
  }
}

function renderBaseSelect() {
  $("baseId").innerHTML = bases.map(b => `<option value="${b.id}">${b.base} - ${b.prestador} (${b.zona})</option>`).join("");
  syncModalidadWithBase();
  updateRouteUI();
}

function renderBases() {
  const q = $("searchBase").value.trim().toLowerCase();
  const modalidad = $("filterModalidad").value;
  const filtered = bases.filter(b => {
    const matchQ = !q || [b.prestador,b.base,b.zona,b.tipo,b.estado].join(" ").toLowerCase().includes(q);
    const matchM = !modalidad || b.modalidad === modalidad;
    return matchQ && matchM;
  });
  $("baseCount").textContent = `${filtered.length} bases`;
  $("baseList").innerHTML = filtered.map(b => `<div class="base-row"><div><strong>${b.base}</strong><span>${b.prestador}</span></div><div class="base-meta"><span>${b.zona}</span><span>${b.tipo}</span><span class="status ${b.estado === "ACTIVO" ? "ok" : "warn"}">${b.estado}</span></div></div>`).join("") || `<p class="muted">Sin resultados.</p>`;
}

async function loadHeader() {
  const me = await api("/api/me");
  $("who").textContent = me.user;
  if (me.role === "admin") {
    $("adminLink").classList.remove("hidden");
    $("billingLink").classList.remove("hidden");
  }
}

async function loadConfig() {
  const config = await api("/api/config");
  $("tarifaPill").textContent = `${ars(config.tarifa.movida)} + ${ars(config.tarifa.km)}/km`;
}

async function loadBases() {
  const data = await api("/api/bases");
  bases = data.items;
  renderBaseSelect();
  renderBases();
}

async function loadStats() {
  const r = await api("/api/resumen");
  const cards = [["Bases totales",r.bases.total],["CABA / AMBA",r.bases.ambaCaba],["Interior",r.bases.interior],["Activas",r.bases.activas],["Cotizaciones",r.cotizaciones]];
  $("stats").innerHTML = cards.map(([label,value]) => `<article class="stat-card"><span>${label}</span><strong>${value}</strong></article>`).join("");
}

async function loadQuotes() {
  const data = await api("/api/cotizaciones");
  $("quoteRows").innerHTML = data.items.map(q => `<tr><td>${dateTime(q.fecha)}</td><td>${q.id}</td><td>${q.empresa || "-"}</td><td>${q.numeroServicio || "-"}</td><td>${q.patente || "-"}</td><td>${q.base.base} - ${q.base.prestador}</td><td>${Number(q.kmTotal || 0).toFixed(1)}</td><td><strong>${ars(q.total)}</strong></td><td>${billingLabel(q.facturacion?.estado)}</td></tr>`).join("") || `<tr><td colspan="9" class="muted">Todavía no hay cotizaciones.</td></tr>`;
}

async function refreshDashboardData() {
  const button = $("refreshQuotes");
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = "Actualizando...";
  try {
    await Promise.all([loadQuotes(), loadStats(), loadConfig()]);
    button.textContent = "Actualizado ✓";
    setTimeout(() => {
      button.textContent = originalText;
      button.disabled = false;
    }, 1200);
  } catch (error) {
    console.error(error);
    button.textContent = "Reintentar";
    button.disabled = false;
  }
}

$("baseId").addEventListener("change", async () => {
  invalidateRouteKm();
  syncModalidadWithBase();
  updateRouteUI();
  if ($("origen").value.trim()) await calculateBaseOriginKm({silent:true});
});
$("modalidad").addEventListener("change", async () => {
  invalidateRouteKm();
  updateRouteUI();
  setKmStatus("Modalidad modificada. El recorrido se recalculará automáticamente.");
  if ($("origen").value.trim()) await calculateBaseOriginKm({silent:true});
});
$("tipoServicio").addEventListener("change", updateRouteUI);
$("origen").addEventListener("input", () => {
  invalidateRouteKm();
  setKmStatus("Origen modificado. El recorrido se recalculará automáticamente.");
});
$("origen").addEventListener("blur", () => calculateBaseOriginKm({silent:true}));
$("calcKmButton").addEventListener("click", () => calculateBaseOriginKm());
$("searchBase").addEventListener("input", renderBases);
$("filterModalidad").addEventListener("change", renderBases);
$("refreshQuotes").addEventListener("click", event => {
  event.preventDefault();
  refreshDashboardData();
});
$("logout").addEventListener("click", () => {
  localStorage.removeItem("a24_token");
  localStorage.removeItem("a24_role");
  location.href = "/";
});

$("quoteForm").addEventListener("submit", async e => {
  e.preventDefault();
  const result = $("quoteResult");
  result.classList.remove("hidden");
  result.innerHTML = "Calculando...";
  try {
    const origen = $("origen").value.trim();
    if (!origen) throw new Error("Ingrese la ubicación de origen");

    const kmInput = $("kmBaseOrigen");
    const currentBase = $("baseId").value;
    const kmEsActual = kmInput.dataset.auto === "true" && kmInput.dataset.baseId === currentBase && kmInput.dataset.origen === origen;
    if (!kmEsActual) await calculateBaseOriginKm({silent:true});
    if (!kmInput.value) throw new Error("No se pudo calcular Base -> Origen. Ingrese los kilómetros manualmente para continuar.");

    const payload = {
      empresa: $("empresa").value.trim(),
      numeroServicio: $("numeroServicio").value.trim(),
      patente: $("patente").value.trim().toUpperCase(),
      baseId: currentBase,
      modalidad: currentModalidad(),
      tipoServicio: $("tipoServicio").value,
      origen,
      destino: $("destino").value,
      kmBaseOrigen: kmInput.value,
      kmOrigenDestino: $("kmOrigenDestino").value,
      kmDestinoBase: $("kmDestinoBase").value
    };
    const q = await api("/api/cotizar", {
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify(payload)
    });
    result.innerHTML = `<div class="result-grid"><div><span>Servicio</span><strong>${q.numeroServicio}</strong></div><div><span>Empresa</span><strong>${q.empresa}</strong></div><div><span>Patente</span><strong>${q.patente}</strong></div><div><span>Km totales</span><strong>${q.kmTotal.toFixed(1)} km</strong></div><div><span>Movida</span><strong>${ars(q.tarifa.movida)}</strong></div><div><span>Kilómetros</span><strong>${ars(q.subtotalKm)}</strong></div><div class="total"><span>Total</span><strong>${ars(q.total)}</strong></div><div><span>Facturación</span><strong>Pendiente</strong></div><div><span>ID</span><strong>${q.id}</strong></div></div>`;
    await Promise.all([loadStats(), loadQuotes()]);
  } catch (err) {
    result.innerHTML = `<span class="error">${err.message}</span>`;
  }
});

(async function init(){
  try {
    await Promise.all([loadHeader(),loadConfig(),loadBases(),loadStats(),loadQuotes()]);
  } catch(e) {
    console.error(e);
  }
})();
