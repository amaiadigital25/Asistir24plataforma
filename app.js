function login() {
  const user = document.getElementById("user").value;
  const role = document.getElementById("role").value;

  if (!user) {
    alert("Ingresá usuario");
    return;
  }

  if (role === "admin") {
    window.location.href = "admin.html";
  } else if (role === "prestador") {
    window.location.href = "prestador.html";
  } else {
    window.location.href = "cliente.html";
  }
}
