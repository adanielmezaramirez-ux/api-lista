// src/test-db.js
const db = require("./config/db");

async function test() {
  try {
    const [rows] = await db.execute("SELECT id, username FROM mdlwa_user LIMIT 5");
    console.log("Conexión exitosa:", rows);
  } catch (err) {
    console.error("Error DB:", err);
  }
}

test();