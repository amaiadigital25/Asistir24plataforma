const {AGENTS,LEVELS,alert,heartbeat}=require('./core');
const modules={entrada:require('./entrada'),cotizador:require('./cotizador'),confirmaciones:require('./confirmaciones'),despacho:require('./despacho'),prestadores:require('./prestadores'),control:require('./control'),metricas:require('./metricas')};
const beats={};
function execute(name,...args){ const mod=modules[name]; if(!mod) return {ok:false,alerts:[alert({agent:AGENTS.coordinador,level:LEVELS.CRITICAL,code:'AGENTE_DESCONOCIDO',message:`No existe agente ${name}`,action:'Revisar coordinador'})]}; try{ const result=mod.run(...args); beats[name]=heartbeat(name); return result; }catch(error){ return {ok:false,alerts:[alert({agent:AGENTS.coordinador,level:LEVELS.CRITICAL,code:'AGENTE_FALLO',message:`${name}: ${error.message}`,action:'Revisar logs y reintentar'})]}; } }
function getHeartbeats(){return {...beats};} module.exports={execute,getHeartbeats,modules};
