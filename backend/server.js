require("dotenv").config();

const express = require("express");
const db = require("./db");
require("./initDB");
garantirCategoriasPadrao();

const path = require("path");

const queries = require("./queries"); // importa todas as funções

const app = express();

const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const nodemailer = require("nodemailer");
const rendimentoService = require("./rendimentoService");

const SECRET = "cashcontrol_super_secret";
const RESET_TOKEN_TTL_MS = 1000 * 60 * 15;

const transporter = nodemailer.createTransport({
  service: process.env.SMTP_SERVICE || "gmail",
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

app.use(express.json());

const userColumns = db.prepare("PRAGMA table_info(usuarios)").all();
const hasResetTokenHashCol = userColumns.some((c) => c.name === "reset_token_hash");
const hasResetExpiresAtCol = userColumns.some((c) => c.name === "reset_expires_at");
const hasResetTokenPlainCol = userColumns.some((c) => c.name === "reset_token");
const hasResetExpiraCol = userColumns.some((c) => c.name === "reset_expira");

function getResetUserByToken(token) {
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

  if (hasResetTokenHashCol && hasResetExpiresAtCol) {
    return db.prepare(`
      SELECT id, reset_expires_at
      FROM usuarios
      WHERE reset_token_hash = ?
    `).get(tokenHash);
  }

  // Legacy fallback (bases antigas que ainda usam reset_token/reset_expira)
  if (hasResetTokenPlainCol && hasResetExpiraCol) {
    return db.prepare(`
      SELECT id, reset_expira
      FROM usuarios
      WHERE reset_token = ?
    `).get(token);
  }

  return null;
}

function clearResetTokenByUserId(userId) {
  if (hasResetTokenHashCol && hasResetExpiresAtCol) {
    return db.prepare(`
      UPDATE usuarios
      SET reset_token_hash = NULL,
          reset_expires_at = NULL
      WHERE id = ?
    `).run(userId);
  }

  if (hasResetTokenPlainCol && hasResetExpiraCol) {
    return db.prepare(`
      UPDATE usuarios
      SET reset_token = NULL,
          reset_expira = NULL
      WHERE id = ?
    `).run(userId);
  }

  return { changes: 0 };
}

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
    const result = db.prepare(`
      INSERT INTO usuarios (nome, email, senha)
      VALUES (?, ?, ?)
    `).run(nome, email, hash);

    const userId = result.lastInsertRowid;
    const categorias = [
      "Alimentação",
      "Transporte",
      "Moradia",
      "Lazer",
      "Saúde",
      "Educação",
      "Salário",
      "Investimentos",
      "Outros"
    ];

    const insertCat = db.prepare(`
  INSERT OR IGNORE INTO categorias (usuario_id, nome)
  VALUES (?, ?)
`);

    const insertCats = db.transaction((uid) => {
      for (const c of categorias) {
        insertCat.run(uid, c);
      }
    });

    insertCats(userId);

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

async function handleForgotPassword(req, res) {
  const email = String(req.body?.email || "").trim().toLowerCase();

  // Sempre retorna ok para nao vazar quais emails existem no sistema.
  if (!email) return res.json({ ok: true });

  const user = db.prepare(`
    SELECT id, email
    FROM usuarios
    WHERE lower(email) = ?
  `).get(email);

  if (!user) return res.json({ ok: true });

  const token = String(Math.floor(100000 + Math.random() * 900000));
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const expiraEm = Date.now() + RESET_TOKEN_TTL_MS;

  db.prepare(`
    UPDATE usuarios
    SET reset_token_hash = ?, reset_expires_at = ?
    WHERE id = ?
  `).run(tokenHash, expiraEm, user.id);

  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.error("SMTP nao configurado. Defina SMTP_USER e SMTP_PASS.");
    return res.status(500).json({ ok: false, erro: "SMTP nao configurado" });
  }

  try {
    await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: user.email,
      subject: "Recuperacao de senha - Cash Control",
      text:
        `Seu codigo de recuperacao e: ${token}\n\n` +
        `Esse codigo expira em 15 minutos.\n` +
        `Se nao foi voce, ignore este e-mail.`
    });
  } catch (err) {
    console.error("Erro ao enviar e-mail de recuperacao:", err.message);
    return res.status(500).json({ ok: false, erro: "Falha ao enviar email" });
  }

  return res.json({ ok: true });
}

