const jwt = require('jsonwebtoken');

const SECRET = "A24_2026_x9Kp!SecureToken#";

module.exports = (req, res, next) => {
  const token = req.headers['authorization'];

  if (!token) return res.status(403).json({ error: "No autorizado" });

  try {
    const decoded = jwt.verify(token, SECRET);
    req.user = decoded;
    next();
  } catch {
    res.status(401).json({ error: "Token inválido" });
  }
};
