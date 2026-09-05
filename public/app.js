const token = localStorage.getItem("a24_token");
if (!token) location.href = "/";
const $ = id => document.getElementById(id);
let bases = [];
async function api(path, options = {}) {
  const headers = Object.assign({}, options.headers || {}, {"Authorization": "Bearer " + token});
  const res = await fetch(path, Object.assign({}, options, {headers}));
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
function routeLabel(modalidad) {
  return modalidad === "INTERIOR" ? "Base -> Origen -> Destino -> Base" : "Base -> Origen -> Destino";
}
function selectedBase() { return bases.find(b => b.id === $("baseId").value); }
function updateRouteUI() {
  const base = selectedBase(); if (!base) return;
  $("modalidad").value = base.modalidad === "INTERIOR" ? "Interior" : "CABA / AMBA";
  $("routeRule").textContent = routeLabel(base.modalidad);
  $("returnWrap").style.display = base.modalidad === "INTERIOR" ? "block" : "none";
  $("kmDestinoBase").required = base.modalidad === "INTERIOR";
  if (base.modalidad !== "INTERIOR") $("kmDestinoBase").value = "";
}
function renderBaseSelect() {
  $("baseId").innerHTML = bases.map(b => `<option value="${b.id}">${b.base} - ${b.prestador} (${b.zona})</option>`).join("");
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
async function loadHeader() { const me = await api("/api/me"); $("who").textContent = me.user; }
async function loadConfig() { const config = await api("/api/config"); $("tarifaPill").textContent = `${ars(config.tarifa.movida)} + ${ars(config.tarifa.km)}/km`; }
async function loadBases() { const data = await api("/api/bases"); bases = data.items; renderBaseSelect(); renderBases(); }
async function loadStats() {
  const r = await api("/api/resumen");
  const cards = [["Bases totales",r.bases.total],["CABA / AMBA",r.bases.ambaCaba],["Interior",r.bases.interior],["Activas",r.bases.activas],["Cotizaciones",r.cotizaciones]];
  $("stats").innerHTML = cards.map(([label,value]) => `<article class="stat-card"><span>${label}</span><strong>${value}</strong></article>`).join("");
}
async function loadQuotes() {
  const data = await api("/api/cotizaciones");
  $("quoteRows").innerHTML = data.items.map(q => `<tr><td>${dateTime(q.fecha)}</td><td>${q.id}</td><td>${q.base.base} - ${q.base.prestador}</td><td>${routeLabel(q.base.modalidad)}</td><td>${q.kmTotal.toFixed(1)}</td><td><strong>${ars(q.total)}</strong></td></tr>`).join("") || `<tr><td colspan="6" class="muted">Todavia no hay cotizaciones.</td></tr>`;
}
$("baseId").addEventListener("change", updateRouteUI);
$("searchBase").addEventListener("input", renderBases);
$("filterModalidad").addEventListener("change", renderBases);
$("refreshQuotes").addEventListener("click", loadQuotes);
$("logout").addEventListener("click", () => { localStorage.removeItem("a24_token"); location.href = "/"; });
$("quoteForm").addEventListener("submit", async e => {
  e.preventDefault();
  const result = $("quoteResult"); result.classList.remove("hidden"); result.innerHTML = "Calculando...";
  try {
    const payload = {baseId:$("baseId").value,tipoServicio:$("tipoServicio").value,origen:$("origen").value,destino:$("destino").value,kmBaseOrigen:$("kmBaseOrigen").value,kmOrigenDestino:$("kmOrigenDestino").value,kmDestinoBase:$("kmDestinoBase").value};
    const q = await api("/api/cotizar", {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
    result.innerHTML = `<div class="result-grid"><div><span>ID</span><strong>${q.id}</strong></div><div><span>Circuito</span><strong>${routeLabel(q.base.modalidad)}</strong></div><div><span>Km totales</span><strong>${q.kmTotal.toFixed(1)} km</strong></div><div><span>Movida</span><strong>${ars(q.tarifa.movida)}</strong></div><div><span>Kilometros</span><strong>${ars(q.subtotalKm)}</strong></div><div class="total"><span>Total</span><strong>${ars(q.total)}</strong></div></div>`;
    await Promise.all([loadStats(), loadQuotes()]);
  } catch (err) { result.innerHTML = `<span class="error">${err.message}</span>`; }
});
(async function init(){ try { await Promise.all([loadHeader(),loadConfig(),loadBases(),loadStats(),loadQuotes()]); } catch(e){ console.error(e); } })();