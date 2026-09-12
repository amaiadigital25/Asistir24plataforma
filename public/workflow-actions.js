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

  async function enhanceRows() {
    const tbody = document.getElementById("quoteRows");
    if (!tbody) return;
    try {
      const data = await api("/api/cotizaciones");
      const rows = [...tbody.querySelectorAll("tr")];
      for (const q of data.items || []) {
        if (q.flujo?.estado !== "LISTO_PARA_WHATSAPP") continue;
        const row = rows.find(r => r.textContent.includes(q.id));
        if (!row || row.querySelector(`[data-wa-id="${q.id}"]`)) continue;
        const cell = row.cells?.[1] || row.lastElementChild;
        if (!cell) continue;
        const button = document.createElement("button");
        button.type = "button";
        button.className = "btn primary small";
        button.dataset.waId = q.id;
        button.textContent = "Enviar WhatsApp";
        button.style.marginTop = "6px";
        button.addEventListener("click", async () => {
          window.open(waUrl(q), "_blank", "noopener,noreferrer");
          try {
            await api(`/api/cotizaciones/${encodeURIComponent(q.id)}/marcar-whatsapp-enviado`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ detalle: "El operador abrió el remito para envío manual por WhatsApp" })
            });
            button.textContent = "WhatsApp abierto ✓";
            button.disabled = true;
          } catch (error) {
            console.error(error);
          }
        });
        cell.appendChild(document.createElement("br"));
        cell.appendChild(button);
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
