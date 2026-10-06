const CLAIMS_BASES = require("../data/claims-bases.json");

function patchLocationApi(source) {
  if (source.includes('app.post("/api/ruta-completa"')) return source;
  const marker = 'app.post("/api/distancia", auth, async (req, res) => {';
  if (!source.includes(marker)) return source;

  // Bases exactas confirmadas por Operaciones. Se aplican al cargar server.js,
  // antes de exponer /api/bases y antes de calcular cualquier recorrido.
  const claimsBasesBootstrap = [
    'const CLAIMS_BASES_FIJAS = ' + JSON.stringify(CLAIMS_BASES) + ';',
    'function normClaims(v){ return String(v || "").normalize("NFD").replace(/[\\u0300-\\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }',
    'function claimsBaseMatch(base){ const bp=normClaims(base?.prestador), bl=normClaims(base?.base); return CLAIMS_BASES_FIJAS.find(x => { const xp=normClaims(x.prestador), xl=normClaims(x.localidad); return (bp.includes(xp) || xp.includes(bp)) && (bl.includes(xl) || xl.includes(bl)); }); }',
    'for (const fija of CLAIMS_BASES_FIJAS) {',
    '  const match = basesDoc.bases.find(b => { const bp=normClaims(b.prestador), bl=normClaims(b.base); const fp=normClaims(fija.prestador), fl=normClaims(fija.localidad); return (bp.includes(fp) || fp.includes(bp)) && (bl.includes(fl) || fl.includes(bl)); });',
    '  const modalidad = /^(CABA|NORTE|OESTE|SUR)$/i.test(fija.zona) ? "AMBA_CABA" : "INTERIOR";',
    '  const direccionCompleta = [fija.direccion, fija.localidad, fija.zona, "Argentina"].filter(Boolean).join(", ");',
    '  if (match) { match.direccion = direccionCompleta; match.direccionFijaClaims = true; match.modalidad = modalidad; }',
    '}',
    ''
  ].join('\n');

  const exactBasesBootstrap = [
    'const BASES_EXACTAS_OPERACIONES = [',
    '  { id: "mm-remolques-saenz-pena", match: b => b.prestador === "MM Remolques", prestador: "MM Remolques", base: "Sáenz Peña", direccion: "Gral. Enrique Mosconi 2535, Sáenz Peña, Tres de Febrero, Buenos Aires, Argentina", zona: "ZONA OESTE", modalidad: "AMBA_CABA", estado: "ACTIVO", tipo: "Semipesados" },',
    '  { id: "ryj-manuel-alberti", match: b => b.prestador === "Remolques R y J" && b.id === "ryj-del-viso", prestador: "Remolques R y J", base: "Manuel Alberti", direccion: "Los Gladiolos 1179, Manuel Alberti, Pilar, Buenos Aires, Argentina", zona: "ZONA NORTE", modalidad: "AMBA_CABA", estado: "ACTIVO", tipo: "Semipesado" },',
    '  { id: "gruas-auxilio-russo-siquiman", match: b => b.id === "nahuel-ruso-parque-siguiman", prestador: "Grúas y Auxilio Russo", base: "Villa Parque Síquiman", direccion: "Av. Perón, Villa Parque Síquiman, Córdoba, Argentina", zona: "CORDOBA", modalidad: "INTERIOR", estado: "ACTIVO", tipo: "Semipesado" },',
    '  { id: "marco-del-viso", match: b => b.id === "marcos-del-viso", prestador: "Marco", base: "Del Viso", direccion: "Agustín Álvarez 5756, Del Viso, Pilar, Buenos Aires, Argentina", zona: "ZONA NORTE", modalidad: "AMBA_CABA", estado: "ACTIVO", tipo: "Semipesado" },',
    '  { id: "moises-beiro-gral-paz", match: b => b.id === "moises-beiro-gral-paz", prestador: "Moisés", base: "Beiró y General Paz", direccion: "Av. Francisco Beiró y Av. General Paz, Ciudad Autónoma de Buenos Aires, Argentina", zona: "CABA", modalidad: "AMBA_CABA", estado: "ACTIVO", tipo: "Semipesados" },',
    '  { id: "gruas-andres-berazategui", match: b => b.id === "gruas-andres-berazategui", prestador: "Grúas Andrés", base: "Berazategui", direccion: "Calle 205 311, Berazategui, Buenos Aires, Argentina", zona: "ZONA SUR", modalidad: "AMBA_CABA", estado: "ACTIVO", tipo: "Semipesado" },
  { id: "la-palma-cordoba", match: b => String(b?.base || "").toLowerCase().includes("la palma") && (String(b?.zona || "").toLowerCase().includes("cordoba") || String(b?.zona || "").toLowerCase().includes("córdoba")), prestador: "La Palma Córdoba", base: "La Palma", direccion: "La Palma, Córdoba, Argentina", zona: "CORDOBA", modalidad: "INTERIOR", estado: "ACTIVO", tipo: "Semipesado", lat: -30.2796, lng: -63.6 }',
    '];',
    'for (const exacta of BASES_EXACTAS_OPERACIONES) {',
    '  const index = basesDoc.bases.findIndex(exacta.match);',
    '  const limpia = { id: exacta.id, prestador: exacta.prestador, base: exacta.base, direccion: exacta.direccion, zona: exacta.zona, modalidad: exacta.modalidad, estado: exacta.estado, tipo: exacta.tipo };',
    '  if (index >= 0) basesDoc.bases[index] = { ...basesDoc.bases[index], ...limpia };',
    '  else basesDoc.bases.push(limpia);',
    '}',
    ''
  ].join('\n');

  const endpoint = [
    'const ROUTING_CACHE = new Map();',
    'const GEOCODE_CACHE = new Map();',
    'const ROUTING_CACHE_TTL = 10 * 60 * 1000;',
    'function cacheGet(cache, key) { const hit = cache.get(key); if (!hit) return null; if (Date.now() - hit.at > ROUTING_CACHE_TTL) { cache.delete(key); return null; } return hit.value; }',
    'function cachePut(cache, key, value) { if (cache.size >= 2000) cache.delete(cache.keys().next().value); cache.set(key, { at: Date.now(), value }); return value; }',
    'async function geocodeCached(text) { const key = String(text || "").trim().toLowerCase(); const hit = cacheGet(GEOCODE_CACHE, key); if (hit) return hit; return cachePut(GEOCODE_CACHE, key, await geocodeTomTom(text)); }',
    'async function routeCached(a, b) { const key = String(a.lat.toFixed(5)) + "," + String(a.lng.toFixed(5)) + ">" + String(b.lat.toFixed(5)) + "," + String(b.lng.toFixed(5)); const hit = cacheGet(ROUTING_CACHE, key); if (hit !== null) return hit; return cachePut(ROUTING_CACHE, key, await routeKmTomTom(a, b)); }',
    'app.post("/api/ruta-completa", auth, async (req, res) => {',
    '  try {',
    '    const base = basesDoc.bases.find(item => item.id === req.body?.baseId);',
    '    const origenTexto = String(req.body?.origen || "").trim();',
    '    const destinoTexto = String(req.body?.destino || "").trim();',
    '    const modalidad = req.body?.modalidad === "INTERIOR" ? "INTERIOR" : (base?.modalidad === "INTERIOR" ? "INTERIOR" : "AMBA_CABA");',
    '    const auxilio = String(req.body?.tipoServicio || "").toLowerCase().replace(/á/g, "a") === "auxilio mecanico";',
    '    if (!base) return res.status(400).json({ error: "Base inválida" });',
    '    if (!origenTexto) return res.status(400).json({ error: "Ingrese la ubicación de origen" });',
    '    if (!auxilio && !destinoTexto) return res.status(400).json({ error: "Ingrese el destino" });',
    '    const cacheKey = [base.id, modalidad, auxilio ? "A" : "R", origenTexto.toLowerCase(), destinoTexto.toLowerCase()].join("|");',
    '    const cached = cacheGet(ROUTING_CACHE, "complete:" + cacheKey);',
    '    if (cached) return res.json(cached);',
    '    const baseTexto = base.direccion || [base.base, base.zona, "Argentina"].filter(Boolean).join(", ");',
    '    const [baseCoord, origenCoord, destinoCoordInitial] = await Promise.all([',
    '      Promise.resolve(centroBase(base)).then(value => value || geocodeCached(baseTexto)),',
    '      geocodeCached(origenTexto),',
    '      auxilio ? Promise.resolve(null) : geocodeCached(destinoTexto)',
    '    ]);',
    '    const destinoCoord = destinoCoordInitial || null;',
    '    const routePromises = [routeCached(baseCoord, origenCoord)];',
    '    if (!auxilio) routePromises.push(routeCached(origenCoord, destinoCoord));',
    '    if (!auxilio && modalidad === "INTERIOR") routePromises.push(routeCached(destinoCoord, baseCoord));',
    '    const routeValues = await Promise.all(routePromises);',
    '    const baseOrigen = routeValues[0] || 0;',
    '    const origenDestino = auxilio ? 0 : (routeValues[1] || 0);',
    '    const destinoBase = (!auxilio && modalidad === "INTERIOR") ? (routeValues[2] || 0) : 0;',
    '    const result = { success: true, modalidad, auxilio, baseDireccion: baseTexto, tramos: { baseOrigen, origenDestino, destinoBase }, kmTotal: Math.round((baseOrigen + origenDestino + destinoBase) * 10) / 10, coordenadas: { base: baseCoord, origen: origenCoord, destino: destinoCoord } };',
    '    cachePut(ROUTING_CACHE, "complete:" + cacheKey, result);',
    '    res.json(result);',
    '  } catch (error) {',
    '    res.status(503).json({ error: error.message || "No se pudo calcular el recorrido", mapsFallback: true });',
    '  }',
    '});',
    ''
  ].join('\n');
  return source.replace(marker, claimsBasesBootstrap + exactBasesBootstrap + endpoint + marker);
}
module.exports = { patchLocationApi };
