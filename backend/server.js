const express = require("express");
const db = require("./db");
const path = require("path");

const queries = require("./queries"); // importa todas as funções

const app = express();
function garantirCategoriasPadrao(){

  const qtd = db.prepare(`
    SELECT COUNT(*) as total FROM categorias
  `).get().total;

  if(qtd === 0){

    const categorias = [
      "Alimentação",
      "Transporte",
      "Moradia",
      "Lazer",
      "Saúde",
      "Educação",
      "Salário",
      "Outros"
    ];

    const insert = db.prepare(`
      INSERT INTO categorias (nome) VALUES (?)
    `);

    for(const c of categorias){
      insert.run(c);
    }

    console.log("Categorias padrão criadas!");
  }

}
app.use(express.json());

app.use(express.static(path.join(__dirname, "..", "src")));

app.get("/api/movimentacoes", (req, res) => {
  const mes = req.query.mes;
  if (!mes || !/^\d{4}-\d{2}$/.test(mes)) return res.status(400).json({ ok:false, erro:"mes inválido" });
  res.json(queries.getMovimentacoes(mes));
});

app.post("/api/movimentacoes", (req, res) => {
  res.json(queries.criarMovimentacao(req.body));
});

app.put("/api/movimentacoes/:id", (req, res) => {
  res.json(queries.editarMovimentacao(req.params.id, req.body));
});

app.delete("/api/movimentacoes/:id", (req, res) => {
  res.json(queries.deletarMovimentacao(req.params.id));
});

app.get("/api/categorias", (req,res)=> res.json(queries.getCategorias()));

app.get("/api/categorias", (req, res) => {
  res.json(queries.getCategorias());
});

app.post("/api/categorias", (req, res) => {
  const { nome } = req.body;
  res.json(queries.addCategoria(nome));
});

app.get("/api/movimentacoes", (req, res) => {
  const mes = req.query.mes || null;
  res.json(queries.getmovimentacoes(mes));
});

app.get("/api/movimentacoes", (req, res) => {
  const mes = req.query.mes; // YYYY-MM
  if (!mes || !/^\d{4}-\d{2}$/.test(mes)) {
    return res.status(400).json({ ok:false, erro:"mes inválido (use YYYY-MM)" });
  }
  res.json(queries.getMovimentacoes(mes));
});

app.get("/api/relatorio-categorias", (req, res) => {
  const mes = req.query.mes;
  if (!mes || !/^\d{4}-\d{2}$/.test(mes)) {
    return res.status(400).json({ ok:false, erro:"mes inválido (use YYYY-MM)" });
  }
  res.json(queries.getRelatorioCategorias(mes));
});

app.get("/api/previsao", (req, res) => {
  const mes = req.query.mes;
  if (!mes || !/^\d{4}-\d{2}$/.test(mes)) {
    return res.status(400).json({ ok:false, erro:"mes inválido (use YYYY-MM)" });
  }
  res.json(queries.getPrevisao(mes));
});

app.get("/api/movimentacoes", (req, res) => {
  const mes = req.query.mes;
  if (!mes || !/^\d{4}-\d{2}$/.test(mes)) return res.status(400).json({ ok:false, erro:"mes inválido" });
  res.json(queries.getMovimentacoes(mes));
});

app.post("/api/movimentacoes", (req, res) => {
  res.json(queries.criarMovimentacao(req.body));
});

app.put("/api/movimentacoes/:id", (req, res) => {
  res.json(queries.editarMovimentacao(req.params.id, req.body));
});

app.delete("/api/movimentacoes/:id", (req, res) => {
  res.json(queries.deletarMovimentacao(req.params.id));
});

// ===== CARTÃO =====
app.get("/api/cartoes", (req, res) => res.json(queries.getCartoes()));
app.post("/api/cartoes", (req, res) => {
  const { nome, limite, dia_fechamento, dia_vencimento } = req.body;
  res.json(queries.addCartao(nome, limite, dia_fechamento, dia_vencimento));
});

app.post("/api/cartoes/compra", (req, res) => {
  res.json(queries.criarCompraCartao(req.body));
});

app.get("/api/cartoes/:id/fatura", (req, res) => {
  const mes = req.query.mes;
  if (!mes || !/^\d{4}-\d{2}$/.test(mes)) return res.status(400).json({ ok:false, erro:"mes inválido" });
  res.json(queries.getFaturaCartao(req.params.id, mes));
});

app.patch("/api/cartoes/parcela/:id/status", (req, res) => {
  const { status } = req.body;
  res.json(queries.setParcelaStatus(req.params.id, status));
});

app.delete("/api/cartoes/compra/:id", (req, res) => {
  res.json(queries.deleteCompraCartao(req.params.id));
});

app.get("/api/recorrencias", (req, res) => {
  res.json(queries.getRecorrencias());
});

app.post("/api/recorrencias", (req, res) => {
  const { descricao, valor, tipo, categoria_id, dia_mes } = req.body;
  res.json(queries.addRecorrencia(descricao, Number(valor), tipo, categoria_id ?? null, Number(dia_mes)));
});

app.patch("/api/recorrencias/:id/ativo", (req, res) => {
  const { ativo } = req.body;
  res.json(queries.setRecorrenciaAtiva(req.params.id, !!ativo));
});

app.get("/api/recorrencias/resumo", (req, res) => {
  res.json(queries.resumoRecorrencias());
});

app.delete("/api/recorrencias/:id", (req, res) => {
  res.json(queries.deleteRecorrencia(req.params.id));
});

app.put("/api/recorrencias/:id", (req, res) => {
  const { descricao, valor, tipo, categoria_id, dia_mes, ativo } = req.body;
  res.json(
    queries.updateRecorrencia(
      req.params.id,
      descricao,
      Number(valor),
      tipo,
      categoria_id ?? null,
      Number(dia_mes),
      !!ativo
    )
  );
});

// gerar transações do mês (ex: 2026-03)
app.post("/api/recorrencias/gerar", (req, res) => {
  const mes = req.query.mes;
  if (!mes || !/^\d{4}-\d{2}$/.test(mes)) return res.status(400).json({ ok:false, erro:"mes inválido (use YYYY-MM)" });
  res.json(queries.gerarRecorrencias(mes));
});

app.get("/api/resumo", (req, res) => {
  const mes = req.query.mes;
  const dados = queries.getResumo(mes);
  res.json(dados);
});

app.post("/api/cartao/compra", (req,res)=>{

  const r = queries.criarCompraCartao(req.body);

  res.json(r);

});

//temporarios

app.get("/debug-db", (req, res) => {

  const rows = db.prepare(`
    SELECT id, descricao, valor, tipo, data
    FROM movimentacoes
    ORDER BY data
  `).all();

  res.json(rows);

});

app.get("/debug", (req,res)=>{

  const rows = db.prepare(`
    SELECT id, descricao, valor, tipo, data
    FROM movimentacoes
  `).all();

  res.json(rows);

});

garantirCategoriasPadrao();
app.listen(3000, () => {
  console.log("🚀 Servidor rodando em http://localhost:3000");
});