const fs = require("fs");

const path = require("path");
const RUNTIME_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || "/data";
const ARCHIVO = process.env.BASES_FILE || path.join(RUNTIME_DIR, "bases.json");
const BUNDLED_ARCHIVO = path.join(__dirname, "data", "bases.json");
const BACKUP = path.join(RUNTIME_DIR, "bases.antes-geocodificacion.json");

const TOMTOM_API_KEY =
  process.env.TOMTOM_API_KEY ||
  process.env.TOMTOM_KEY;

if (!TOMTOM_API_KEY) {
  console.error("❌ Falta TOMTOM_API_KEY");
  process.exit(1);
}

const sleep = ms =>
  new Promise(resolve => setTimeout(resolve, ms));

function coordenadasValidas(lat, lon) {
  if (
    lat === null ||
    lat === undefined ||
    lon === null ||
    lon === undefined ||
    lat === "" ||
    lon === ""
  ) {
    return false;
  }

  const la = Number(lat);
  const lo = Number(lon);

  return (
    Number.isFinite(la) &&
    Number.isFinite(lo) &&
    la >= -90 &&
    la <= 90 &&
    lo >= -180 &&
    lo <= 180
  );
}
function armarBusqueda(base) {
  const especiales = {
    "casanova": "Isidro Casanova, Buenos Aires, Argentina",
    "liniers": "Liniers, Ciudad Autónoma de Buenos Aires, Argentina",
    "devoto": "Villa Devoto, Ciudad Autónoma de Buenos Aires, Argentina",
    "varela": "Florencio Varela, Buenos Aires, Argentina",
    "garin": "Garín, Buenos Aires, Argentina",
    "zarate / gral. belgrano": "Zárate, Buenos Aires, Argentina",
    "mar de ajo": "Mar de Ajó, Buenos Aires, Argentina",
    "jose c. paz": "José C. Paz, Buenos Aires, Argentina",
    "jose leon suarez": "José León Suárez, Buenos Aires, Argentina",
    "salta capital": "Salta, Salta, Argentina",
    "tucuman": "San Miguel de Tucumán, Tucumán, Argentina",
    "mendoza": "Mendoza, Mendoza, Argentina",
    "la pampa": "Santa Rosa, La Pampa, Argentina",
    "caba": "Ciudad Autónoma de Buenos Aires, Argentina",
    "rotonda de burzaco": "Burzaco, Buenos Aires, Argentina",
    "parque siguiman": "Villa Parque Síquiman, Córdoba, Argentina",
    "constitucion": "Villa Constitución, Santa Fe, Argentina",
    "castelli": "Castelli, Buenos Aires, Argentina",
    "rio gallegos": "Río Gallegos, Santa Cruz, Argentina"
  };
  const nombre = String(base.base || "").trim();
  const normalizado = nombre.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (especiales[normalizado]) return especiales[normalizado];

  let provincia = "";
  const zona = normalizado;
  if (zona.includes("norte") || zona.includes("sur") || zona.includes("oeste") || zona.includes("caba") || zona.includes("la costa") || zona.includes("buenos aires")) provincia = "Buenos Aires";
  else if (zona.includes("entre rios")) provincia = "Entre Ríos";
  else if (zona.includes("santa fe")) provincia = "Santa Fe";
  else if (zona.includes("cordoba")) provincia = "Córdoba";
  else if (zona.includes("misiones")) provincia = "Misiones";
  else if (zona.includes("chaco")) provincia = "Chaco";
  else if (zona.includes("santa cruz")) provincia = "Santa Cruz";
  else if (zona.includes("mendoza")) provincia = "Mendoza";

  return [nombre, provincia, "Argentina"].filter(Boolean).join(", ");
}

async function buscarTomTom(texto) {
  const url =
    "https://api.tomtom.com/search/2/geocode/" +
    encodeURIComponent(texto) +
    ".json?key=" +
    encodeURIComponent(TOMTOM_API_KEY) +
    "&countrySet=AR&limit=3";

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(
      `TomTom HTTP ${response.status}`
    );
  }

  return response.json();
}

function puntajeResultado(resultado, base) {
  let puntos = 0;
  const address = resultado.address || {};
  const normal = value => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const localidad = normal(base.base || base.localidad || "");
  const blob = normal([
    address.municipality,
    address.municipalitySubdivision,
    address.countrySecondarySubdivision,
    address.countryTertiarySubdivision,
    address.freeformAddress,
    address.localName,
    address.postalName
  ].join(" | "));

  if (localidad) {
    if (normal(address.municipality) === localidad) puntos += 20;
    if (normal(address.municipalitySubdivision) === localidad) puntos += 15;
    if (normal(address.localName) === localidad) puntos += 15;
    if (blob.includes(localidad)) puntos += 5;
  }

  const provinciaEsperada = normal(armarBusqueda(base).split(",").slice(-2, -1)[0]);
  const provinciaResultado = normal(address.countrySubdivisionName || address.countrySubdivision || "");
  if (provinciaEsperada && provinciaResultado && provinciaResultado.includes(provinciaEsperada)) puntos += 15;
  if (resultado.type === "Geography") puntos += 10;
  if (resultado.type === "Point Address") puntos += 2;
  if (resultado.type === "Address Range") puntos += 1;

  return puntos;
}

