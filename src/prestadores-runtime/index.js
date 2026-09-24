function patchServerSource(source){
  let fixed=source;
  fixed=fixed.replace('app.use(express.json({ limit: "100kb" }));','app.use(express.json({ limit: "8mb" }));');
  fixed=fixed.replace('const role = req.body?.role === "admin" ? "admin" : "operador";','const role = ["admin", "operador", "prestador"].includes(req.body?.role) ? req.body.role : "operador";');
  fixed=fixed.replace('if (["admin", "operador"].includes(req.body?.role)) user.role = req.body.role;','if (["admin", "operador", "prestador"].includes(req.body?.role)) user.role = req.body.role;');

  const constants='const FACTURACION_ESTADOS = ["PENDIENTE", "LISTO_PARA_FACTURAR", "FACTURADO", "COBRADO"];';
  if(fixed.includes(constants)&&!fixed.includes('PRESTADOR_FACTURA_ESTADOS')) fixed=fixed.replace(constants,constants+'\nconst PRESTADOR_FACTURA_ESTADOS = ["PENDIENTE_REVISION", "OC_DESPACHADA", "RECHAZADA"];\nconst PRESTADOR_FACTURAS_DIR = process.env.PRESTADOR_FACTURAS_DIR || path.join(path.dirname(DATA_FILE), "facturas-prestadores");');

  const helperMarker='function gmailConfigured() {';
  if(fixed.includes(helperMarker)&&!fixed.includes('function readPrestadorFacturas()')){
    const helpers=`function readPrestadorFacturas(){
  const data=readData();
  return Array.isArray(data.prestadorFacturas)?data.prestadorFacturas:[];
}
function writePrestadorFacturas(items){
  const data=readData(); data.prestadorFacturas=items; writeData(data);
}
function cleanProviderText(value,max=300){ return String(value||"").trim().slice(0,max); }
function publicPrestadorFactura(item){
  return {id:item.id,numeroServicio:item.numeroServicio,cotizacionId:item.cotizacionId,cargaManual:Boolean(item.cargaManual),datosServicioManual:item.datosServicioManual||null,prestadorUserId:item.prestadorUserId,prestadorUsername:item.prestadorUsername,prestadorNombre:item.prestadorNombre,cuit:item.cuit,facturaNumero:item.facturaNumero,fechaFactura:item.fechaFactura,importe:item.importe,observaciones:item.observaciones,archivo:item.archivo?{id:item.archivo.id,nombre:item.archivo.nombre,mime:item.archivo.mime,size:item.archivo.size}:null,estado:item.estado,createdAt:item.createdAt,updatedAt:item.updatedAt,updatedBy:item.updatedBy,revision:item.revision||null,oc:item.oc||null};
}
function decodeProviderFile(value){
  const match=/^data:(application\\/pdf|image\\/jpeg|image\\/png);base64,([A-Za-z0-9+/=]+)$/.exec(String(value||""));
  if(!match) throw new Error("La factura debe ser PDF, JPG o PNG");
  const mime=match[1],buffer=Buffer.from(match[2],"base64");
  if(!buffer.length||buffer.length>5*1024*1024) throw new Error("El archivo debe pesar hasta 5 MB");
  const valid=(mime==="application/pdf"&&buffer.slice(0,5).toString("ascii")==="%PDF-")||(mime==="image/png"&&buffer.slice(0,8).toString("hex")==="89504e470d0a1a0a")||(mime==="image/jpeg"&&buffer.slice(0,3).toString("hex")==="ffd8ff");
  if(!valid) throw new Error("El archivo adjunto no es válido");
  return {mime,buffer,extension:mime==="application/pdf"?".pdf":mime==="image/png"?".png":".jpg"};
}
function providerEscape(value){ return String(value??"").replace(/[&<>]/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[ch])); }
`;
    fixed=fixed.replace(helperMarker,helpers+helperMarker);
  }

  const apiMarker='app.post(["/emergencia", "/api/emergencia"], auth, (req, res) => {';
  if(fixed.includes(apiMarker)&&!fixed.includes('/api/prestadores/facturas')){
    const api=`app.get("/api/prestadores/servicios/:numero", auth, (req,res)=>{
  if(!["prestador","admin"].includes(req.user.role)) return res.status(403).json({error:"Acceso exclusivo para prestadores"});
  const numero=cleanProviderText(req.params.numero,80);
  const q=cotizaciones.find(x=>String(x.numeroServicio||"").trim()===numero);
  if(!q) return res.status(404).json({error:"No encontramos ese número de servicio"});
  const previa=readPrestadorFacturas().find(x=>x.numeroServicio===numero&&x.estado!=="RECHAZADA");
  res.json({servicio:{id:q.id,numeroServicio:q.numeroServicio,empresa:q.empresa||"",patente:q.patente||"",tipoServicio:q.tipoServicio||"",origen:q.origen||"",destino:q.destino||"",fecha:q.fecha||null},yaFacturado:Boolean(previa),estadoFactura:previa?.estado||null});
});
app.get("/api/prestadores/mis-facturas", auth, (req,res)=>{
  if(req.user.role!=="prestador") return res.status(403).json({error:"Acceso exclusivo para prestadores"});
  const items=readPrestadorFacturas().filter(x=>String(x.prestadorUserId)===String(req.user.id)).map(publicPrestadorFactura);
  res.json({total:items.length,items});
});
app.post("/api/prestadores/facturas", auth, (req,res)=>{
  if(req.user.role!=="prestador") return res.status(403).json({error:"Acceso exclusivo para prestadores"});
  try{
    const numeroServicio=cleanProviderText(req.body?.numeroServicio,80),facturaNumero=cleanProviderText(req.body?.facturaNumero,80),fechaFactura=cleanProviderText(req.body?.fechaFactura,20),cuit=String(req.body?.cuit||"").replace(/\\D/g,""),importe=Number(req.body?.importe),observaciones=cleanProviderText(req.body?.observaciones,1000),archivoNombre=cleanProviderText(req.body?.archivoNombre,160)||"factura";
    if(!numeroServicio) return res.status(400).json({error:"Ingrese el número de servicio"});
    if(!facturaNumero) return res.status(400).json({error:"Ingrese el número de factura"});
    if(!/^\\d{11}$/.test(cuit)) return res.status(400).json({error:"El CUIT debe tener 11 dígitos"});
    if(!/^\\d{4}-\\d{2}-\\d{2}$/.test(fechaFactura)) return res.status(400).json({error:"Ingrese una fecha de factura válida"});
    if(!Number.isFinite(importe)||importe<=0||importe>1000000000) return res.status(400).json({error:"Ingrese un importe válido"});
    const q=cotizaciones.find(x=>String(x.numeroServicio||"").trim()===numeroServicio);
    const cargaManual=!q;
    const empresa=cleanProviderText(req.body?.empresa,120),patente=cleanProviderText(req.body?.patente,30),tipoServicio=cleanProviderText(req.body?.tipoServicio,120),fechaServicio=cleanProviderText(req.body?.fechaServicio,20);
    if(cargaManual&&!empresa) return res.status(400).json({error:"Para un servicio manual indique la compañía"});
    if(cargaManual&&!fechaServicio) return res.status(400).json({error:"Para un servicio manual indique la fecha del servicio"});
    const items=readPrestadorFacturas();
    if(items.some(x=>x.numeroServicio===numeroServicio&&x.estado!=="RECHAZADA")) return res.status(409).json({error:"Este servicio ya posee una factura registrada",codigo:"SERVICIO_YA_FACTURADO"});
    const file=decodeProviderFile(req.body?.archivoData); fs.mkdirSync(PRESTADOR_FACTURAS_DIR,{recursive:true});
    const archivoId=crypto.randomUUID()+file.extension; fs.writeFileSync(path.join(PRESTADOR_FACTURAS_DIR,archivoId),file.buffer,{flag:"wx"});
    const user=readUsers().find(x=>String(x.id)===String(req.user.id)),now=new Date().toISOString();
    const item={id:"PF-"+crypto.randomUUID(),numeroServicio,cotizacionId:q?.id||null,cargaManual,datosServicioManual:cargaManual?{empresa,patente,tipoServicio,fechaServicio}:null,prestadorUserId:req.user.id,prestadorUsername:req.user.user,prestadorNombre:user?.name||req.user.user,cuit,facturaNumero,fechaFactura,importe:Math.round(importe*100)/100,observaciones,archivo:{id:archivoId,nombre:archivoNombre,mime:file.mime,size:file.buffer.length},estado:"PENDIENTE_REVISION",createdAt:now,updatedAt:now,updatedBy:req.user.user,revision:null,oc:null};
    items.unshift(item); writePrestadorFacturas(items.slice(0,10000)); res.status(201).json({success:true,factura:publicPrestadorFactura(item)});
  }catch(error){ res.status(400).json({error:error.message||"No se pudo cargar la factura"}); }
});
app.get("/api/prestadores/facturas", auth, adminOnly, (req,res)=>{
  const estado=cleanProviderText(req.query.estado,40),term=cleanProviderText(req.query.q,100).toLowerCase(),all=readPrestadorFacturas(); let items=all.slice();
  if(PRESTADOR_FACTURA_ESTADOS.includes(estado)) items=items.filter(x=>x.estado===estado);
  if(term) items=items.filter(x=>[x.numeroServicio,x.facturaNumero,x.cuit,x.prestadorNombre,x.prestadorUsername,x.oc?.numero].join(" ").toLowerCase().includes(term));
  const resumen=PRESTADOR_FACTURA_ESTADOS.reduce((a,k)=>(a[k]=all.filter(x=>x.estado===k).length,a),{}); res.json({total:items.length,items:items.map(publicPrestadorFactura),resumen});
});
app.patch("/api/prestadores/facturas/:id/revision", auth, adminOnly, (req,res)=>{
  const items=readPrestadorFacturas(),item=items.find(x=>x.id===req.params.id); if(!item) return res.status(404).json({error:"Factura no encontrada"}); if(item.estado!=="PENDIENTE_REVISION") return res.status(409).json({error:"Esta factura ya fue revisada"});
  const accion=cleanProviderText(req.body?.accion,20).toUpperCase(),motivo=cleanProviderText(req.body?.motivo,500),now=new Date().toISOString();
  if(accion==="RECHAZAR"){ if(!motivo) return res.status(400).json({error:"Indique el motivo del rechazo"}); item.estado="RECHAZADA"; item.revision={accion,motivo,fecha:now,usuario:req.user.user}; }
  else if(accion==="APROBAR"){ const numero="OC-"+now.slice(0,10).replace(/-/g,"")+"-"+crypto.randomBytes(3).toString("hex").toUpperCase(); item.estado="OC_DESPACHADA"; item.revision={accion,motivo,fecha:now,usuario:req.user.user}; item.oc={numero,emitidaAt:now,despachadaAt:now,emitidaBy:req.user.user}; }
  else return res.status(400).json({error:"Acción inválida"});
  item.updatedAt=now; item.updatedBy=req.user.user; writePrestadorFacturas(items); res.json({success:true,factura:publicPrestadorFactura(item)});
});
app.get("/api/prestadores/facturas/:id/archivo", auth, (req,res)=>{
  const item=readPrestadorFacturas().find(x=>x.id===req.params.id); if(!item) return res.status(404).json({error:"Factura no encontrada"});
  const own=req.user.role==="prestador"&&String(item.prestadorUserId)===String(req.user.id); if(req.user.role!=="admin"&&!own) return res.status(403).json({error:"Sin permiso para ver este archivo"});
  const filePath=path.join(PRESTADOR_FACTURAS_DIR,item.archivo.id); if(!fs.existsSync(filePath)) return res.status(404).json({error:"Archivo no disponible"}); res.type(item.archivo.mime); res.setHeader("Content-Disposition","inline; filename="+encodeURIComponent(item.archivo.nombre)); res.sendFile(filePath);
});
app.get("/api/prestadores/facturas/:id/oc", auth, (req,res)=>{
  const item=readPrestadorFacturas().find(x=>x.id===req.params.id); if(!item) return res.status(404).json({error:"Factura no encontrada"});
  const own=req.user.role==="prestador"&&String(item.prestadorUserId)===String(req.user.id); if(req.user.role!=="admin"&&!own) return res.status(403).json({error:"Sin permiso para ver esta OC"}); if(!item.oc||item.estado!=="OC_DESPACHADA") return res.status(409).json({error:"La orden de compra todavía no fue emitida"});
  const q=cotizaciones.find(x=>x.id===item.cotizacionId)||{};
  const html="<!doctype html><html><head><meta charset='utf-8'><title>"+providerEscape(item.oc.numero)+"</title><style>body{font-family:Arial,sans-serif;margin:42px;color:#172033}.box{margin-top:24px;border:1px solid #d7deea;border-radius:12px;padding:20px}.row{display:grid;grid-template-columns:190px 1fr;padding:7px 0}.total{font-size:22px;font-weight:700}@media print{button{display:none}}</style></head><body><h1>ASISTIR24 · Orden de compra</h1><h2>"+providerEscape(item.oc.numero)+"</h2><div class='box'><div class='row'><b>Prestador</b><span>"+providerEscape(item.prestadorNombre)+"</span></div><div class='row'><b>CUIT</b><span>"+providerEscape(item.cuit)+"</span></div><div class='row'><b>Servicio</b><span>"+providerEscape(item.numeroServicio)+"</span></div><div class='row'><b>Empresa</b><span>"+providerEscape(q.empresa||"-")+"</span></div><div class='row'><b>Factura</b><span>"+providerEscape(item.facturaNumero)+"</span></div><div class='row total'><b>Importe autorizado</b><span>$ "+providerEscape(Number(item.importe).toLocaleString("es-AR",{minimumFractionDigits:2}))+"</span></div></div><p>Orden de compra emitida y despachada por Asistir24.</p><button onclick='window.print()'>Imprimir / Guardar PDF</button></body></html>";
  res.type("html").send(html);
});
`;
    fixed=fixed.replace(apiMarker,api+apiMarker);
  }

  const route='app.get("/facturacion", (req, res) => res.sendFile(path.join(__dirname, "public", "facturacion.html")));';
  if(fixed.includes(route)&&!fixed.includes('app.get("/prestador"')) fixed=fixed.replace(route,route+'\napp.get("/prestador", (req,res)=>res.sendFile(path.join(__dirname,"public","prestador.html")));\napp.get("/prestadores-revision", (req,res)=>res.sendFile(path.join(__dirname,"public","prestadores-revision.html")));');
  console.log('[Asistir24] Módulo Prestadores activo');
  return fixed;
}
module.exports={patchServerSource};