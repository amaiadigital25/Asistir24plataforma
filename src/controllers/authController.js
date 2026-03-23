const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { readDB } = require('../config/db');

const SECRET = "A24_2026_x9Kp!SecureToken#";

exports.login = (req, res) => {
  const { username, password } = req.body;

  const db = readDB();
  const user = db.users.find(u => u.username === username);

  if (!user) return res.status(401).json({ error: "Usuario no existe" });

  const valid = bcrypt.compareSync(password, user.password);

  if (!valid) return res.status(401).json({ error: "Contraseña incorrecta" });

  const token = jwt.sign(
    { id: user.id, role: user.role },
    SECRET,
    { expiresIn: '2h' }
  );

  res.json({ token });
};
