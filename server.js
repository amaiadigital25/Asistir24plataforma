const express = require("express");
const app = express();
const cors = require("cors");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");

app.use(express.json());
app.use(cors({ origin: "*" }));

const PORT = process.env.PORT || 3000;
const SECRET = "asistir24-secret";

// 🗄️ Base de datos temporal
let users = [];
let emergencias = [];

// ===============================
// 🔐 Middleware
// ===============================
function auth(req, res, next) {
  const token = req.headers.authorization;

  if (!token) {
    return res.status(401).json({ error: "No autorizado" });
  }

  try {
    const decoded = jwt.verify(token, SECRET);
    req.user = decoded;
    next();
  } catch {
    res.status(401).json({ error: "Token inválido" });
  }
}

// ===============================
// 🧪 ROOT
// ===============================
app.get("/", (req, res) => {
  res.send("API Asistir24 funcionando 🚀");
});

// ===============================
// 👤 ADMIN POR DEFECTO
// ===============================
(async () => {
  const hash = await bcrypt.hash("1234", 10);
  users.push({
    id: 1,
    user: "admin",
    password: hash,
    role: "admin"
  });
})();

// ===============================
// 🔐 LOGIN (COMPATIBLE CON FRONTEND)
// ===============================
app.post("/login", async (req, res) => {
  const { username, password } = req.body;

  const found = users.find(u => u.user === username);

  if (!found) {
    return res.json({ success: false });
  }

  const valid = await bcrypt.compare(password, found.password);

  if (!valid) {
    return res.json({ success: false });
  }

  const token = jwt.sign(
    { id: found.id, role: found.role },
    SECRET
  );

  res.json({
    success: true,
    token,
    role: found.role
  });
});

// ===============================
// 🚨 GUARDAR EMERGENCIA
// ===============================
app.post("/emergencia", (req, res) => {
  const { patente, modelo, color, ubicacion } = req.body;

  const nueva = {
    id: Date.now(),
    patente,
    modelo,
    color,
    ubicacion,
    fecha: new Date()
  };

  emergencias.unshift(nueva);

  res.json({ ok: true });
});

// ===============================
// 📡 VER EMERGENCIAS
// ===============================
app.get("/emergencias", (req, res) => {
  res.json(emergencias);
});

// ===============================
app.listen(PORT, () => {
  console.log("Servidor corriendo en puerto " + PORT);
});
