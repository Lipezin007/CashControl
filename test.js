const db = require("./backend/db");

// Script de teste rápido pra brincar no banco sem subir a aplicação toda.
// Serve mais como smoke test local.

// ver categorias
console.log("Categorias:");
console.log(db.getCategorias());

// inserir teste
db.inserirTransacao(
    "Compra mercado",
    50,
    "saida",
    1,
    "2026-02-23"
);

// listar transações
console.log("Transações:");
console.log(db.getTransacoes());