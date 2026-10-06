require("dotenv").config();
const fs = require("fs");

const ARCHIVO = "./data/bases.json";
const BACKUP = "./data/bases.antes-geocodificacion.json";

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
  const partes = [
    base.direccion,
    base.base,
    base.localidad,
    base.zona,
    "Argentina"
  ];

  return partes
    .filter(x => x && x !== "-")
    .join(", ");
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

  const texto = JSON.stringify(
    resultado.address || {}
  ).toLowerCase();

  const localidad = String(
    base.base || base.localidad || ""
  ).toLowerCase();

  if (
    localidad &&
    texto.includes(localidad)
  ) {
    puntos += 5;
  }

  if (
    texto.includes("argentina")
  ) {
    puntos += 2;
  }

  if (
    resultado.type === "Point Address"
  ) {
    puntos += 3;
  }

  if (
    resultado.type === "Address Range"
  ) {
    puntos += 2;
  }

  return puntos;
}

async function main() {
  if (!fs.existsSync(ARCHIVO)) {
    throw new Error(
      `No existe ${ARCHIVO}`
    );
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
      coordenadasValidas(
        base.lat,
        base.lon
      )
    ) {
      base.validada = true;
      base.fuenteCoordenadas =
        base.fuenteCoordenadas ||
        "CARGADA";

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

      const candidatos =
        data.results
          .map(r => ({
            resultado: r,
            puntos:
              puntajeResultado(
                r,
                base
              )
          }))
          .sort(
            (a, b) =>
              b.puntos - a.puntos
          );

      const mejor =
        candidatos[0];

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
