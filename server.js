const express = require('express');
const path = require('path');

const app = express();

// middlewares
app.use(express.json());

// rutas backend
const authRoutes = require('./src/routes/authRoutes');
app.use('/api/auth', authRoutes);

// frontend
app.use(express.static(path.join(__dirname, 'public/frontend')));

// rutas directas
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/frontend', 'index.html'));
});

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/frontend', 'login.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/frontend', 'admin.html'));
});

// fallback
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public/frontend', 'index.html'));
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, '0.0.0.0', () => {
  console.log('Servidor corriendo en puerto ' + PORT);
});
