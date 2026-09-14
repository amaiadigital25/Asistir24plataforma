(() => {
  const token = localStorage.getItem("a24_token");
  if (!token) return;

  const phone = "5491126433243";

  async function api(path, options = {}) {
    const res = await fetch(path, {
      ...options,
      cache: "no-store",
      headers: { ...(options.headers || {}), Authorization: "Bearer " + token }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Error");
    return data;
  }

  function waUrl(q) {
    const text = q.remito?.texto || "ASISTIR24 - REMITO DE SERVICIO";
    return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
  }

  function ensureActionHeader() {
    const table = document.querySelector("#quoteRows")?.closest("table");
    const headerRow = table?.querySelector("thead tr");
    if (!headerRow) return;
    if ([...headerRow.cells].some(cell => cell.dataset.workflowActionHeader === "true")) return;
    const th = document.createElement("th");
    th.textContent = "Acción";
    th.dataset.workflowActionHeader = "true";
    headerRow.appendChild(th);
  }

  function actionCellForRow(row, q) {
    let cell = row.querySelector(`[data-workflow-action-id="${q.id}"]`);
    if (cell) return cell;
    cell = document.createElement("td");
    cell.dataset.workflowActionId = q.id;
    row.appendChild(cell);
    return cell;
  }

  function renderAction(cell, q) {
    cell.innerHTML = "";

    if (q.flujo?.estado === "LISTO_PARA_WHATSAPP") {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "btn primary small";
      button.textContent = "Mandar remito por WhatsApp";
      button.addEventListener("click", async () => {
        button.disabled = true;
        const popup = window.open(waUrl(q), "_blank", "noopener,noreferrer");
        if (!popup) {
          button.disabled = false;
          alert("El navegador bloqueó WhatsApp. Habilitá las ventanas emergentes e intentá de nuevo.");
          return;
        }
        try {
          await api(`/api/cotizaciones/${encodeURIComponent(q.id)}/marcar-whatsapp-enviado`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ detalle: "El operador abrió el remito para envío manual por WhatsApp" })
          });
          button.textContent = "WhatsApp abierto ✓";
        } catch (error) {
          console.error(error);
          button.disabled = false;
          alert(error.message || "No se pudo actualizar el estado del servicio");
        }
      });
      cell.appendChild(button);
      return;
    }

    if (q.flujo?.estado === "ENVIADO_WHATSAPP") {
      const done = document.createElement("span");
      done.className = "pill";
      done.textContent = "Remito enviado ✓";
      cell.appendChild(done);
      return;
    }

    const waiting = document.createElement("button");
    waiting.type = "button";
    waiting.className = "btn ghost small";
    waiting.disabled = true;
    waiting.textContent = "Esperando confirmación";
    cell.appendChild(waiting);
  }

  async function enhanceRows() {
    const tbody = document.getElementById("quoteRows");
    if (!tbody) return;
    ensureActionHeader();

    try {
      const data = await api("/api/cotizaciones");
      const rows = [...tbody.querySelectorAll("tr")];

      for (const q of data.items || []) {
        const row = rows.find(r => r.textContent.includes(q.id));
        if (!row) continue;
        const cell = actionCellForRow(row, q);
        renderAction(cell, q);
      }

      for (const row of rows) {
        if (row.querySelector("td[colspan]")) {
          row.querySelector("td[colspan]").colSpan = 11;
        }
      }
    } catch (error) {
      console.error("No se pudieron cargar acciones de flujo", error);
    }
  }

  const observer = new MutationObserver(() => enhanceRows());
  const start = () => {
    const tbody = document.getElementById("quoteRows");
    if (!tbody) return setTimeout(start, 300);
    observer.observe(tbody, { childList: true, subtree: true });
    enhanceRows();
    setInterval(enhanceRows, 15000);
  };

  start();
})();
