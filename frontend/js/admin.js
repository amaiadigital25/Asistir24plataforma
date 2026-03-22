import { getUsers, createUser, deleteUser, updateUser } from "./api.js";

let users = [];

async function loadUsers() {
  users = await getUsers();
  render();
}

function render() {
  const table = document.getElementById("tableBody");
  table.innerHTML = "";

  users.forEach(u => {
    table.innerHTML += `
      <tr>
        <td>${u.name}</td>
        <td>${u.type}</td>
        <td>
          <button onclick="editUser(${u.id})">Editar</button>
          <button onclick="removeUser(${u.id})">Eliminar</button>
        </td>
      </tr>
    `;
  });
}

window.addUser = async function () {
  const name = document.getElementById("newUser").value;
  const type = document.getElementById("type").value;

  await createUser({ name, type });
  loadUsers();
};

window.removeUser = async function (id) {
  await deleteUser(id);
  loadUsers();
};

window.editUser = async function (id) {
  const name = prompt("Nuevo nombre:");
  if (!name) return;

  await updateUser(id, { name });
  loadUsers();
};

loadUsers();