async function handleResetPassword(req, res) {
  try {
    const token = String(req.body?.token || "").trim();
    const senha = String(req.body?.senha || "");

    console.log("TOKEN:", token || null);

    if (!token || !senha) {
      return res.status(400).json({ ok: false, erro: "Token e senha sao obrigatorios" });
    }

    if (senha.length < 6) {
      return res.status(400).json({ ok: false, erro: "A senha deve ter pelo menos 6 caracteres" });
    }

    const user = getResetUserByToken(token);

    console.log("USER:", user);

    if (!user) {
      return res.status(400).json({ ok: false, erro: "token nao encontrado" });
    }

    const expira = user.reset_expires_at ?? user.reset_expira;
    if (!expira || Number(expira) < Date.now()) {
      return res.status(400).json({ ok: false, erro: "token expirado" });
    }

    const hash = await bcrypt.hash(senha, 10);

    const passResult = db.prepare(`
      UPDATE usuarios
      SET senha = ?
      WHERE id = ?
    `).run(hash, user.id);

    const clearResult = clearResetTokenByUserId(user.id);

    const result = {
      changes: Number(passResult.changes || 0) + Number(clearResult.changes || 0)
    };

    console.log("UPDATE:", result);

    return res.json({ ok: true });
  } catch (err) {
    console.error("ERRO REAL:", err);
    return res.status(500).json({ ok: false, erro: err.message });
  }
}

function handleValidateResetToken(req, res) {
  const token = String(req.body?.token || "").trim();

  if (!token) {
    return res.status(400).json({ ok: false, erro: "Token obrigatorio" });
  }

  const user = getResetUserByToken(token);

  if (!user) {
    return res.json({ ok: false, erro: "Token invalido" });
  }

  const expira = user.reset_expires_at ?? user.reset_expira;
  if (!expira || Number(expira) < Date.now()) {
    return res.json({ ok: false, erro: "Token expirado" });
  }

  return res.json({ ok: true });
}

// Rotas novas (fluxo por codigo)
app.post("/api/forgot", handleForgotPassword);
app.post("/api/validar-token", handleValidateResetToken);
app.post("/api/reset", handleResetPassword);

// Compatibilidade com nomes antigos
app.post("/api/forgot-password", handleForgotPassword);
app.post("/api/reset-password", handleResetPassword);

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
  const userId = req.user.id;

  const mov = db.prepare(`
    SELECT
      m.id,
      m.data,
      m.descricao,
      m.valor,
      m.tipo,
      c.nome as categoria,
      NULL as parcela_num,
      NULL as parcela_total
    FROM movimentacoes m
    LEFT JOIN categorias c ON c.id = m.categoria_id
      AND (c.usuario_id IS NULL OR c.usuario_id = ?)
    WHERE strftime('%Y-%m', m.data) = ?
      AND m.usuario_id = ?
    ORDER BY m.data DESC
  `).all(userId, mes, userId);

  res.json(mov);

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
  res.json(queries.editarMovimentacao(req.params.id, req.body, req.user.id));
});


app.delete("/api/movimentacoes/:id", auth, (req, res) => {
  res.json(queries.deletarMovimentacao(req.params.id, req.user.id));
});


app.get("/api/categorias", auth, (req,res)=>{
  res.json(queries.getCategorias(req.user.id));
});


app.post("/api/categorias", auth, (req,res)=>{
  const {nome} = req.body;
  res.json(queries.addCategoria(req.user.id, nome));
});

// ===== CAIXINHAS =====
app.get("/api/caixinhas", auth, (req, res) => {
  res.json(queries.getCaixinhas(req.user.id));
});

app.post("/api/caixinhas", auth, (req, res) => {
  const {
    nome,
    objetivo,
    rendimento_tipo,
    rendimento_percentual,
    instituicao,
    produto,
    auto_percentual
  } = req.body;

  if (!String(nome || "").trim()) {
    return res.status(400).json({ ok: false, erro: "Nome é obrigatório" });
  }

  const result = queries.addCaixinha(
    req.user.id,
    nome,
    objetivo,
    rendimento_tipo,
    rendimento_percentual,
    instituicao,
    produto,
    !!auto_percentual
  );

  return res.json({ ok: true, id: Number(result.lastInsertRowid) });
});

