const token = localStorage.getItem('token');

if (!token) {
  window.location.href = "/login";
}

// ejemplo de uso protegido
async function testAPI() {
  const res = await fetch('/api/auth/test', {
    headers: {
      'Authorization': token
    }
  });

  const data = await res.json();
  console.log(data);
}

function logout() {
  localStorage.removeItem('token');
  window.location.href = "/login";
}
