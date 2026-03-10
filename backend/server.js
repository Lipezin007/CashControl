const express = require("express");
const db = require("./db");
require("./initDB");
garantirCategoriasPadrao();

const path = require("path");

const queries = require("./queries"); // importa todas as funções

const app = express();

const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const SECRET = "cashcontrol_super_secret";

app.use(express.json());

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

app.post("/api/register", async (req, res) => {
  const { nome, email, senha } = req.body;

  if (!nome || !email || !senha) {
    return res.status(400).json({ erro: "Preencha todos os campos" });
  }

  const hash = await bcrypt.hash(senha, 10);

  try {
    db.prepare(`
      INSERT INTO usuarios (nome, email, senha)
      VALUES (?, ?, ?)
    `).run(nome, email, hash);

    res.json({ ok: true });

  } catch {
    res.status(400).json({ erro: "Email já cadastrado" });
  }
});

app.post("/api/login", async (req, res) => {
  const { email, senha } = req.body;

  const user = db.prepare(`
    SELECT * FROM usuarios WHERE email = ?
  `).get(email);

  if (!user) {
    return res.status(400).json({ erro: "Usuário não encontrado" });
  }

  const senhaCorreta = await bcrypt.compare(senha, user.senha);

  if (!senhaCorreta) {
    return res.status(400).json({ erro: "Senha incorreta" });
  }

  const token = jwt.sign(
    { id: user.id, email: user.email },
    SECRET,
    { expiresIn: "7d" }
  );

  res.json({ token });
});

function auth(req, res, next) {

  let token;

  const header = req.headers.authorization;

  if (header) {
    token = header.split(" ")[1];
  } else if (req.query.token) {
    token = req.query.token;
  }

  if (!token) {
    return res.status(401).json({ erro: "Token não enviado" });
  }

  try {
    const decoded = jwt.verify(token, SECRET);
    req.user = decoded;
    next();
  } catch {
    res.status(403).json({ erro: "Token inválido" });
  }
}

app.use(express.static(path.join(__dirname, "public")));

app.use(express.static(path.join(__dirname, "..", "src")));


// Rotas protegidas por autenticação

app.get("/api/movimentacoes", auth, (req, res) => {

  const mes = req.query.mes;

  const mov = db.prepare(`
    SELECT
      id,
      data,
      descricao,
      valor,
      tipo,
      categoria_id,
      NULL as parcela_num,
      NULL as parcela_total
    FROM movimentacoes
    WHERE strftime('%Y-%m', data) = ?
  `).all(mes);

  const cartao = db.prepare(`
    SELECT
      pc.id,
      pc.mes_ref || '-01' as data,
      cc.descricao,
      pc.valor,
      'saida' as tipo,
      cc.categoria_id,
      pc.numero_parcela as parcela_num,
      pc.total_parcelas as parcela_total
    FROM parcelas_cartao pc
    JOIN compras_cartao cc ON cc.id = pc.compra_id
    WHERE pc.mes_ref = ?
    AND pc.status = 'aberta'
  `).all(mes);

  const resultado = [...mov, ...cartao].sort((a,b)=>b.data.localeCompare(a.data));

  res.json(resultado);

});



