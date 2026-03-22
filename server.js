const express = require('express');
const path = require('path');

const app = express();

// 🔥 IMPORTANTE: apuntamos a public/frontend
app.use(express.static(path.join(__dirname, 'public/frontend')));

// ruta principal
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/frontend', 'index.html'));
});

// fallback (evita Not Found)
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public/frontend', 'index.html'));
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, '0.0.0.0', () => {
  console.log('Servidor corriendo en puerto ' + PORT);
});