app.put("/api/caixinhas/:id", auth, (req, res) => {
  const {
    nome,
    objetivo,
    rendimento_tipo,
    rendimento_percentual,
    instituicao,
    produto,
    auto_percentual
  } = req.body;

  if (!String(nome || "").trim()) {
    return res.status(400).json({ ok: false, erro: "Nome é obrigatório" });
  }

  const result = queries.updateCaixinha(
    req.params.id,
    req.user.id,
    nome,
    objetivo,
    rendimento_tipo,
    rendimento_percentual,
    instituicao,
    produto,
    !!auto_percentual
  );

  if (!result.changes) {
    return res.status(404).json({ ok: false, erro: "Caixinha não encontrada" });
  }

  return res.json({ ok: true });
});

app.delete("/api/caixinhas/:id", auth, (req, res) => {
  try {
    const result = queries.deleteCaixinha(req.params.id, req.user.id);
    return res.json(result);
  } catch (err) {
    return res.status(404).json({
      ok: false,
      erro: err.message || "Caixinha não encontrada"
    });
  }
});

app.get("/api/caixinhas/:id/movimentacoes", auth, (req, res) => {
  res.json(queries.getCaixinhaMovimentacoes(req.params.id, req.user.id));
});

app.get("/api/caixinhas/evolucao", auth, (req, res) => {
  const periodo = String(req.query.periodo || "mensal").toLowerCase();
  const permitidos = ["diario", "semanal", "mensal", "anual"];

  if (!permitidos.includes(periodo)) {
    return res.status(400).json({ ok: false, erro: "periodo inválido" });
  }

  return res.json(queries.getCaixinhasEvolucao(periodo, req.user.id));
});

app.post("/api/caixinhas/:id/deposito", auth, (req, res) => {
  const { valor, data } = req.body;
  const result = queries.movimentarCaixinha(req.params.id, req.user.id, valor, "deposito", data);

  if (!result.ok) {
    return res.status(400).json(result);
  }

  return res.json(result);
});

app.post("/api/caixinhas/:id/saque", auth, (req, res) => {
  const { valor, data } = req.body;
  const result = queries.movimentarCaixinha(req.params.id, req.user.id, valor, "saque", data);

  if (!result.ok) {
    return res.status(400).json(result);
  }

  return res.json(result);
});

app.get("/api/rendimento/status", auth, (req, res) => {
  return res.json(rendimentoService.getTaxasStatus());
});

app.get("/api/rendimento/instituicoes", auth, (req, res) => {
  return res.json(rendimentoService.getRendimentoInstituicoes(req.query.indexador || null));
});

app.post("/api/rendimento/atualizar", auth, async (req, res) => {
  try {
    const result = await rendimentoService.atualizarTudoRendimento();
    return res.json({ ok: true, ...result });
  } catch (err) {
    return res.status(500).json({ ok: false, erro: err.message });
  }
});

app.get("/api/relatorio-categorias", auth, (req, res) => {

  const mes = req.query.mes;
  const usuario_id = req.user.id;
  const userId = req.user.id;

  if (!mes || !/^\d{4}-\d{2}$/.test(mes)) {
    return res.status(400).json({ ok:false, erro:"mes inválido (use YYYY-MM)" });
  }

  res.json(
    queries.getRelatorioCategorias(mes, usuario_id)
  );

});


app.get("/api/previsao", auth, (req, res) => {
  const mes = req.query.mes;
  if (!mes || !/^\d{4}-\d{2}$/.test(mes)) {
    return res.status(400).json({ ok:false, erro:"mes inválido (use YYYY-MM)" });
  }
  res.json(queries.getPrevisao(mes, req.user.id));
});


// ...rotas de movimentações já protegidas acima...

// ===== CARTÃO =====

app.get("/api/cartoes", auth, (req, res) =>
  res.json(queries.getCartoes(req.user.id))
);

app.post("/api/cartoes", auth, (req, res) => {
  const { nome, limite, dia_fechamento, dia_vencimento } = req.body;

  res.json(
    queries.addCartao(
      req.user.id,
      nome,
      limite,
      dia_fechamento,
      dia_vencimento
    )
  );
});

app.put("/api/cartoes/:id", auth, (req, res) => {
  const { nome, limite, dia_fechamento, dia_vencimento } = req.body;

  res.json(
    queries.updateCartao(
      req.params.id,
      req.user.id,
      nome,
      limite,
      dia_fechamento,
      dia_vencimento
    )
  );
});

