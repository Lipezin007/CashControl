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
  if (!mes || !/^\d{4}-\d{2}$/.test(mes)) {
    return res.status(400).json({ ok:false, erro:"mes inválido (use YYYY-MM)" });
  }
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

app.get("/api/cartoes/:id/fatura", (req,res)=>{
  const cartaoId = Number(req.params.id);
  const mes = req.query.mes;
  res.json(queries.getFaturaCartao(cartaoId, mes));
});

app.post("/api/cartoes/:id/pagar", (req,res)=>{

  const cartao = Number(req.params.id);
  const mes = req.body.mes;

  const r = queries.pagarFatura(cartao, mes);

  res.json(r);

});

app.get("/api/dashboard", (req,res)=>{

  const mes = req.query.mes;

  const dados = queries.getDashboard(mes);

  res.json(dados);

});

app.post("/api/metas", (req,res)=>{
  const {categoria_id, valor_meta, mes} = req.body;
  res.json(queries.setMetaCategoria(categoria_id, valor_meta, mes));
});

app.get("/api/metas", (req,res)=>{
  const {mes} = req.query;
  const dados = queries.getMetasComGasto(mes);
  res.json(dados);
});

app.get("/api/cartoes/:id/controle", (req,res)=>{
  const cartaoId = Number(req.params.id);
  res.json(queries.getControleCartao(cartaoId));
});

app.get("/api/mensal", (req, res) => {
  const ano = req.query.ano;

  const dados = db.prepare(`
    SELECT 
      strftime('%m', data) as mes_num,
      SUM(CASE WHEN tipo = 'entrada' THEN valor ELSE 0 END) as entradas,
      SUM(CASE WHEN tipo = 'saida' THEN valor ELSE 0 END) as saidas
    FROM movimentacoes
    WHERE strftime('%Y', data) = ?
    GROUP BY mes_num
  `).all(ano);

  const mapa = {};
  dados.forEach(d => {
    mapa[d.mes_num] = {
      entradas: d.entradas || 0,
      saidas: d.saidas || 0
    };
  });

  const nomesMes = [
    "Jan","Fev","Mar","Abr","Mai","Jun",
    "Jul","Ago","Set","Out","Nov","Dez"
  ];

  const resultado = [];

  for (let i = 1; i <= 12; i++) {
    const mesNum = String(i).padStart(2, "0");

    resultado.push({
      mes: nomesMes[i - 1],
      entradas: mapa[mesNum]?.entradas || 0,
      saidas: mapa[mesNum]?.saidas || 0
    });
  }

  res.json(resultado);
});

const PDFDocument = require("pdfkit");

app.get("/api/relatorio-pdf", (req, res) => {
  const mes = req.query.mes;

  if (!mes) return res.status(400).send("Mês obrigatório");

  const movimentacoes = db.prepare(`
    SELECT * FROM movimentacoes
    WHERE strftime('%Y-%m', data) = ?
    ORDER BY data
  `).all(mes);

  const doc = new PDFDocument({ margin: 40 });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename=relatorio-${mes}.pdf`
  );

  doc.pipe(res);

  doc.fontSize(18).text(`Relatório Financeiro - ${mes}`, { align: "center" });
  doc.moveDown();

  let totalEntradas = 0;
  let totalSaidas = 0;

  movimentacoes.forEach((m) => {
    const linha = `${m.data} | ${m.descricao} | ${m.tipo.toUpperCase()} | R$ ${m.valor.toFixed(2)}`;
    doc.fontSize(10).text(linha);

    if (m.tipo === "entrada") totalEntradas += m.valor;
    if (m.tipo === "saida") totalSaidas += m.valor;
  });

  doc.moveDown();
  doc.fontSize(12).text("Resumo:", { underline: true });
  doc.text(`Entradas: R$ ${totalEntradas.toFixed(2)}`);
  doc.text(`Saídas: R$ ${totalSaidas.toFixed(2)}`);
  doc.text(`Saldo: R$ ${(totalEntradas - totalSaidas).toFixed(2)}`);

  doc.end();
});

//temporarios

garantirCategoriasPadrao();
app.listen(3000, () => {
  console.log("🚀 Servidor rodando em http://localhost:3000");
});