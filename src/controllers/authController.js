const jwt = require('jsonwebtoken');

const SECRET = "asistir24_secret";

const adminUser = {
  username: "admin",
  password: "1234"
};

exports.login = (req, res) => {
  const { username, password } = req.body;

  if (username === adminUser.username && password === adminUser.password) {
    const token = jwt.sign({ username }, SECRET, { expiresIn: '2h' });
    return res.json({ token });
  }

  res.status(401).json({ error: "Credenciales incorrectas" });
};
