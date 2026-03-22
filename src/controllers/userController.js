const { readDB, writeDB } = require('../config/db');

exports.createUser = (req, res) => {
  const { username, password, role } = req.body;

  const db = readDB();

  if (db.users.find(u => u.username === username)) {
    return res.status(400).json({ error: "Usuario existe" });
  }

  const newUser = {
    id: Date.now(),
    username,
    password,
    role
  };

  db.users.push(newUser);
  writeDB(db);

  res.json({ message: "Usuario creado" });
};

exports.getUsers = (req, res) => {
  const db = readDB();
  res.json(db.users);
};