app.delete("/api/cartoes/:id", auth, (req, res) => {
  res.json(queries.deleteCartao(req.params.id, req.user.id));
});

app.post("/api/cartoes/compra", auth, (req, res) => {

  console.log("ROTA CARTAO CHAMADA");
  console.log(req.body);

  const payload = {
    ...req.body,
    usuario_id: req.user.id,
  };

  const r = queries.criarCompraCartao(payload);

  console.log("RESULTADO:", r);

  res.json(r);
});

app.get("/api/cartoes/:id/fatura", auth, (req, res) => {
  const mes = req.query.mes;
  if (!mes || !/^\d{4}-\d{2}$/.test(mes)) return res.status(400).json({ ok:false, erro:"mes inválido" });
  res.json(queries.getFaturaCartao(req.params.id, mes, req.user.id));
});

app.patch("/api/cartoes/parcela/:id/status", auth, (req, res) => {
  const { status } = req.body;
  res.json(queries.setParcelaStatus(req.params.id, status, req.user.id));
});

app.delete("/api/cartoes/compra/:id", auth, (req, res) => {
  res.json(queries.deleteCompraCartao(req.params.id, req.user.id));
});


app.get("/api/recorrencias", auth, (req, res) => {
  res.json(queries.getRecorrencias(req.user.id));
});

app.post("/api/recorrencias", auth, (req, res) => {
  const { descricao, valor, tipo, categoria_id, dia_mes } = req.body;
  res.json(
    queries.addRecorrencia(
      descricao,
      Number(valor),
      tipo,
      categoria_id ?? null,
      Number(dia_mes),
      req.user.id
    )
  );
});

app.patch("/api/recorrencias/:id/ativo", auth, (req, res) => {
  const { ativo } = req.body;
  res.json(queries.setRecorrenciaAtiva(req.params.id, !!ativo, req.user.id));
});

app.get("/api/recorrencias/resumo", auth, (req, res) => {
  res.json(queries.resumoRecorrencias());
});

app.delete("/api/recorrencias/:id", auth, (req, res) => {
  res.json(queries.deleteRecorrencia(req.params.id, req.user.id));
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
      !!ativo,
      req.user.id
    )
  );
});

// gerar transações do mês (ex: 2026-03)

app.post("/api/recorrencias/gerar", auth, (req, res) => {
  const mes = req.query.mes;
  if (!mes || !/^\d{4}-\d{2}$/.test(mes)) return res.status(400).json({ ok:false, erro:"mes inválido (use YYYY-MM)" });
  res.json(queries.gerarRecorrencias(mes, req.user.id));
});


app.get("/api/resumo", auth, (req, res) => {
  const mes = req.query.mes;
  const dados = queries.getResumo(mes, req.user.id);
  res.json(dados);
});


app.post("/api/cartao/compra", auth, (req,res)=>{
  const r = queries.criarCompraCartao(req.body);
  res.json(r);
});


app.post("/api/cartoes/:id/pagar", auth, (req, res) => {

  const cartaoId = req.params.id;
  const { mes } = req.body;
  const usuario_id = req.user.id;

  const pagarFatura = db.transaction(() => {
    const categorias = db.prepare(`
      SELECT cc.categoria_id, c.nome as categoria_nome, SUM(pc.valor) as total
      FROM parcelas_cartao pc
      JOIN compras_cartao cc ON cc.id = pc.compra_id
      LEFT JOIN categorias c ON c.id = cc.categoria_id
      WHERE pc.cartao_id = ?
      AND pc.mes_ref = ?
      AND pc.status = 'aberta'
      AND pc.usuario_id = ?
      AND cc.usuario_id = ?
      GROUP BY cc.categoria_id, c.nome
    `).all(cartaoId, mes, usuario_id, usuario_id);

    const total = categorias.reduce((acc, cat) => acc + Number(cat.total || 0), 0);

    if (total === 0) {
      return { semParcelas: true };
    }

    db.prepare(`
      UPDATE parcelas_cartao
      SET status = 'paga'
      WHERE cartao_id = ?
      AND mes_ref = ?
      AND usuario_id = ?
    `).run(cartaoId, mes, usuario_id);

    const insertMov = db.prepare(`
      INSERT INTO movimentacoes (
        descricao,
        valor,
        tipo,
        origem,
        categoria_id,
        data,
        usuario_id
      )
      VALUES (?, ?, 'saida', 'cartao', ?, date('now'), ?)
    `);

    for (const cat of categorias) {
      insertMov.run(
        `Fatura (${mes}) - ${cat.categoria_nome || "Sem categoria"}`,
        Number(cat.total || 0),
        cat.categoria_id,
        usuario_id
      );
    }

    return { semParcelas: false, total, lancamentos: categorias.length };
  });

  const resultado = pagarFatura();

  if (resultado.semParcelas) {
    return res.status(400).json({ erro: "Nenhuma parcela encontrada pra pagar" });
  }

  res.json({ ok: true, total: resultado.total, lancamentos: resultado.lancamentos });
});


