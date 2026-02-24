const path = require("path");
const Database = require("better-sqlite3");

const dbPath = path.join(__dirname, "..", "database", "database.db");

const db = new Database(dbPath);

db.pragma("foreign_keys = ON");

module.exports = db;