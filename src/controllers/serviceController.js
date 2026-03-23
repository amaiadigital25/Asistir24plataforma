const { readDB, writeDB } = require('../config/db');

exports.createService = (req, res) => {
  const { name, description } = req.body;

  const db = readDB();

  const newService = {
    id: Date.now(),
    name,
    description
  };

  db.services.push(newService);
  writeDB(db);

  res.json({ message: "Servicio creado" });
};

exports.getServices = (req, res) => {
  const db = readDB();
  res.json(db.services);
};
