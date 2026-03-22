onst express = require('express');
const path = require('path');

const app = express();

// servir frontend
app.use(express.static(path.join(__dirname, 'public')));

// ruta API
app.get('/api', (req, res) => {
  res.send('API Asistir24 funcionando 🚀');
});

// home
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('Servidor corriendo en puerto ' + PORT);
});
