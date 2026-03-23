const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');

const dbPath = path.join(__dirname, 'database.json'); // ajustá la ruta si es otra
const password = '1234'; // contraseña deseada

const hashed = bcrypt.hashSync(password, 10);

const adminUser = {
  id: 1,
  username: 'admin',
  password: hashed,
  role: 'admin'
};

// Si ya existe database.json, mantené usuarios y servicios
let db = { users: [], services: [] };
if (fs.existsSync(dbPath)) {
  db = JSON.parse(fs.readFileSync(dbPath));
}

db.users = [adminUser];
fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));

console.log('Admin creado ✔', adminUser);
