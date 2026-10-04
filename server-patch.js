// Función auxiliar: obtener la hora en Buenos Aires y retornar tarifa dinámicamente
function getTarifaCompariiaPorHora() {
  // Obtener hora en zona horaria America/Argentina/Buenos_Aires
  const now = new Date();
  const buenosairesTz = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Argentina/Buenos_Aires',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).format(now);
  
  const [hourStr] = buenosairesTz.split(':');
  const hour = Number(hourStr);
  
  // Regla: 00:00-07:59 = movida $49.000 + $1.450/km
  //        08:00-14:59 = movida $45.999 + $1.245/km
  //        15:00-23:59 = movida $49.000 + $1.450/km
  if (hour >= 8 && hour <= 14) {
    return Object.freeze({ movida: 45999, km: 1245, moneda: "ARS", configured: true, periodo: "08:00-14:59" });
  }
  // Default: madrugada (00:00-07:59) y tarde/noche (15:00-23:59)
  return Object.freeze({ movida: 49000, km: 1450, moneda: "ARS", configured: true, periodo: hour >= 15 ? "15:00-23:59" : "00:00-07:59" });
}

// Función auxiliar: retorna la tarifa vigente sin descriptor de periodo (para compatibilidad con cotizador)
function getTarifaCompariaVigente() {
  const conPeriodo = getTarifaCompariiaPorHora();
  // Retorna objeto sin el campo 'periodo' para no romper cotizaciones existentes
  const { periodo, ...sinPeriodo } = conPeriodo;
  return Object.freeze(sinPeriodo);
}

// Función que reemplaza a tarifaPorTipoCliente: ahora maneja horarios dinámicos para compañías
function tarifaPorTipoCliente(tipoCliente) {
  if (String(tipoCliente || "").toUpperCase() === "PARTICULAR") {
    return TARIFAS.PARTICULAR;
  }
  // COMPANIA: retorna tarifa dinámica
  return getTarifaCompariaVigente();
}

