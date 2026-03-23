const bcrypt = require('bcryptjs');
const { readDB, writeDB } = require('../config/db');

// ===============================
// CREAR USUARIO
// ===============================
exports.createUser = (req, res) => {
  const { username, password, role } = req.body;

  const db = readDB();

  // validar si ya existe
  if (db.users.find(u => u.username === username)) {
    return res.status(400).json({ error: "Usuario ya existe" });
  }

  // encriptar contraseña
  const hashedPassword = bcrypt.hashSync(password, 10);

  const newUser = {
    id: Date.now(),
    username,
    password: hashedPassword,
    role
  };

  db.users.push(newUser);
  writeDB(db);

  res.json({ message: "Usuario creado correctamente" });
};

// ===============================
// OBTENER USUARIOS
// ===============================
exports.getUsers = (req, res) => {
  const db = readDB();
  res.json(db.users);
};

// ===============================
// ELIMINAR USUARIO
// ===============================
exports.deleteUser = (req, res) => {
  const id = parseInt(req.params.id);

  const db = readDB();

  const existe = db.users.find(u => u.id === id);
  if (!existe) {
    return res.status(404).json({ error: "Usuario no encontrado" });
  }

  db.users = db.users.filter(u => u.id !== id);
  writeDB(db);

  res.json({ message: "Usuario eliminado" });
};
