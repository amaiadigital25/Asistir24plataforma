(() => {
  const geocodeCache = new Map();
  let lastNominatimAt = 0;
  let requestId = 0;

  const BASE_POINTS = {
    "nahuel-ruso-parque-siguiman": { lat: -31.34635, lon: -64.482483, label: "Villa Parque Siquiman, Córdoba, Argentina" }
  };

  const BASE_ALIASES = {
    "eugenio-casanova": "Isidro Casanova, Buenos Aires, Argentina",
    "agustin-varela": "Florencio Varela, Buenos Aires, Argentina",
    "mm-remolques-devoto": "Villa Devoto, Ciudad Autónoma de Buenos Aires, Argentina",
    "javy-burzaco": "Burzaco, Buenos Aires, Argentina",
    "charly-caba": "Ciudad Autónoma de Buenos Aires, Argentina",
    "nahuel-ruso-parque-siguiman": "Villa Parque Siquiman, Punilla, Córdoba, Argentina"
  };

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  function normalizeText(value) { return String(value || "").replace(/\u00a0/g," ").replace(/^[\s>›»•·–—:;|]+/,"").replace(/\s+/g," ").trim(); }
  function canonicalize(value) { return normalizeText(value).replace(/\bZONA\s+(SUR|NORTE|OESTE)\b/gi,"").replace(/\s*,\s*,/g,",").replace(/^\s*,|,\s*$/g,"").replace(/\s+/g," ").trim(); }
  function validPoint(lat, lon) { return Number.isFinite(lat)&&Number.isFinite(lon)&&lat>=-56&&lat<=-20&&lon>=-74&&lon<=-52; }

  // Coordenadas: acepta -34.5645083,-58.6316433 y variantes con espacios/;.
  // IMPORTANTE: no eliminar el signo '-' antes de parsear.
  function parseCoordinates(value) {
    const raw = String(value || "").trim().replace(/^\(|\)$/g, "");
    let m = raw.match(/^\s*(-?\d{1,2}(?:\.\d+)?)\s*[,;]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/);
    if (!m) m = raw.match(/^\s*(-?\d{1,2}(?:\.\d+)?)\s+(-?\d{1,3}(?:\.\d+)?)\s*$/);
    if (!m) return null;
    const lat=Number(m[1]), lon=Number(m[2]);
    return validPoint(lat,lon)?{lat,lon,label:raw,provider:"Coordenadas"}:null;
  }

  function basePoint(base) {
    const fixed=BASE_POINTS[base?.id];
    if(fixed&&validPoint(fixed.lat,fixed.lon)) return {...fixed,provider:"Base registrada"};
    const lat=Number(base?.lat),lon=Number(base?.lon);
    return validPoint(lat,lon)?{lat,lon,label:base.base,provider:"Base registrada"}:null;
  }
  function baseAddress(base) {
    if(BASE_ALIASES[base.id]) return BASE_ALIASES[base.id];
    const name=canonicalize(base.base);
    const zone=canonicalize(base.zona);
    const generic=/^(ZONA\s+(SUR|NORTE|OESTE)|SIN DATO|PROVINCIA DE BUENOS AIRES)$/i.test(zone);
    if(zone&&!generic) return `${name}, ${zone}, Argentina`;
    return base.modalidad==="AMBA_CABA"?`${name}, Buenos Aires, Argentina`:`${name}, Argentina`;
  }
  function contextualAddress(value,base){
    const coords=parseCoordinates(value); if(coords) return "";
    let text=canonicalize(value).replace(/,?\s*argentina\s*$/i,"").trim();
    if(!text)return "";
    if(/,/.test(text)||/\b(caba|buenos aires|córdoba|cordoba|santa fe|mendoza|salta|tucum[aá]n|misiones|chaco|entre r[ií]os|la pampa|santa cruz)\b/i.test(text))return `${text}, Argentina`;
    return base?.modalidad==="AMBA_CABA"?`${text}, Buenos Aires, Argentina`:`${text}, Argentina`;
  }
  async function geocodeNominatim(query){
    const normalized=normalizeText(query),key=`osm:${normalized.toLowerCase()}`; if(geocodeCache.has(key))return geocodeCache.get(key);
    const wait=Math.max(0,1100-(Date.now()-lastNominatimAt));if(wait)await sleep(wait);lastNominatimAt=Date.now();
    const url=new URL("https://nominatim.openstreetmap.org/search");url.searchParams.set("q",normalized);url.searchParams.set("format","jsonv2");url.searchParams.set("limit","1");url.searchParams.set("countrycodes","ar");
    const response=await fetch(url,{headers:{Accept:"application/json","Accept-Language":"es-AR,es;q=0.9"}});if(!response.ok)throw new Error(`servicio de ubicación HTTP ${response.status}`);
    const item=(await response.json())?.[0];if(!item)throw new Error(`No se pudo localizar: ${normalized}`);const lat=Number(item.lat),lon=Number(item.lon);if(!validPoint(lat,lon))throw new Error(`Ubicación inválida: ${normalized}`);
    const p={lat,lon,label:item.display_name||normalized,provider:"OpenStreetMap"};geocodeCache.set(key,p);return p;
  }
  async function geocodeFlexible(value,base){const coords=parseCoordinates(value);if(coords)return coords;return geocodeNominatim(contextualAddress(value,base));}
  async function geocodeBase(base){const fixed=basePoint(base);if(fixed)return fixed;return geocodeNominatim(baseAddress(base));}
  async function routeWith(router,from,to){const url=`${router}/route/v1/driving/${from.lon},${from.lat};${to.lon},${to.lat}?overview=false&steps=false&alternatives=false`;const response=await fetch(url,{headers:{Accept:"application/json"}});if(!response.ok)throw new Error(`servidor de rutas HTTP ${response.status}`);const meters=Number((await response.json())?.routes?.[0]?.distance);if(!Number.isFinite(meters))throw new Error("sin recorrido vehicular");return Math.round(meters/100)/10;}
  async function routeKm(from,to){let last;for(const router of ["https://router.project-osrm.org","https://routing.openstreetmap.de/routed-car"]){try{return await routeWith(router,from,to)}catch(e){last=e}}throw last||new Error("No se pudo calcular la ruta vehicular");}
  function setAuto(input,value){input.value=Number(value).toFixed(1);input.dataset.auto="true";}
  function clearAuto(input){if(!input)return;if(input.dataset.auto==="true")input.value="";input.dataset.auto="false";}
  async function calculateAutomaticKm({silent=false}={}){
    const base=selectedBase(),modalidad=currentModalidad(),auxilio=isAuxilioMecanico($("tipoServicio").value),origen=String($("origen").value||"").trim(),destino=auxilio?"":String($("destino").value||"").trim();
    if(!base||!origen){if(!silent)setKmStatus("Seleccione una base e ingrese el origen.",true);return false}if(!auxilio&&!destino){if(!silent)setKmStatus("Ingrese el destino para calcular el recorrido completo.",true);return false}
    const myRequest=++requestId,button=$("calcKmButton");if(button)button.disabled=true;setKmStatus("Ubicando base, origen y destino... calculando ruta real.");
    try{
      const baseCoord=await geocodeBase(base),origenCoord=await geocodeFlexible(origen,base);if(myRequest!==requestId)return false;
      const k1=await routeKm(baseCoord,origenCoord);setAuto($("kmBaseOrigen"),k1);$("kmBaseOrigen").dataset.baseId=base.id;$("kmBaseOrigen").dataset.origen=origen;
      let k2=0,k3=0,destinoCoord=null;
      if(auxilio){clearAuto($("kmOrigenDestino"));clearAuto($("kmDestinoBase"));}else{destinoCoord=await geocodeFlexible(destino,base);k2=await routeKm(origenCoord,destinoCoord);setAuto($("kmOrigenDestino"),k2);if(modalidad==="INTERIOR"){k3=await routeKm(destinoCoord,baseCoord);setAuto($("kmDestinoBase"),k3)}else clearAuto($("kmDestinoBase"));}
      const parts=[`Base → Origen ${k1.toFixed(1)} km`];if(!auxilio)parts.push(`Origen → Destino ${k2.toFixed(1)} km`);if(!auxilio&&modalidad==="INTERIOR")parts.push(`Destino → Base ${k3.toFixed(1)} km`);setKmStatus(`${parts.join(" · ")} · cálculo automático correcto.`);return true;
    }catch(error){clearAuto($("kmBaseOrigen"));clearAuto($("kmOrigenDestino"));clearAuto($("kmDestinoBase"));setKmStatus(`No se pudo calcular automáticamente: ${error.message}.`,true);return false}finally{if(myRequest===requestId&&button)button.disabled=false}
  }
  calculateBaseOriginKm=calculateAutomaticKm;if($("calcKmButton"))$("calcKmButton").textContent="Calcular kilómetros automáticamente";
  $("destino").addEventListener("input",()=>{clearAuto($("kmOrigenDestino"));clearAuto($("kmDestinoBase"));});
})();