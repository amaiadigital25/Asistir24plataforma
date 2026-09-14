function patchLocationApi(source) {
  if (source.includes('app.post("/api/ruta-completa"')) return source;
  const marker = 'app.post("/api/distancia", auth, async (req, res) => {';
  if (!source.includes(marker)) return source;
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
    '    const baseTexto = [base.base, base.zona, "Argentina"].filter(Boolean).join(", ");',
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
    '      success: true, modalidad, auxilio,',
    '      tramos: { baseOrigen, origenDestino, destinoBase },',
    '      kmTotal: Math.round((baseOrigen + origenDestino + destinoBase) * 10) / 10,',
    '      coordenadas: { base: baseCoord, origen: origenCoord, destino: destinoCoord }',
    '    });',
    '  } catch (error) {',
    '    res.status(503).json({ error: error.message || "No se pudo calcular el recorrido" });',
    '  }',
    '});',
    ''
  ].join('\n');
  return source.replace(marker, endpoint + marker);
}
module.exports = { patchLocationApi };
