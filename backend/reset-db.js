const db = require("./db");

console.log("Limpando banco...");

// Reset bruto pra ambiente de teste/dev.
// Cada try/catch ignora tabela ausente pra não travar em bases antigas.

try { db.prepare("DELETE FROM movimentacoes").run(); } catch {}
try { db.prepare("DELETE FROM transacoes").run(); } catch {}
try { db.prepare("DELETE FROM recorrencias").run(); } catch {}
try { db.prepare("DELETE FROM compras_cartao").run(); } catch {}
try { db.prepare("DELETE FROM parcelas_cartao").run(); } catch {}
try { db.prepare("DELETE FROM sqlite_sequence").run(); } catch {}
try { db.prepare("DELETE FROM metas_categoria").run(); } catch {}
try { db.prepare("DELETE FROM faturas").run(); } catch {}
try { db.prepare("DELETE FROM categorias").run(); } catch {}
try { db.prepare("DELETE FROM usuarios").run(); } catch {}


console.log("Banco zerado!");