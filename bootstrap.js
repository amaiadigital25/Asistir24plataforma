const fs = require("fs");
const path = require("path");
const Module = require("module");

const dataFile = process.env.DATA_FILE || path.join(__dirname, "database.json");
const legacyFile = path.join(__dirname, "database.json");

function initializePersistentData() {
  if (fs.existsSync(dataFile)) return;

  fs.mkdirSync(path.dirname(dataFile), { recursive: true });

  const seed = process.env.DATABASE_SEED_BASE64;
  if (seed) {
    try {
      const decoded = Buffer.from(seed, "base64").toString("utf8");
      const parsed = JSON.parse(decoded);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("seed invalido");
      }
      fs.writeFileSync(dataFile, JSON.stringify(parsed, null, 2));
      console.log(`[Asistir24] Base persistente inicializada desde respaldo en ${dataFile}`);
      return;
    } catch (error) {
      console.error("[Asistir24] No se pudo restaurar DATABASE_SEED_BASE64:", error.message);
    }
  }

  if (dataFile !== legacyFile && fs.existsSync(legacyFile)) {
    fs.copyFileSync(legacyFile, dataFile);
    console.log(`[Asistir24] Base persistente inicializada desde ${legacyFile}`);
    return;
  }

  fs.writeFileSync(dataFile, JSON.stringify({ users: [], services: [], cotizaciones: [] }, null, 2));
  console.log(`[Asistir24] Base persistente nueva creada en ${dataFile}`);
}

function loadServerWithMailBodyFix() {
  const serverPath = require.resolve("./server");
  const source = fs.readFileSync(serverPath, "utf8");
  const oldLine = 'if (part) return decodeBase64Url(part.body.data).replace(/<[^>]+>/g, " ");';
  const newLine = 'if (part) { const decoded = decodeBase64Url(part.body.data).replace(/<[^>]+>/g, " "); if (decoded.trim()) return decoded; }';
  const fixed = source.includes(oldLine) ? source.replace(oldLine, newLine) : source;
  const serverModule = new Module(serverPath, module);
  serverModule.filename = serverPath;
  serverModule.paths = Module._nodeModulePaths(path.dirname(serverPath));
  serverModule._compile(fixed, serverPath);
}

initializePersistentData();
loadServerWithMailBodyFix();
