function login() {
  const user = document.getElementById("user").value;
  const pass = document.getElementById("pass").value;

  if (user === "admin" && pass === "1234") {
    window.location.href = "admin.html";
  } else {
    alert("Datos incorrectos");
  }
}