app.get("/api/dashboard", auth, (req,res)=>{
  const mes = req.query.mes;
  const dados = queries.getDashboard(mes, req.user.id);
  res.json(dados);
});


app.post("/api/metas", auth, (req,res)=>{
  const {categoria_id, valor_meta, mes} = req.body;
  res.json(queries.setMetaCategoria(req.user.id, categoria_id, valor_meta, mes));
});


app.get("/api/metas", auth, (req,res)=>{
  const {mes} = req.query;
  const dados = queries.getMetasComGasto(mes, req.user.id);
  res.json(dados);
});


app.get("/api/cartoes/:id/controle", auth, (req,res)=>{
  const cartaoId = Number(req.params.id);
  res.json(queries.getControleCartao(cartaoId, req.user.id));
});


app.get("/api/mensal", auth, (req, res) => {
  const ano = req.query.ano;

  if (!ano || !/^\d{4}$/.test(ano)) {
    return res.status(400).json({ erro: "Ano inválido" });
  }

  const dados = db.prepare(`
    SELECT
      mes_num,
      SUM(entradas) as entradas,
      SUM(saidas) as saidas
    FROM (
      SELECT
        strftime('%m', data) as mes_num,
        CASE WHEN tipo = 'entrada' THEN valor ELSE 0 END as entradas,
        CASE WHEN tipo = 'saida' THEN valor ELSE 0 END as saidas
      FROM movimentacoes
      WHERE strftime('%Y', data) = ?
        AND usuario_id = ?
    )
    GROUP BY mes_num
    ORDER BY mes_num
  `).all(ano, req.user.id);

  const mapa = {};
  dados.forEach(d => {
    mapa[d.mes_num] = {
      entradas: Number(d.entradas) || 0,
      saidas: Number(d.saidas) || 0
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
      AND usuario_id = ?
    ORDER BY data
  `).all(mes, req.user.id);

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

  const dados = queries.getPrevisaoCartao(cartaoId, req.user.id);

  res.json(dados);

});

app.get("/api/diario", auth, (req, res) => {
  const mes = req.query.mes;
  const usuario_id = req.user.id;

  if (!mes || !/^\d{4}-\d{2}$/.test(mes)) {
    return res.status(400).json({ erro: "Mes invalido. Use YYYY-MM" });
  }

  const dados = db.prepare(`
    SELECT
      strftime('%d', data) as dia,
      SUM(CASE WHEN tipo='entrada' THEN valor ELSE 0 END) as entradas,
      SUM(CASE WHEN tipo='saida' THEN valor ELSE 0 END) as saidas
    FROM movimentacoes
    WHERE substr(data,1,7) = ?
      AND usuario_id = ?
    GROUP BY dia
    ORDER BY dia
  `).all(mes, usuario_id);

  const mapa = {};
  dados.forEach(d => {
    mapa[d.dia] = {
      entradas: Number(d.entradas) || 0,
      saidas: Number(d.saidas) || 0
    };
  });

  const [ano, mesNum] = mes.split("-").map(Number);
  const diasNoMes = new Date(ano, mesNum, 0).getDate();

  const resultado = [];

  for (let i = 1; i <= diasNoMes; i++) {
    const dia = String(i).padStart(2, "0");

    resultado.push({
      dia,
      entradas: mapa[dia]?.entradas || 0,
      saidas: mapa[dia]?.saidas || 0
    });
  }

  res.json(resultado);
});

//temporarios

garantirCategoriasPadrao();
rendimentoService.iniciarAgendadorRendimento();
app.listen(3000, () => {
  console.log("🚀 Servidor rodando em http://localhost:3000");
});
