const db = require("./backend/db");

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