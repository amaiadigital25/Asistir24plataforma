const token = localStorage.getItem("a24_token");
if (!token) location.href = "/";
const $ = id => document.getElementById(id);
let currentQuoteId = null;
let debounceTimer = null;

async function api(path, options = {}) {
  const headers = Object.assign({}, options.headers || {}, {"Authorization": "Bearer " + token});
  const res = await fetch(path, Object.assign({}, options, {headers}));
  if (res.status === 401) {
    localStorage.removeItem("a24_token");
    localStorage.removeItem("a24_role");
    location.href = "/";
    throw new Error("Sesion vencida");
  }
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Error");
  return data;
}

function ars(value) {
  return new Intl.NumberFormat("es-AR", {style:"currency", currency:"ARS", maximumFractionDigits:0}).format(value || 0);
}

function dateTime(iso) {
  return iso ? new Intl.DateTimeFormat("es-AR", {dateStyle:"short", timeStyle:"short"}).format(new Date(iso)) : "-";
}

function stateLabel(estado) {
  return ({
    PENDIENTE: "Pendiente",
    LISTO_PARA_FACTURAR: "Listo para facturar",
    FACTURADO: "Facturado",
    COBRADO: "Cobrado"
  })[estado] || "Pendiente";
}

function stateClass(estado) {
  if (estado === "COBRADO") return "ok";
  if (estado === "FACTURADO") return "ok";
  if (estado === "LISTO_PARA_FACTURAR") return "warn";
  return "warn";
}

async function patchBilling(id, payload) {
  return api(`/api/cotizaciones/${encodeURIComponent(id)}/facturacion`, {
    method: "PATCH",
    headers: {"Content-Type":"application/json"},
    body: JSON.stringify(payload)
  });
}

function actionButtons(item) {
  const estado = item.facturacion?.estado || "PENDIENTE";
  if (estado === "PENDIENTE") return `<button class="btn success tiny" data-action="ready" data-id="${item.id}">Listo para facturar</button>`;
  if (estado === "LISTO_PARA_FACTURAR") return `<button class="btn primary tiny" data-action="invoice" data-id="${item.id}">Registrar factura</button>`;
  if (estado === "FACTURADO") return `<button class="btn success tiny" data-action="paid" data-id="${item.id}">Marcar cobrado</button>`;
  return `<span class="success-text">Cerrado</span>`;
}

async function loadHeader() {
  const me = await api("/api/me");
  if (me.role !== "admin") {
    location.href = "/app.html";
    return;
  }
  $("who").textContent = me.user;
}

async function loadBilling() {
  const params = new URLSearchParams();
  const q = $("searchBilling").value.trim();
  const estado = $("billingState").value;
  if (q) params.set("q", q);
  if (estado) params.set("estado", estado);
  const data = await api(`/api/facturacion?${params.toString()}`);

  const r = data.resumen || {};
  const cards = [
    ["Pendientes", r.PENDIENTE || 0],
    ["Listos", r.LISTO_PARA_FACTURAR || 0],
    ["Facturados", r.FACTURADO || 0],
    ["Cobrados", r.COBRADO || 0]
  ];
  $("billingStats").innerHTML = cards.map(([label,value]) => `<article class="stat-card"><span>${label}</span><strong>${value}</strong></article>`).join("");

  $("billingRows").innerHTML = data.items.map(item => {
    const f = item.facturacion || {};
    return `<tr>
      <td>${dateTime(item.fecha)}</td>
      <td>${item.empresa || "-"}</td>
      <td>${item.numeroServicio || item.id}</td>
      <td>${item.patente || "-"}</td>
      <td>${item.tipoServicio || "-"}</td>
      <td>${Number(item.kmTotal || 0).toFixed(1)}</td>
      <td><strong>${ars(item.total)}</strong></td>
      <td><span class="status ${stateClass(f.estado)}">${stateLabel(f.estado)}</span></td>
      <td>${f.facturaNumero || "-"}</td>
      <td><div class="row-actions">${actionButtons(item)}</div></td>
    </tr>`;
  }).join("") || `<tr><td colspan="10" class="muted">No hay servicios para mostrar.</td></tr>`;
}

$("billingRows").addEventListener("click", async event => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const id = button.dataset.id;
  const action = button.dataset.action;
  button.disabled = true;
  try {
    if (action === "ready") await patchBilling(id, {estado:"LISTO_PARA_FACTURAR"});
    if (action === "paid") await patchBilling(id, {estado:"COBRADO"});
    if (action === "invoice") {
      currentQuoteId = id;
      $("invoiceTitle").textContent = `Servicio ${id}`;
      $("invoiceNumber").value = "";
      $("invoiceCae").value = "";
      $("invoiceCaeDue").value = "";
      $("invoiceNotes").value = "";
      $("invoiceError").textContent = "";
      $("invoiceDialog").showModal();
      return;
    }
    await loadBilling();
  } catch (error) {
    alert(error.message);
  } finally {
    button.disabled = false;
  }
});

$("invoiceForm").addEventListener("submit", async event => {
  event.preventDefault();
  if (!currentQuoteId) return;
  const facturaNumero = $("invoiceNumber").value.trim();
  if (!facturaNumero) {
    $("invoiceError").textContent = "Ingrese el número de factura.";
    return;
  }
  try {
    await patchBilling(currentQuoteId, {
      estado: "FACTURADO",
      facturaNumero,
      cae: $("invoiceCae").value.trim(),
      caeVencimiento: $("invoiceCaeDue").value || null,
      observaciones: $("invoiceNotes").value.trim()
    });
    $("invoiceDialog").close();
    currentQuoteId = null;
    await loadBilling();
  } catch (error) {
    $("invoiceError").textContent = error.message;
  }
});

$("cancelInvoice").addEventListener("click", () => {
  $("invoiceDialog").close();
  currentQuoteId = null;
});
$("refreshBilling").addEventListener("click", loadBilling);
$("billingState").addEventListener("change", loadBilling);
$("searchBilling").addEventListener("input", () => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(loadBilling, 250);
});
$("logout").addEventListener("click", () => {
  localStorage.removeItem("a24_token");
  localStorage.removeItem("a24_role");
  location.href = "/";
});

(async function init(){
  try {
    await loadHeader();
    await loadBilling();
  } catch (error) {
    console.error(error);
  }
})();
