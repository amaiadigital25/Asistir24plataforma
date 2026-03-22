 const API = "https://TU-URL.railway.app/api";

export async function getUsers() {
  const res = await fetch(API + "/users");
  return res.json();
}

export async function createUser(data) {
  await fetch(API + "/users", {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify(data)
  });
}

export async function deleteUser(id) {
  await fetch(API + "/users/" + id, { method: "DELETE" });
}

export async function updateUser(id, data) {
  await fetch(API + "/users/" + id, {
    method: "PUT",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify(data)
  });
}
