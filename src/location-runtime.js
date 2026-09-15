function patchLocationApi(source) {
  if (source.includes('app.post("/api/ruta-completa"')) return source;
  const marker = 'app.post("/api/distancia", auth, async (req, res) => {';
  if (!source.includes(marker)) return source;

  // Bases exactas confirmadas por Operaciones. Se aplican al cargar server.js,
  // antes de exponer /api/bases y antes de calcular cualquier recorrido.
  const exactBasesBootstrap = [
    'const BASES_EXACTAS_OPERACIONES = [',
    '  { id: "mm-remolques-saenz-pena", match: b => b.prestador === "MM Remolques", prestador: "MM Remolques", base: "Sáenz Peña", direccion: "Gral. Enrique Mosconi 2535, Sáenz Peña, Tres de Febrero, Buenos Aires, Argentina", zona: "ZONA OESTE", modalidad: "AMBA_CABA", estado: "ACTIVO", tipo: "Semipesados" },',
    '  { id: "ryj-manuel-alberti", match: b => b.prestador === "Remolques R y J" && b.id === "ryj-del-viso", prestador: "Remolques R y J", base: "Manuel Alberti", direccion: "Los Gladiolos 1179, Manuel Alberti, Pilar, Buenos Aires, Argentina", zona: "ZONA NORTE", modalidad: "AMBA_CABA", estado: "ACTIVO", tipo: "Semipesado" },',
    '  { id: "gruas-auxilio-russo-siquiman", match: b => b.id === "nahuel-ruso-parque-siguiman", prestador: "Grúas y Auxilio Russo", base: "Villa Parque Síquiman", direccion: "Av. Perón, Villa Parque Síquiman, Córdoba, Argentina", zona: "CORDOBA", modalidad: "INTERIOR", estado: "ACTIVO", tipo: "Semipesado" },',
    '  { id: "marco-del-viso", match: b => b.id === "marcos-del-viso", prestador: "Marco", base: "Del Viso", direccion: "Agustín Álvarez 5756, Del Viso, Pilar, Buenos Aires, Argentina", zona: "ZONA NORTE", modalidad: "AMBA_CABA", estado: "ACTIVO", tipo: "Semipesado" },',
    '  { id: "moises-beiro-gral-paz", match: b => b.id === "moises-beiro-gral-paz", prestador: "Moisés", base: "Beiró y General Paz", direccion: "Av. Francisco Beiró y Av. General Paz, Ciudad Autónoma de Buenos Aires, Argentina", zona: "CABA", modalidad: "AMBA_CABA", estado: "ACTIVO", tipo: "Semipesados" },',
    '  { id: "gruas-andres-berazategui", match: b => b.id === "gruas-andres-berazategui", prestador: "Grúas Andrés", base: "Berazategui", direccion: "Calle 205 311, Berazategui, Buenos Aires, Argentina", zona: "ZONA SUR", modalidad: "AMBA_CABA", estado: "ACTIVO", tipo: "Semipesado" }',
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
    '    const baseTexto = base.direccion || [base.base, base.zona, "Argentina"].filter(Boolean).join(", ");',
    '    const [baseCoord, origenCoord] = await Promise.all([geocodeGoogle(baseTexto), geocodeGoogle(origenTexto)]);',
    '    const baseOrigen = await routeKmGoogle(baseCoord, origenCoord);',
    '    let origenDestino = 0;',
    '    let destinoBase = 0;',
    '    let destinoCoord = null;',
    '    if (!auxilio) {',
    '      destinoCoord = await geocodeGoogle(destinoTexto);',
    '      origenDestino = await routeKmGoogle(origenCoord, destinoCoord);',
    '      if (modalidad === "INTERIOR") destinoBase = await routeKmGoogle(destinoCoord, baseCoord);',
    '    }',
    '    res.json({',
    '      success: true, modalidad, auxilio, baseDireccion: baseTexto,',
    '      tramos: { baseOrigen, origenDestino, destinoBase },',
    '      kmTotal: Math.round((baseOrigen + origenDestino + destinoBase) * 10) / 10,',
    '      coordenadas: { base: baseCoord, origen: origenCoord, destino: destinoCoord }',
    '    });',
    '  } catch (error) {',
    '    res.status(503).json({ error: error.message || "No se pudo calcular el recorrido", mapsFallback: true });',
    '  }',
    '});',
    ''
  ].join('\n');
  return source.replace(marker, exactBasesBootstrap + endpoint + marker);
}
module.exports = { patchLocationApi };
