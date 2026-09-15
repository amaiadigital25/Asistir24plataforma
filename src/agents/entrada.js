const {AGENTS,LEVELS,alert,required}=require('./core');
function run(mail, existing=[]){
 const missing=required(mail,['empresa','numeroServicio','origen']); const alerts=[];
 if(missing.length) alerts.push(alert({agent:AGENTS.entrada,level:LEVELS.IMPORTANT,code:'MAIL_INCOMPLETO',serviceId:mail?.numeroServicio,message:`Faltan: ${missing.join(', ')}`,action:'Revisar mail antes de cotizar'}));
 const duplicate=existing.some(x=>String(x.numeroServicio)===String(mail?.numeroServicio)&&String(x.empresa).toLowerCase()===String(mail?.empresa||'').toLowerCase());
 if(duplicate) alerts.push(alert({agent:AGENTS.entrada,level:LEVELS.WARNING,code:'SERVICIO_DUPLICADO',serviceId:mail?.numeroServicio,message:'Servicio posiblemente duplicado',action:'No crear una segunda cotización sin validar'}));
 return {ok:!missing.length&&!duplicate,alerts};
} module.exports={run};
