const express = require("express");
const path = require("path");

const queries = require("./queries");

const app = express();

app.use(express.json());

app.use(express.static(path.join(__dirname, "..", "src")));


// categorias
app.get("/api/categorias", (req,res)=>{
    res.json(queries.getCategorias());
});

app.post("/api/categorias", (req,res)=>{
    const {nome} = req.body;
    res.json(queries.addCategoria(nome));
});


// transacoes
app.get("/api/transacoes", (req, res) => {
  const DEBUG = process.env.DEBUG === "1";

app.get("/api/transacoes", (req, res) => {
  if (DEBUG) console.log("QUERY:", req.query);
  const mes = req.query.mes || null;
  res.json(queries.getTransacoes(mes));
});
  const mes = req.query.mes || null;
  res.json(queries.getTransacoes(mes));
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

app.post("/api/transacoes",(req,res)=>{

    const {descricao,valor,tipo,categoria_id,data} = req.body;

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

app.delete("/api/transacoes/:id",(req,res)=>{
    res.json(queries.deleteTransacao(req.params.id));
});

app.put("/api/transacoes/:id",(req,res)=>{

    const {descricao,valor,tipo,categoria_id,data} = req.body;

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

// recorrencias
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

// gerar transações do mês (ex: 2026-03)
app.post("/api/recorrencias/gerar", (req, res) => {
  const mes = req.query.mes; // "YYYY-MM"
  if (!mes || !/^\d{4}-\d{2}$/.test(mes)) return res.status(400).json({ ok:false, erro:"mes inválido (use YYYY-MM)" });
  res.json(queries.gerarRecorrencias(mes));
});

// resumo financeiro
app.get("/api/resumo",(req,res)=>{
    res.json(queries.getResumo());
});

app.get("/api/resumo", (req, res) => {
  const mes = req.query.mes || null; // opcional: YYYY-MM
  res.json(queries.getResumo(mes));
});

app.listen(3000, ()=>{
    console.log("Servidor rodando em http://localhost:3000");
});