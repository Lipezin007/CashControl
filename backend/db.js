const path = require("path");
const Database = require("better-sqlite3");

// Banco SQLite único da aplicação.
// Deixamos esse caminho centralizado pra não espalhar hardcode de pasta.
const dbPath = path.join(__dirname, "..", "database", "database.db");

const db = new Database(dbPath);

// Garante que constraints de FK sejam realmente aplicadas no SQLite.
db.pragma("foreign_keys = ON");

module.exports = db;