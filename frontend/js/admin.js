const token = localStorage.getItem('token');

if (!token) {
  window.location.href = "/login";
}

// -------- USUARIOS --------

async function crearUsuario() {
  const username = document.getElementById('user').value;
  const password = document.getElementById('pass').value;
  const role = document.getElementById('role').value;

  await fetch('/api/users', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': token
    },
    body: JSON.stringify({ username, password, role })
  });

  cargarUsuarios();
}

async function cargarUsuarios() {
  const res = await fetch('/api/users', {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': token
    }
  });

  const users = await res.json();

  const lista = document.getElementById('lista');
  lista.innerHTML = "";

  users.forEach(u => {
    const li = document.createElement('li');
    li.innerHTML = `
      ${u.username} - ${u.role}
      <button onclick="eliminarUsuario(${u.id})">X</button>
    `;
    lista.appendChild(li);
  });
}

async function eliminarUsuario(id) {
  await fetch('/api/users/' + id, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': token
    }
  });

  cargarUsuarios();
}

// -------- SERVICIOS --------

async function crearServicio() {
  const name = document.getElementById('servicio').value;
  const description = document.getElementById('desc').value;

  await fetch('/api/services', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': token
    },
    body: JSON.stringify({ name, description })
  });

  cargarServicios();
}

async function cargarServicios() {
  const res = await fetch('/api/services', {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': token
    }
  });

  const data = await res.json();

  const lista = document.getElementById('servicios');
  lista.innerHTML = "";

  data.forEach(s => {
    const li = document.createElement('li');
    li.textContent = s.name + " - " + s.description;
    lista.appendChild(li);
  });
}

// -------- GENERAL --------

function logout() {
  localStorage.removeItem('token');
  window.location.href = "/login";
}

// cargar todo
cargarUsuarios();
cargarServicios();
