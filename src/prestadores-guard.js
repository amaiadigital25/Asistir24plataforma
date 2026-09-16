function patchProviderGuard(source){
  let fixed=source;

  // El server base historicamente aceptaba solo admin/operador. En producción
  // habilitamos prestador sin exponerle APIs operativas.
  fixed=fixed.replace(
    'const role = req.body?.role === "admin" ? "admin" : "operador";',
    'const role = ["admin", "operador", "prestador"].includes(req.body?.role) ? req.body.role : "operador";'
  );
  fixed=fixed.replace(
    'if (["admin", "operador"].includes(req.body?.role)) user.role = req.body.role;',
    'if (["admin", "operador", "prestador"].includes(req.body?.role)) user.role = req.body.role;'
  );

  const authMarker='    next();\n  } catch {';
  if(fixed.includes(authMarker)&&!fixed.includes('Acceso de prestador limitado al módulo de facturación')){
    fixed=fixed.replace(authMarker,'    if (req.user.role === "prestador" && req.path !== "/api/me" && !req.path.startsWith("/api/prestadores/")) return res.status(403).json({ error: "Acceso de prestador limitado al módulo de facturación" });\n    next();\n  } catch {');
  }
  const routeMarker='app.get("/prestador", (req, res) => res.sendFile(path.join(__dirname, "public", "prestador.html")));';
  if(fixed.includes(routeMarker)&&!fixed.includes('app.get("/prestador-acceso"')){
    fixed=fixed.replace(routeMarker,'app.get("/prestador-acceso", (req, res) => res.sendFile(path.join(__dirname, "public", "prestador-acceso.html")));\n'+routeMarker);
  }
  return fixed;
}
module.exports={patchProviderGuard};