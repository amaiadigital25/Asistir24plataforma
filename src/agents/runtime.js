function patchAgents(source){
 if(source.includes('app.get("/api/agents/status"')) return source;
 const importMarker='const { parseClaimsMail } = require("./src/claims-mail-parser");';
 source=source.replace(importMarker, importMarker+'\nconst agentsCoordinator = require("./src/agents/coordinador");\nlet agentAlerts = [];\nfunction pushAgentAlerts(items){ for(const a of (items||[])){ const duplicate=agentAlerts.find(x=>x.status==="OPEN"&&x.code===a.code&&String(x.serviceId||"")===String(a.serviceId||"")&&x.agent===a.agent); if(!duplicate) agentAlerts.unshift(a); } agentAlerts=agentAlerts.slice(0,1000); }');
 const marker='app.use(express.static(path.join(__dirname, "public"), { index: false, maxAge: "5m" }));';
 const routes=[
 'app.get("/api/agents/status", auth, (req,res)=>res.json({agents:Object.keys(agentsCoordinator.modules),heartbeats:agentsCoordinator.getHeartbeats(),openAlerts:agentAlerts.filter(a=>a.status==="OPEN").length,critical:agentAlerts.filter(a=>a.status==="OPEN"&&a.level==="CRITICAL").length}));',
 'app.get("/api/alerts", auth, (req,res)=>res.json({total:agentAlerts.length,items:agentAlerts}));',
 'app.post("/api/alerts/:id/resolve", auth, (req,res)=>{const a=agentAlerts.find(x=>x.id===req.params.id);if(!a)return res.status(404).json({error:"Alerta no encontrada"});a.status="RESOLVED";a.resolvedAt=new Date().toISOString();a.resolvedBy=req.user.user;res.json({success:true,alert:a});});',
 'app.post("/api/agents/check", auth, (req,res)=>{const result=agentsCoordinator.execute("control",{quotes:cotizaciones,heartbeats:agentsCoordinator.getHeartbeats()});pushAgentAlerts(result.alerts);res.json({success:true,...result,openAlerts:agentAlerts.filter(a=>a.status==="OPEN").length});});',
 'setInterval(()=>{try{const result=agentsCoordinator.execute("control",{quotes:cotizaciones,heartbeats:agentsCoordinator.getHeartbeats()});pushAgentAlerts(result.alerts);}catch(e){console.error("[Asistir24 Agents]",e.message);}},5*60*1000).unref();',
 ''
 ].join('\n');
 return source.replace(marker,routes+marker);
}
module.exports={patchAgents};
