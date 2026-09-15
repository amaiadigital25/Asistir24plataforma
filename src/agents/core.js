const AGENTS = Object.freeze({
  entrada: 'ENTRADA', cotizador: 'COTIZADOR', confirmaciones: 'CONFIRMACIONES', despacho: 'DESPACHO',
  prestadores: 'PRESTADORES', control: 'CONTROL', metricas: 'METRICAS', coordinador: 'COORDINADOR'
});
const LEVELS = Object.freeze({ INFO:'INFO', WARNING:'WARNING', IMPORTANT:'IMPORTANT', CRITICAL:'CRITICAL' });
function now(){ return new Date().toISOString(); }
function alert({agent, level=LEVELS.WARNING, code, serviceId=null, message, action=''}) {
  return { id:`ALT-${Date.now()}-${Math.random().toString(36).slice(2,7)}`, at:now(), agent, level, code, serviceId, message, action, status:'OPEN' };
}
function heartbeat(agent, detail='OK'){ return { agent, at:now(), detail }; }
function required(obj, fields){ return fields.filter(k => !String(obj?.[k] ?? '').trim()); }
module.exports={ AGENTS, LEVELS, alert, heartbeat, required };
