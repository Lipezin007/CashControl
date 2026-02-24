const express = require("express");
const path = require("path");

const queries = require("./queries");

const app = express();

app.use(express.json());

app.use(express.static(path.join(__dirname, "..", "src")));

app.get("/api/categorias", (req, res) => {
  res.json(queries.getCategorias());
});

app.post("/api/categorias", (req, res) => {
  const { nome } = req.body;
  res.json(queries.addCategoria(nome));
});

app.get("/api/transacoes", (req, res) => {
  const mes = req.query.mes || null;
  res.json(queries.getTransacoes(mes));
});

app.get("/api/movimentacoes", (req, res) => {
  const mes = req.query.mes; // YYYY-MM
  if (!mes || !/^\d{4}-\d{2}$/.test(mes)) {
    return res.status(400).json({ ok:false, erro:"mes inválido (use YYYY-MM)" });
  }
  res.json(queries.getMovimentacoes(mes));
});

app.get("/api/relatorio-categorias", (req, res) => {
  const mes = req.query.mes; // YYYY-MM
  if (!mes || !/^\d{4}-\d{2}$/.test(mes)) {
    return res.status(400).json({ ok:false, erro:"mes inválido (use YYYY-MM)" });
  }
  res.json(queries.relatorioPorCategoria(mes));
});

app.get("/api/previsao", (req, res) => {
  const mes = req.query.mes;
  if (!mes || !/^\d{4}-\d{2}$/.test(mes)) {
    return res.status(400).json({ ok:false, erro:"mes inválido (use YYYY-MM)" });
  }
  res.json(queries.getPrevisaoMes(mes));
});

app.post("/api/transacoes", (req, res) => {
  const { descricao, valor, tipo, categoria_id, data } = req.body;
  res.json(
    queries.inserirTransacao(
      descricao,
      valor,
      tipo,
      categoria_id,
      data
    )
  );
});

app.delete("/api/transacoes/:id", (req, res) => {
  res.json(queries.deleteTransacao(req.params.id));
});

app.put("/api/transacoes/:id", (req, res) => {
  const { descricao, valor, tipo, categoria_id, data } = req.body;
  res.json(
    queries.updateTransacao(
      req.params.id,
      descricao,
      valor,
      tipo,
      categoria_id,
      data
    )
  );
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
  const mes = req.query.mes || null;
  res.json(queries.getResumo(mes));
});

app.listen(3000, () => {
  console.log("Servidor rodando em http://localhost:3000");
});