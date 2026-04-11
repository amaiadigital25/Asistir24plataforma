const express = require("express");
const app = express();
const cors = require("cors");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");

app.use(express.json());
app.use(cors());

const PORT = process.env.PORT || 3030;
const SECRET = "asistir24-secret";

// 🗄️ Base de datos temporal
let users = [];

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
// 🧪 TEST ROOT (IMPORTANTE PARA RAILWAY)
// ===============================
app.get("/", (req, res) => {
  res.send("API Asistir24 funcionando 🚀");
});

// ===============================
// 📝 REGISTER
// ===============================
app.post("/api/register", async (req, res) => {
  const { user, password, role } = req.body;

  if (!user || !password) {
    return res.status(400).json({ error: "Faltan datos" });
  }

  const exist = users.find(u => u.user === user);
  if (exist) {
    return res.status(400).json({ error: "Usuario ya existe" });
  }

  const hash = await bcrypt.hash(password, 10);

  users.push({
    id: Date.now(),
    user,
    password: hash,
    role: role || "user"
  });

  res.json({ success: true });
});

// ===============================
// 🔐 LOGIN
// ===============================
app.post("/api/login", async (req, res) => {
  const { user, password } = req.body;

  const found = users.find(u => u.user === user);

  if (!found) {
    return res.status(401).json({ error: "Usuario no existe" });
  }

  const valid = await bcrypt.compare(password, found.password);

  if (!valid) {
    return res.status(401).json({ error: "Contraseña incorrecta" });
  }

  const token = jwt.sign(
    { id: found.id, role: found.role },
    SECRET,
    { expiresIn: "2h" }
  );

  res.json({
    token,
    role: found.role
  });
});

// ===============================
// 👥 USERS CRUD (PROTEGIDO)
// ===============================

// Obtener usuarios
app.get("/api/users", auth, (req, res) => {
  res.json(users.map(u => ({
    id: u.id,
    user: u.user,
    role: u.role
  })));
});

// Crear usuario
app.post("/api/users", auth, async (req, res) => {
  const { user, password, role } = req.body;

  if (!user || !password) {
    return res.status(400).json({ error: "Faltan datos" });
  }

  const hash = await bcrypt.hash(password, 10);

  users.push({
    id: Date.now(),
    user,
    password: hash,
    role: role || "user"
  });

  res.json({ success: true });
});

// Editar usuario
app.put("/api/users/:id", auth, (req, res) => {
  const id = parseInt(req.params.id);
  const { user } = req.body;

  users = users.map(u =>
    u.id === id ? { ...u, user } : u
  );

  res.json({ success: true });
});

// Eliminar usuario
app.delete("/api/users/:id", auth, (req, res) => {
  const id = parseInt(req.params.id);

  users = users.filter(u => u.id !== id);

  res.json({ success: true });
});

// ===============================
app.listen(PORT, () => {
  console.log("Servidor corriendo en puerto " + PORT);
});
