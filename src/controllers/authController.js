const jwt = require('jsonwebtoken');
const { readDB } = require('../config/db');

const SECRET = "asistir24_secret";

exports.login = (req, res) => {
  const { username, password } = req.body;

  const db = readDB();

  const user = db.users.find(
    u => u.username === username && u.password === password
  );

  if (user) {
    const token = jwt.sign({ id: user.id, role: user.role }, SECRET, { expiresIn: '2h' });
    return res.json({ token });
  }

  res.status(401).json({ error: "Credenciales incorrectas" });
};