async function main() {
  if (!fs.existsSync(ARCHIVO)) {
    fs.mkdirSync(path.dirname(ARCHIVO), { recursive: true });
    if (!fs.existsSync(BUNDLED_ARCHIVO)) {
      throw new Error(`No existe la fuente inicial ${BUNDLED_ARCHIVO}`);
    }
    fs.copyFileSync(BUNDLED_ARCHIVO, ARCHIVO);
    console.log("📦 Se inicializó el archivo persistente de bases:", ARCHIVO);
  }

  const raw = JSON.parse(fs.readFileSync(ARCHIVO, "utf8"));
  const bases = Array.isArray(raw) ? raw : (Array.isArray(raw.bases) ? raw.bases : []);
  if (!bases.length) throw new Error("No se encontraron bases en data/bases.json");

  fs.copyFileSync(
    ARCHIVO,
    BACKUP
  );

  console.log("");
  console.log(
    "===================================="
  );
  console.log(
    " ASISTIR24 - BASES + TOMTOM"
  );
  console.log(
    "===================================="
  );
  console.log(
    `Bases cargadas: ${bases.length}`
  );
  console.log("");

  let correctas = 0;
  let encontradas = 0;
  let pendientes = 0;

  for (let i = 0; i < bases.length; i++) {
    const base = bases[i];

    console.log(
      `[${i + 1}/${bases.length}]`,
      base.prestador,
      "-",
      base.base
    );

    if (
      coordenadasValidas(base.lat, base.lng ?? base.lon) &&
      base.tomtomVersion === 2
    ) {
      base.validada = true;
      base.fuenteCoordenadas =
        base.fuenteCoordenadas ||
        "CARGADA";
      if (!coordenadasValidas(base.lat, base.lng) && coordenadasValidas(base.lat, base.lon)) {
        base.lng = Number(base.lon);
        delete base.lon;
      }

      correctas++;

      console.log(
        "   ✅ Coordenadas existentes:",
        base.lat,
        base.lon
      );

      continue;
    }

    const consulta =
      armarBusqueda(base);

    if (!consulta) {
      base.validada = false;
      base.revisionManual = true;

      pendientes++;

      console.log(
        "   ⚠️ Sin datos suficientes"
      );

      continue;
    }

    console.log(
      "   🔎",
      consulta
    );

    try {
      const data =
        await buscarTomTom(
          consulta
        );

      if (
        !data.results ||
        data.results.length === 0
      ) {
        base.validada = false;
        base.revisionManual = true;

        pendientes++;

        console.log(
          "   ❌ TomTom no encontró resultado"
        );

        continue;
      }

      const provinciaEsperada = String(armarBusqueda(base).split(",").slice(-2, -1)[0] || "")
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

      const candidatos =
        data.results
          .map(r => ({
            resultado: r,
            puntos: puntajeResultado(r, base)
          }))
          .filter(item => {
            const provinciaResultado = String(
              item.resultado.address?.countrySubdivisionName ||
              item.resultado.address?.countrySubdivision ||
              ""
            ).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
            return !provinciaEsperada ||
              !provinciaResultado ||
              provinciaResultado.includes(provinciaEsperada);
          })
          .sort((a, b) => b.puntos - a.puntos);

      const mejor = candidatos[0];

      if (!mejor || mejor.puntos < 10) {
        base.validada = false;
        base.revisionManual = true;
        pendientes++;
        console.log("   ⚠️ Resultado descartado por baja coincidencia geográfica");
        continue;
      }

      const posicion =
        mejor.resultado.position;

      if (
        !posicion ||
        !coordenadasValidas(
          posicion.lat,
          posicion.lon
        )
      ) {
        base.validada = false;
        base.revisionManual = true;

        pendientes++;

        console.log(
          "   ⚠️ Resultado sin coordenadas válidas"
        );

        continue;
      }

      /*
       * Las coordenadas quedan cargadas en la fuente real que usa
       * server.js: data/bases.json.
       */

      base.lat = Number(posicion.lat);
      base.lng = Number(posicion.lon);

      base.fuenteCoordenadas =
        "TOMTOM";

      base.tomtomScore =
        mejor.resultado.score || null;

      base.tomtomTipo =
        mejor.resultado.type || null;

      base.tomtomVersion = 2;

      base.tomtomDireccion =
        mejor.resultado.address
          ?.freeformAddress || "";

      base.validada = true;
      base.revisionManual = false;
      base.updatedAt = new Date().toISOString();
      encontradas++;

      console.log(
        "   📍 TomTom propone:",
        posicion.lat,
        posicion.lon
      );

      console.log(
        "   📌",
        base.tomtomDireccion
      );

    } catch (error) {
      base.validada = false;
      base.revisionManual = true;

      pendientes++;

      console.log(
        "   ❌ Error TomTom:",
        error.message
      );
    }

    /*
     * Evitamos disparar todas las
     * consultas simultáneamente.
     */
    await sleep(250);
  }

  fs.writeFileSync(
    ARCHIVO,
    JSON.stringify(
      Array.isArray(raw) ? bases : { ...raw, bases },
      null,
      2
    )
  );

  console.log("");
  console.log(
    "===================================="
  );
  console.log(
    " RESULTADO"
  );
  console.log(
    "===================================="
  );

  console.log(
    "✅ Coordenadas existentes:",
    correctas
  );

  console.log(
    "📍 Encontradas por TomTom:",
    encontradas
  );

  console.log(
    "⚠️ Pendientes:",
    pendientes
  );

  console.log("");
  console.log(
    "Backup:",
    BACKUP
  );

  console.log(
    "Archivo actualizado:",
    ARCHIVO
  );

  console.log("");
}

main().catch(error => {
  console.error(
    "❌ ERROR:",
    error
  );

  process.exit(1);
});
