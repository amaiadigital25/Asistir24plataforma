(() => {
  let requestId = 0;
  function setAuto(input, value) {
    input.value = Number(value).toFixed(1);
    input.dataset.auto = "true";
  }
  function clearAuto(input) {
    if (!input) return;
    input.value = "";
    input.dataset.auto = "false";
    delete input.dataset.baseId;
    delete input.dataset.origen;
  }
  function mapButton(show=false) {
    const b = $("openRouteMap");
    if (!b) return;
    b.classList.toggle("hidden", !show);
    b.disabled = !show;
  }
  function openMap() {
    const o=String($("origen").value||"").trim(), d=String($("destino").value||"").trim();
    const q=d ? o+" to "+d : o;
    if(q) window.open("https://www.google.com/maps/search/?api=1&query="+encodeURIComponent(q),"_blank","noopener");
  }
  let activeCalculation = null;
  let activeKey = "";
  function routeKey(base, origen, destino, modalidad, tipoServicio) {
    return [base?.id || "", origen, destino, modalidad, tipoServicio].join("|").trim().toLowerCase();
  }
  async function calculateAutomaticKm({silent=false}={}) {
    const base=selectedBase(), origen=String($("origen").value||"").trim();
    const auxilio=isAuxilioMecanico($("tipoServicio").value);
    const destino=auxilio ? "" : String($("destino").value||"").trim();
    if(!base||!origen){ if(!silent)setKmStatus("Seleccione una base e ingrese el origen.",true); return false; }
    if(!auxilio&&!destino){ if(!silent)setKmStatus("Ingrese el destino para calcular el recorrido completo.",true); return false; }
    const key=routeKey(base,origen,destino,currentModalidad(),$("tipoServicio").value);
    const kmInput=$("kmBaseOrigen");
    if(kmInput.dataset.auto==="true" && kmInput.dataset.routeKey===key && $("kmOrigenDestino").dataset.auto==="true") return true;
    if(activeCalculation && activeKey===key) return activeCalculation;
    const myRequest=++requestId, button=$("calcKmButton");
    if(button) button.disabled=true;
    clearAuto($("kmBaseOrigen")); clearAuto($("kmOrigenDestino")); clearAuto($("kmDestinoBase"));
    mapButton(false);
    setKmStatus("Calculando recorrido con TomTom...");
    activeKey=key;
    activeCalculation=(async()=>{
      try {
        const data=await api("/api/ruta-completa",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
          baseId:base.id, origen, destino, modalidad:currentModalidad(), tipoServicio:$("tipoServicio").value
        })});
        if(myRequest!==requestId) return false;
        const t=data.tramos||{};
        if(!Number.isFinite(Number(t.baseOrigen)) || Number(t.baseOrigen)<=0) throw new Error("TomTom no devolvió un recorrido Base → Origen válido");
        setAuto($("kmBaseOrigen"),Number(t.baseOrigen));
        $("kmBaseOrigen").dataset.baseId=base.id; $("kmBaseOrigen").dataset.origen=origen; $("kmBaseOrigen").dataset.routeKey=key;
        if(!auxilio) setAuto($("kmOrigenDestino"),Number(t.origenDestino||0));
        if(!auxilio) $("kmOrigenDestino").dataset.routeKey=key;
        if(data.modalidad==="INTERIOR" && Number(t.destinoBase)>0) setAuto($("kmDestinoBase"),Number(t.destinoBase));
        const parts=["Base → Origen "+Number(t.baseOrigen).toFixed(1)+" km"];
        if(!auxilio) parts.push("Origen → Destino "+Number(t.origenDestino||0).toFixed(1)+" km");
        if(data.modalidad==="INTERIOR" && Number(t.destinoBase)>0) parts.push((auxilio?"Origen":"Destino")+" → Base "+Number(t.destinoBase).toFixed(1)+" km");
        setKmStatus(parts.join(" · ")+" · TomTom.");
        return true;
      } catch(error) {
        clearAuto($("kmBaseOrigen")); clearAuto($("kmOrigenDestino")); clearAuto($("kmDestinoBase"));
        mapButton(true);
        setKmStatus("No se pudo calcular con TomTom: "+error.message+". No se conservaron kilómetros anteriores.",true);
        return false;
      } finally {
        if(myRequest===requestId&&button) button.disabled=false;
        if(activeKey===key){ activeCalculation=null; activeKey=""; }
      }
    })();
    return activeCalculation;
  }
  calculateBaseOriginKm=calculateAutomaticKm;
  const originalUpdateRouteUI=updateRouteUI;
  updateRouteUI=function(){ originalUpdateRouteUI(); };
  if($("calcKmButton")) $("calcKmButton").textContent="Calcular kilómetros con TomTom";
  if($("openRouteMap")) $("openRouteMap").addEventListener("click",openMap);
})();