app.post("/api/movimentacoes", auth, (req, res) => {
  const userId = req.user.id;
  db.prepare(`
    INSERT INTO movimentacoes
    (descricao, valor, tipo, data, categoria_id, usuario_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    req.body.descricao,
    req.body.valor,
    req.body.tipo,
    req.body.data,
    req.body.categoria_id,
    userId
  );
  res.json({ ok: true });
});


app.put("/api/movimentacoes/:id", auth, (req, res) => {
  res.json(queries.editarMovimentacao(req.params.id, req.body));
});


app.delete("/api/movimentacoes/:id", auth, (req, res) => {
  res.json(queries.deletarMovimentacao(req.params.id));
});


app.get("/api/categorias", auth, (req,res)=> res.json(queries.getCategorias()));

app.get("/api/categorias", (req, res) => {
  res.json(queries.getCategorias());
});


app.post("/api/categorias", auth, (req, res) => {
  const { nome } = req.body;
  res.json(queries.addCategoria(nome));
});



app.get("/api/relatorio-categorias", auth, (req, res) => {
  const mes = req.query.mes;
  if (!mes || !/^\d{4}-\d{2}$/.test(mes)) {
    return res.status(400).json({ ok:false, erro:"mes inválido (use YYYY-MM)" });
  }
  res.json(queries.getRelatorioCategorias(mes));
});


app.get("/api/previsao", auth, (req, res) => {
  const mes = req.query.mes;
  if (!mes || !/^\d{4}-\d{2}$/.test(mes)) {
    return res.status(400).json({ ok:false, erro:"mes inválido (use YYYY-MM)" });
  }
  res.json(queries.getPrevisao(mes));
});


// ...rotas de movimentações já protegidas acima...

// ===== CARTÃO =====

app.get("/api/cartoes", auth, (req, res) => res.json(queries.getCartoes()));
app.post("/api/cartoes", auth, (req, res) => {
  const { nome, limite, dia_fechamento, dia_vencimento } = req.body;
  res.json(queries.addCartao(nome, limite, dia_fechamento, dia_vencimento));
});

app.post("/api/cartoes/compra", auth, (req, res) => {

  console.log("ROTA CARTAO CHAMADA");
  console.log(req.body);

  const r = queries.criarCompraCartao(req.body);

  console.log("RESULTADO:", r);

  res.json(r);
});

app.get("/api/cartoes/:id/fatura", auth, (req, res) => {
  const mes = req.query.mes;
  if (!mes || !/^\d{4}-\d{2}$/.test(mes)) return res.status(400).json({ ok:false, erro:"mes inválido" });
  res.json(queries.getFaturaCartao(req.params.id, mes));
});

app.patch("/api/cartoes/parcela/:id/status", auth, (req, res) => {
  const { status } = req.body;
  res.json(queries.setParcelaStatus(req.params.id, status));
});

app.delete("/api/cartoes/compra/:id", auth, (req, res) => {
  res.json(queries.deleteCompraCartao(req.params.id));
});


app.get("/api/recorrencias", auth, (req, res) => {
  res.json(queries.getRecorrencias());
});

app.post("/api/recorrencias", auth, (req, res) => {
  const { descricao, valor, tipo, categoria_id, dia_mes } = req.body;
  res.json(queries.addRecorrencia(descricao, Number(valor), tipo, categoria_id ?? null, Number(dia_mes)));
});

app.patch("/api/recorrencias/:id/ativo", auth, (req, res) => {
  const { ativo } = req.body;
  res.json(queries.setRecorrenciaAtiva(req.params.id, !!ativo));
});

app.get("/api/recorrencias/resumo", auth, (req, res) => {
  res.json(queries.resumoRecorrencias());
});

app.delete("/api/recorrencias/:id", auth, (req, res) => {
  res.json(queries.deleteRecorrencia(req.params.id));
});

app.put("/api/recorrencias/:id", auth, (req, res) => {
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

app.post("/api/recorrencias/gerar", auth, (req, res) => {
  const mes = req.query.mes;
  if (!mes || !/^\d{4}-\d{2}$/.test(mes)) return res.status(400).json({ ok:false, erro:"mes inválido (use YYYY-MM)" });
  res.json(queries.gerarRecorrencias(mes));
});


app.get("/api/resumo", auth, (req, res) => {
  const mes = req.query.mes;
  const dados = queries.getResumo(mes);
  res.json(dados);
});


app.post("/api/cartao/compra", auth, (req,res)=>{
  const r = queries.criarCompraCartao(req.body);
  res.json(r);
});


app.get("/api/cartoes/:id/fatura", auth, (req,res)=>{
  const cartaoId = Number(req.params.id);
  const mes = req.query.mes;
  res.json(queries.getFaturaCartao(cartaoId, mes));
});


app.post("/api/cartoes/:id/pagar", auth, (req,res)=>{
  const cartao = Number(req.params.id);
  const mes = req.body.mes;
  const r = queries.pagarFatura(cartao, mes);
  res.json(r);
});


app.get("/api/dashboard", auth, (req,res)=>{
  const mes = req.query.mes;
  const dados = queries.getDashboard(mes);
  res.json(dados);
});


app.post("/api/metas", auth, (req,res)=>{
  const {categoria_id, valor_meta, mes} = req.body;
  res.json(queries.setMetaCategoria(req.user.id, categoria_id, valor_meta, mes));
});


app.get("/api/metas", auth, (req,res)=>{
  const {mes} = req.query;
  const dados = queries.getMetasComGasto(mes);
  res.json(dados);
});


app.get("/api/cartoes/:id/controle", auth, (req,res)=>{
  const cartaoId = Number(req.params.id);
  res.json(queries.getControleCartao(cartaoId));
});


app.get("/api/mensal", auth, (req, res) => {
  const ano = req.query.ano;

  const dados = db.prepare(`
    SELECT
  mes_num,
  SUM(entradas) as entradas,
  SUM(saidas) as saidas
FROM (

  SELECT
    strftime('%m', data) as mes_num,
    CASE WHEN tipo='entrada' THEN valor ELSE 0 END as entradas,
    CASE WHEN tipo='saida' THEN valor ELSE 0 END as saidas
  FROM movimentacoes
  WHERE strftime('%Y', data)=?

  UNION ALL

  SELECT
    strftime('%m', mes_ref || '-01') as mes_num,
    0 as entradas,
    valor as saidas
  FROM parcelas_cartao

) 
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


app.get("/api/relatorio-pdf", auth, (req, res) => {
  const mes = req.query.mes;
  if (!mes) return res.status(400).send("Mês obrigatório");

  const movimentacoes = db.prepare(`
    SELECT data, descricao, tipo, valor
    FROM movimentacoes
    WHERE strftime('%Y-%m', data) = ?
    ORDER BY data
  `).all(mes);

  const PDFDocument = require("pdfkit");
  const doc = new PDFDocument({ margin: 50 });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename=relatorio-${mes}.pdf`
  );

  doc.pipe(res);

  /* ========= CABEÇALHO ========= */

  doc
    .fontSize(24)
    .fillColor("#0ea5e9")
    .text("CONTROLE FINANCEIRO", { align: "center" });

  doc.moveDown(0.3);

  doc
    .fontSize(14)
    .fillColor("gray")
    .text(`Relatório Mensal - ${mes}`, { align: "center" });

  doc.moveDown(2);

  /* ========= RESUMO ========= */

  let totalEntradas = 0;
  let totalSaidas = 0;

  movimentacoes.forEach(m => {
    if (m.tipo === "entrada") totalEntradas += m.valor;
    if (m.tipo === "saida") totalSaidas += m.valor;
  });

  const saldo = totalEntradas - totalSaidas;

  // Caixa visual
  const boxTop = doc.y;
  const boxHeight = 80;

  doc
    .rect(50, boxTop, 500, boxHeight)
    .fillOpacity(0.05)
    .fillAndStroke("#0ea5e9", "#0ea5e9");

  doc.fillOpacity(1);

  doc
    .fontSize(14)
    .fillColor("black")
    .text("Resumo do Mês", 60, boxTop + 10);

  doc
    .fillColor("green")
    .text(`Entradas: R$ ${totalEntradas.toFixed(2)}`, 60, boxTop + 30);

  doc
    .fillColor("red")
    .text(`Saídas: R$ ${totalSaidas.toFixed(2)}`, 220, boxTop + 30);

  doc
    .fillColor("#0ea5e9")
    .text(`Saldo: R$ ${saldo.toFixed(2)}`, 380, boxTop + 30);

  doc.moveDown(4);

  /* ========= TABELA ========= */

  doc
    .fontSize(14)
    .fillColor("black")
    .text("Movimentações", { underline: true });

  doc.moveDown(1);

  // Cabeçalho da tabela
  doc.fontSize(11).fillColor("black");

  const startX = 50;

  doc.text("Data", startX);
  doc.text("Descrição", startX + 80);
  doc.text("Tipo", startX + 320);
  doc.text("Valor", startX + 380);

  doc.moveDown(0.3);
  doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
  doc.moveDown(0.8);

  movimentacoes.forEach(m => {
    const y = doc.y;

    doc.fillColor("black").text(m.data, startX, y);
    doc.text(m.descricao, startX + 80, y);

    doc
      .fillColor(m.tipo === "entrada" ? "green" : "red")
      .text(m.tipo.toUpperCase(), startX + 320, y);

    doc
      .text(`R$ ${m.valor.toFixed(2)}`, startX + 380, y);

    doc.moveDown(0.8);
  });

  doc.moveDown(2);

  /* ========= TOTAL FINAL ========= */

  doc
    .fontSize(16)
    .fillColor("#0ea5e9")
    .text(`Saldo Final do Mês: R$ ${saldo.toFixed(2)}`, {
      align: "right"
    });

  doc.moveDown(2);

  /* ========= RODAPÉ ========= */

  doc
    .fontSize(9)
    .fillColor("gray")
    .text(
      "Documento gerado automaticamente pelo sistema Cash Control",
      { align: "center" }
    );

  doc.end();
});

app.get("/api/cartoes/compra/:id/parcelas", auth, (req,res)=>{
  const compraId = Number(req.params.id);

  const parcelas = db.prepare(`
    SELECT
      numero_parcela,
      total_parcelas,
      mes_ref,
      valor,
      status
    FROM parcelas_cartao
    WHERE compra_id = ?
    ORDER BY numero_parcela
  `).all(compraId);

  res.json(parcelas);
});

app.get("/api/cartoes/:id/previsao", auth, (req,res)=>{

  const cartaoId = Number(req.params.id);

  const dados = queries.getPrevisaoCartao(cartaoId);

  res.json(dados);

});

//temporarios

garantirCategoriasPadrao();
app.listen(3000, () => {
  console.log("🚀 Servidor rodando em http://localhost:3000");
});