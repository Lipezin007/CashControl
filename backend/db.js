const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");

// Banco SQLite único da aplicação.
// Deixamos esse caminho centralizado pra não espalhar hardcode de pasta.
const bundledDbPath = path.join(__dirname, "..", "database", "database.db");

function resolveDbPath() {
	if (!process.versions.electron) {
		return bundledDbPath;
	}

	try {
		const { app } = require("electron");
		const userDataDir = app.getPath("userData");
		const runtimeDbDir = path.join(userDataDir, "database");
		const runtimeDbPath = path.join(runtimeDbDir, "database.db");

		if (!fs.existsSync(runtimeDbDir)) {
			fs.mkdirSync(runtimeDbDir, { recursive: true });
		}

		if (!fs.existsSync(runtimeDbPath) && fs.existsSync(bundledDbPath)) {
			fs.copyFileSync(bundledDbPath, runtimeDbPath);
		}

		return runtimeDbPath;
	} catch {
		return bundledDbPath;
	}
}

const dbPath = resolveDbPath();

const db = new Database(dbPath);

// Garante que constraints de FK sejam realmente aplicadas no SQLite.
db.pragma("foreign_keys = ON");

module.exports = db;