const express = require('express');
const path = require('path');

const app = express(); // 🔥 PRIMERO crear app

// middlewares
app.use(express.json());

// rutas
const authRoutes = require('./src/routes/authRoutes');
const userRoutes = require('./src/routes/userRoutes');
const serviceRoutes = require('./src/routes/serviceRoutes');

// usar rutas DESPUÉS de crear app
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/services', serviceRoutes);

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

const PORT = process.env.PORT || 3000;

app.listen(PORT, '0.0.0.0', () => {
  console.log('Servidor corriendo en puerto ' + PORT);
});
