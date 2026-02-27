const db = require("./db");

console.log("Limpando banco...");

try { db.prepare("DELETE FROM movimentacoes").run(); } catch {}
try { db.prepare("DELETE FROM transacoes").run(); } catch {}
try { db.prepare("DELETE FROM recorrencias").run(); } catch {}
try { db.prepare("DELETE FROM cartoes").run(); } catch {}
try { db.prepare("DELETE FROM categorias").run(); } catch {}

try { db.prepare("DELETE FROM sqlite_sequence").run(); } catch {}

console.log("Banco zerado!");