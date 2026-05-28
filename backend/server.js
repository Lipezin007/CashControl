const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");

const envCandidates = [
  path.resolve(__dirname, "..", ".env"),
  path.resolve(process.cwd(), ".env")
];

for (const envPath of envCandidates) {
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
    break;
  }
}
dotenv.config();

const express = require("express");
const pool = require("./db");
const initDB = require("./initDB");
const queries = require("./queries");

const app = express();
let rendimentoAgendadorIniciado = false;

const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const nodemailer = require("nodemailer");
const rendimentoService = require("./rendimentoService");

const SECRET = process.env.JWT_SECRET || "cashcontrol_super_secret";
const RESET_TOKEN_TTL_MS = 1000 * 60 * 15;

function getSmtpPass() {
  return String(process.env.SMTP_PASS || "").replace(/\s+/g, "");
}

const transporter = nodemailer.createTransport({
  service: process.env.SMTP_SERVICE || "gmail",
  auth: {
    user: process.env.SMTP_USER,
    pass: getSmtpPass()
  }
});

app.use(express.json());

async function getResetUserByToken(token) {
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const result = await pool.query(
    "SELECT id, reset_expires_at FROM usuarios WHERE reset_token_hash = $1",
    [tokenHash]
  );
  return result.rows[0];
}

async function clearResetTokenByUserId(userId) {
  const result = await pool.query(
    "UPDATE usuarios SET reset_token_hash = NULL, reset_expires_at = NULL WHERE id = $1",
    [userId]
  );
  return { changes: result.rowCount };
}

async function garantirCategoriasPadrao() {
  const result = await pool.query("SELECT COUNT(*)::int AS total FROM categorias");
  if (Number(result.rows[0].total) === 0) {
    const categorias = [
      "Alimentação", "Transporte", "Moradia", "Lazer",
      "Saúde", "Educação", "Salário", "Outros"
    ];
    for (const c of categorias) {
      await pool.query(
        "INSERT INTO categorias (nome) VALUES ($1)",
        [c]
      );
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
    const userResult = await pool.query(
      "INSERT INTO usuarios (nome, email, senha) VALUES ($1, $2, $3) RETURNING id",
      [nome, email, hash]
    );
    const userId = userResult.rows[0].id;

    const categorias = [
      "Alimentação", "Transporte", "Moradia", "Lazer",
      "Saúde", "Educação", "Salário", "Investimentos", "Outros"
    ];

    for (const c of categorias) {
      await pool.query(
        "INSERT INTO categorias (usuario_id, nome) VALUES ($1, $2) ON CONFLICT DO NOTHING",
        [userId, c]
      );
    }

    res.json({ ok: true });
  } catch {
    res.status(400).json({ erro: "Email já cadastrado" });
  }
});

app.post("/api/login", async (req, res) => {
  const { email, senha } = req.body;

  const result = await pool.query("SELECT * FROM usuarios WHERE email = $1", [email]);
  const user = result.rows[0];

  if (!user) return res.status(400).json({ erro: "Usuário não encontrado" });

  const senhaCorreta = await bcrypt.compare(senha, user.senha);
  if (!senhaCorreta) return res.status(400).json({ erro: "Senha incorreta" });

  const token = jwt.sign({ id: user.id, email: user.email }, SECRET, { expiresIn: "7d" });
  res.json({ token });
});

async function handleForgotPassword(req, res) {
  const email = String(req.body?.email || "").trim().toLowerCase();
  if (!email) return res.json({ ok: true });

  const result = await pool.query(
    "SELECT id, email FROM usuarios WHERE lower(email) = $1",
    [email]
  );
  const user = result.rows[0];
  if (!user) return res.json({ ok: true });

  const token = String(Math.floor(100000 + Math.random() * 900000));
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const expiraEm = Date.now() + RESET_TOKEN_TTL_MS;

  await pool.query(
    "UPDATE usuarios SET reset_token_hash = $1, reset_expires_at = $2 WHERE id = $3",
    [tokenHash, expiraEm, user.id]
  );

  if (!process.env.SMTP_USER || !getSmtpPass()) {
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

    if (!token || !senha) {
      return res.status(400).json({ ok: false, erro: "Token e senha sao obrigatorios" });
    }
    if (senha.length < 6) {
      return res.status(400).json({ ok: false, erro: "A senha deve ter pelo menos 6 caracteres" });
    }

    const user = await getResetUserByToken(token);
    if (!user) return res.status(400).json({ ok: false, erro: "token nao encontrado" });

    const expira = user.reset_expires_at;
    if (!expira || Number(expira) < Date.now()) {
      return res.status(400).json({ ok: false, erro: "token expirado" });
    }

    const hash = await bcrypt.hash(senha, 10);
    await pool.query("UPDATE usuarios SET senha = $1 WHERE id = $2", [hash, user.id]);
    await clearResetTokenByUserId(user.id);

    return res.json({ ok: true });
  } catch (err) {
    console.error("ERRO REAL:", err);
    return res.status(500).json({ ok: false, erro: err.message });
  }
}

async function handleValidateResetToken(req, res) {
  const token = String(req.body?.token || "").trim();
  if (!token) return res.status(400).json({ ok: false, erro: "Token obrigatorio" });

  const user = await getResetUserByToken(token);
  if (!user) return res.json({ ok: false, erro: "Token invalido" });

  const expira = user.reset_expires_at;
  if (!expira || Number(expira) < Date.now()) {
    return res.json({ ok: false, erro: "Token expirado" });
  }

  return res.json({ ok: true });
}

app.post("/api/forgot", handleForgotPassword);
app.post("/api/validar-token", handleValidateResetToken);
app.post("/api/reset", handleResetPassword);
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

  if (!token) return res.status(401).json({ erro: "Token não enviado" });

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

app.get("/health", (req, res) => res.json({ ok: true }));

// Garante que o banco esteja pronto antes de qualquer rota de API.
// Em ambientes serverless (Vercel), startServer nunca é chamado,
// então usamos lazy init via middleware.
let _dbReady = false;
let _dbInitPromise = null;

async function ensureDB() {
  if (_dbReady) return;
  if (!_dbInitPromise) {
    _dbInitPromise = (async () => {
      await initDB();
      await garantirCategoriasPadrao();
      // Scheduler não funciona em serverless — só inicia em ambientes tradicionais
      if (!process.env.VERCEL && !rendimentoAgendadorIniciado) {
        rendimentoService.iniciarAgendadorRendimento();
        rendimentoAgendadorIniciado = true;
      }
      _dbReady = true;
    })();
  }
  return _dbInitPromise;
}

app.use("/api", async (req, res, next) => {
  try {
    await ensureDB();
    next();
  } catch (err) {
    res.status(500).json({ erro: "Falha ao inicializar banco: " + err.message });
  }
});

// ===== MOVIMENTAÇÕES =====

app.get("/api/movimentacoes", auth, async (req, res) => {
  try {
    const mes = req.query.mes;
    const userId = req.user.id;
    const mov = await pool.query(`
      SELECT
        m.id, m.data, m.descricao, m.valor, m.tipo,
        c.nome as categoria,
        NULL as parcela_num,
        NULL as parcela_total
      FROM movimentacoes m
      LEFT JOIN categorias c ON c.id = m.categoria_id
        AND (c.usuario_id IS NULL OR c.usuario_id = $1)
      WHERE TO_CHAR(m.data::date, 'YYYY-MM') = $2 AND m.usuario_id = $1
      ORDER BY m.data DESC
    `, [userId, mes]);
    res.json(mov.rows);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

app.post("/api/movimentacoes", auth, async (req, res) => {
  try {
    const userId = req.user.id;
    await pool.query(
      "INSERT INTO movimentacoes (descricao, valor, tipo, data, categoria_id, usuario_id) VALUES ($1, $2, $3, $4, $5, $6)",
      [req.body.descricao, req.body.valor, req.body.tipo, req.body.data, req.body.categoria_id, userId]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

app.put("/api/movimentacoes/:id", auth, async (req, res) => {
  try {
    res.json(await queries.editarMovimentacao(req.params.id, req.body, req.user.id));
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

app.delete("/api/movimentacoes/:id", auth, async (req, res) => {
  try {
    res.json(await queries.deletarMovimentacao(req.params.id, req.user.id));
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

app.get("/api/categorias", auth, async (req, res) => {
  try {
    res.json(await queries.getCategorias(req.user.id));
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

app.post("/api/categorias", auth, async (req, res) => {
  try {
    res.json(await queries.addCategoria(req.user.id, req.body.nome));
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// ===== CAIXINHAS =====

app.get("/api/caixinhas", auth, async (req, res) => {
  try {
    res.json(await queries.getCaixinhas(req.user.id));
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

app.get("/api/caixinhas/taxas-em-uso", auth, async (req, res) => {
  try {
    res.json(await queries.getCaixinhasTaxasEmUso(req.user.id));
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

app.post("/api/caixinhas", auth, async (req, res) => {
  try {
    const { nome, objetivo, rendimento_tipo, rendimento_percentual, instituicao, produto, auto_percentual } = req.body;
    if (!String(nome || "").trim()) return res.status(400).json({ ok: false, erro: "Nome é obrigatório" });

    const result = await queries.addCaixinha(
      req.user.id, nome, objetivo, rendimento_tipo, rendimento_percentual,
      instituicao, produto, !!auto_percentual
    );
    return res.json({ ok: true, id: Number(result.id) });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

app.put("/api/caixinhas/:id", auth, async (req, res) => {
  try {
    const { nome, objetivo, rendimento_tipo, rendimento_percentual, instituicao, produto, auto_percentual } = req.body;
    if (!String(nome || "").trim()) return res.status(400).json({ ok: false, erro: "Nome é obrigatório" });

    const result = await queries.updateCaixinha(
      req.params.id, req.user.id, nome, objetivo, rendimento_tipo, rendimento_percentual,
      instituicao, produto, !!auto_percentual
    );
    if (!result.changes) return res.status(404).json({ ok: false, erro: "Caixinha não encontrada" });
    return res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

app.delete("/api/caixinhas/:id", auth, async (req, res) => {
  try {
    res.json(await queries.deleteCaixinha(req.params.id, req.user.id));
  } catch (err) {
    res.status(404).json({ ok: false, erro: err.message || "Caixinha não encontrada" });
  }
});

app.get("/api/caixinhas/:id/movimentacoes", auth, async (req, res) => {
  try {
    res.json(await queries.getCaixinhaMovimentacoes(req.params.id, req.user.id));
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

app.get("/api/caixinhas/evolucao", auth, async (req, res) => {
  try {
    const periodo = String(req.query.periodo || "mensal").toLowerCase();
    const permitidos = ["diario", "semanal", "mensal", "anual"];
    if (!permitidos.includes(periodo)) return res.status(400).json({ ok: false, erro: "periodo inválido" });
    return res.json(await queries.getCaixinhasEvolucao(periodo, req.user.id));
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

app.post("/api/caixinhas/:id/deposito", auth, async (req, res) => {
  try {
    const result = await queries.movimentarCaixinha(req.params.id, req.user.id, req.body.valor, "deposito", req.body.data);
    if (!result.ok) return res.status(400).json(result);
    return res.json(result);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

app.post("/api/caixinhas/:id/saque", auth, async (req, res) => {
  try {
    const result = await queries.movimentarCaixinha(req.params.id, req.user.id, req.body.valor, "saque", req.body.data);
    if (!result.ok) return res.status(400).json(result);
    return res.json(result);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

app.get("/api/rendimento/status", auth, async (req, res) => {
  try {
    res.json(await rendimentoService.getTaxasStatus());
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

app.get("/api/rendimento/instituicoes", auth, async (req, res) => {
  try {
    res.json(await rendimentoService.getRendimentoInstituicoes(req.query.indexador || null));
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

app.post("/api/rendimento/atualizar", auth, async (req, res) => {
  try {
    const result = await rendimentoService.atualizarTudoRendimento();
    return res.json({ ok: true, ...result });
  } catch (err) {
    return res.status(500).json({ ok: false, erro: err.message });
  }
});

// ===== RELATÓRIOS =====

app.get("/api/relatorio-categorias", auth, async (req, res) => {
  try {
    const mes = req.query.mes;
    if (!mes || !/^\d{4}-\d{2}$/.test(mes)) {
      return res.status(400).json({ ok: false, erro: "mes inválido (use YYYY-MM)" });
    }
    res.json(await queries.getRelatorioCategorias(mes, req.user.id));
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

app.get("/api/previsao", auth, async (req, res) => {
  try {
    const mes = req.query.mes;
    if (!mes || !/^\d{4}-\d{2}$/.test(mes)) {
      return res.status(400).json({ ok: false, erro: "mes inválido (use YYYY-MM)" });
    }
    res.json(await queries.getPrevisao(mes, req.user.id));
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// ===== CARTÕES =====

app.get("/api/cartoes", auth, async (req, res) => {
  try {
    res.json(await queries.getCartoes(req.user.id));
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

app.post("/api/cartoes", auth, async (req, res) => {
  try {
    const { nome, limite, dia_fechamento, dia_vencimento } = req.body;
    res.json(await queries.addCartao(req.user.id, nome, limite, dia_fechamento, dia_vencimento));
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

app.put("/api/cartoes/:id", auth, async (req, res) => {
  try {
    const { nome, limite, dia_fechamento, dia_vencimento } = req.body;
    res.json(await queries.updateCartao(req.params.id, req.user.id, nome, limite, dia_fechamento, dia_vencimento));
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

app.delete("/api/cartoes/:id", auth, async (req, res) => {
  try {
    res.json(await queries.deleteCartao(req.params.id, req.user.id));
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

app.post("/api/cartoes/compra", auth, async (req, res) => {
  try {
    console.log("ROTA CARTAO CHAMADA");
    console.log(req.body);
    const payload = { ...req.body, usuario_id: req.user.id };
    const r = await queries.criarCompraCartao(payload);
    console.log("RESULTADO:", r);
    res.json(r);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

app.get("/api/cartoes/:id/fatura", auth, async (req, res) => {
  try {
    const mes = req.query.mes;
    if (!mes || !/^\d{4}-\d{2}$/.test(mes)) return res.status(400).json({ ok: false, erro: "mes inválido" });
    res.json(await queries.getFaturaCartao(req.params.id, mes, req.user.id));
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

app.patch("/api/cartoes/parcela/:id/status", auth, async (req, res) => {
  try {
    res.json(await queries.setParcelaStatus(req.params.id, req.body.status, req.user.id));
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

app.delete("/api/cartoes/compra/:id", auth, async (req, res) => {
  try {
    res.json(await queries.deleteCompraCartao(req.params.id, req.user.id));
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// ===== RECORRÊNCIAS =====

app.get("/api/recorrencias", auth, async (req, res) => {
  try {
    res.json(await queries.getRecorrencias(req.user.id));
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

app.post("/api/recorrencias", auth, async (req, res) => {
  try {
    const { descricao, valor, tipo, categoria_id, dia_mes } = req.body;
    res.json(await queries.addRecorrencia(descricao, Number(valor), tipo, categoria_id ?? null, Number(dia_mes), req.user.id));
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

app.patch("/api/recorrencias/:id/ativo", auth, async (req, res) => {
  try {
    res.json(await queries.setRecorrenciaAtiva(req.params.id, !!req.body.ativo, req.user.id));
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

app.get("/api/recorrencias/resumo", auth, async (req, res) => {
  try {
    res.json(await queries.resumoRecorrencias());
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

app.delete("/api/recorrencias/:id", auth, async (req, res) => {
  try {
    res.json(await queries.deleteRecorrencia(req.params.id, req.user.id));
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

app.put("/api/recorrencias/:id", auth, async (req, res) => {
  try {
    const { descricao, valor, tipo, categoria_id, dia_mes, ativo } = req.body;
    res.json(await queries.updateRecorrencia(
      req.params.id, descricao, Number(valor), tipo, categoria_id ?? null,
      Number(dia_mes), !!ativo, req.user.id
    ));
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

app.post("/api/recorrencias/gerar", auth, async (req, res) => {
  try {
    const mes = req.query.mes;
    if (!mes || !/^\d{4}-\d{2}$/.test(mes)) return res.status(400).json({ ok: false, erro: "mes inválido (use YYYY-MM)" });
    res.json(await queries.gerarRecorrencias(mes, req.user.id));
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

app.get("/api/resumo", auth, async (req, res) => {
  try {
    res.json(await queries.getResumo(req.query.mes, req.user.id));
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

app.post("/api/cartao/compra", auth, async (req, res) => {
  try {
    res.json(await queries.criarCompraCartao(req.body));
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

app.post("/api/cartoes/:id/pagar", auth, async (req, res) => {
  const cartaoId = req.params.id;
  const { mes } = req.body;
  const usuario_id = req.user.id;

  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const categoriasResult = await client.query(`
        SELECT cc.categoria_id, c.nome as categoria_nome, SUM(pc.valor) as total
        FROM parcelas_cartao pc
        JOIN compras_cartao cc ON cc.id = pc.compra_id
        LEFT JOIN categorias c ON c.id = cc.categoria_id
        WHERE pc.cartao_id = $1 AND pc.mes_ref = $2
          AND pc.status = 'aberta' AND pc.usuario_id = $3 AND cc.usuario_id = $3
        GROUP BY cc.categoria_id, c.nome
      `, [cartaoId, mes, usuario_id]);

      const categorias = categoriasResult.rows;
      const total = categorias.reduce((acc, cat) => acc + Number(cat.total || 0), 0);

      if (total === 0) {
        await client.query("ROLLBACK");
        return res.status(400).json({ erro: "Nenhuma parcela encontrada pra pagar" });
      }

      await client.query(`
        UPDATE parcelas_cartao SET status = 'paga'
        WHERE cartao_id = $1 AND mes_ref = $2 AND usuario_id = $3
      `, [cartaoId, mes, usuario_id]);

      for (const cat of categorias) {
        await client.query(`
          INSERT INTO movimentacoes (descricao, valor, tipo, origem, categoria_id, data, usuario_id)
          VALUES ($1, $2, 'saida', 'cartao', $3, CURRENT_DATE::text, $4)
        `, [
          `Fatura (${mes}) - ${cat.categoria_nome || "Sem categoria"}`,
          Number(cat.total || 0),
          cat.categoria_id,
          usuario_id
        ]);
      }

      await client.query("COMMIT");
      res.json({ ok: true, total, lancamentos: categorias.length });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

app.get("/api/dashboard", auth, async (req, res) => {
  try {
    res.json(await queries.getDashboard(req.query.mes, req.user.id));
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

app.post("/api/metas", auth, async (req, res) => {
  try {
    const { categoria_id, valor_meta, mes } = req.body;
    res.json(await queries.setMetaCategoria(req.user.id, categoria_id, valor_meta, mes));
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

app.get("/api/metas", auth, async (req, res) => {
  try {
    res.json(await queries.getMetasComGasto(req.query.mes, req.user.id));
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

app.get("/api/cartoes/:id/controle", auth, async (req, res) => {
  try {
    res.json(await queries.getControleCartao(Number(req.params.id), req.user.id));
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

app.get("/api/mensal", auth, async (req, res) => {
  try {
    const ano = req.query.ano;
    if (!ano || !/^\d{4}$/.test(ano)) return res.status(400).json({ erro: "Ano inválido" });

    const result = await pool.query(`
      SELECT
        TO_CHAR(data::date, 'MM') as mes_num,
        SUM(CASE WHEN tipo='entrada' THEN valor ELSE 0 END) as entradas,
        SUM(CASE WHEN tipo='saida' THEN valor ELSE 0 END) as saidas
      FROM movimentacoes
      WHERE TO_CHAR(data::date, 'YYYY') = $1 AND usuario_id = $2
      GROUP BY TO_CHAR(data::date, 'MM')
      ORDER BY mes_num
    `, [ano, req.user.id]);

    const mapa = {};
    result.rows.forEach(d => {
      mapa[d.mes_num] = { entradas: Number(d.entradas) || 0, saidas: Number(d.saidas) || 0 };
    });

    const nomesMes = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
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
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

const PDFDocument = require("pdfkit");

app.get("/api/relatorio-pdf", auth, async (req, res) => {
  try {
    const mes = req.query.mes;
    if (!mes) return res.status(400).send("Mês obrigatório");

    const result = await pool.query(`
      SELECT data, descricao, tipo, valor
      FROM movimentacoes
      WHERE LEFT(data, 7) = $1 AND usuario_id = $2
      ORDER BY data
    `, [mes, req.user.id]);

    const movimentacoes = result.rows;
    const doc = new PDFDocument({ margin: 50 });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename=relatorio-${mes}.pdf`);
    doc.pipe(res);

    doc.fontSize(24).fillColor("#0ea5e9").text("CONTROLE FINANCEIRO", { align: "center" });
    doc.moveDown(0.3);
    doc.fontSize(14).fillColor("gray").text(`Relatório Mensal - ${mes}`, { align: "center" });
    doc.moveDown(2);

    let totalEntradas = 0, totalSaidas = 0;
    movimentacoes.forEach(m => {
      if (m.tipo === "entrada") totalEntradas += m.valor;
      if (m.tipo === "saida") totalSaidas += m.valor;
    });
    const saldo = totalEntradas - totalSaidas;

    const boxTop = doc.y;
    doc.rect(50, boxTop, 500, 80).fillOpacity(0.05).fillAndStroke("#0ea5e9", "#0ea5e9");
    doc.fillOpacity(1);
    doc.fontSize(14).fillColor("black").text("Resumo do Mês", 60, boxTop + 10);
    doc.fillColor("green").text(`Entradas: R$ ${totalEntradas.toFixed(2)}`, 60, boxTop + 30);
    doc.fillColor("red").text(`Saídas: R$ ${totalSaidas.toFixed(2)}`, 220, boxTop + 30);
    doc.fillColor("#0ea5e9").text(`Saldo: R$ ${saldo.toFixed(2)}`, 380, boxTop + 30);
    doc.moveDown(4);

    doc.fontSize(14).fillColor("black").text("Movimentações", { underline: true });
    doc.moveDown(1);
    doc.fontSize(11).fillColor("black");
    const startX = 50;
    doc.text("Data", startX); doc.text("Descrição", startX + 80);
    doc.text("Tipo", startX + 320); doc.text("Valor", startX + 380);
    doc.moveDown(0.3);
    doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
    doc.moveDown(0.8);

    movimentacoes.forEach(m => {
      const y = doc.y;
      doc.fillColor("black").text(m.data, startX, y);
      doc.text(m.descricao, startX + 80, y);
      doc.fillColor(m.tipo === "entrada" ? "green" : "red").text(m.tipo.toUpperCase(), startX + 320, y);
      doc.text(`R$ ${Number(m.valor).toFixed(2)}`, startX + 380, y);
      doc.moveDown(0.8);
    });

    doc.moveDown(2);
    doc.fontSize(16).fillColor("#0ea5e9").text(`Saldo Final do Mês: R$ ${saldo.toFixed(2)}`, { align: "right" });
    doc.moveDown(2);
    doc.fontSize(9).fillColor("gray").text("Documento gerado automaticamente pelo sistema Cash Control", { align: "center" });
    doc.end();
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

app.get("/api/cartoes/compra/:id/parcelas", auth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT numero_parcela, total_parcelas, mes_ref, valor, status
      FROM parcelas_cartao
      WHERE compra_id = $1
      ORDER BY numero_parcela
    `, [Number(req.params.id)]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

app.get("/api/cartoes/:id/previsao", auth, async (req, res) => {
  try {
    res.json(await queries.getPrevisaoCartao(Number(req.params.id), req.user.id));
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

app.get("/api/diario", auth, async (req, res) => {
  try {
    const mes = req.query.mes;
    if (!mes || !/^\d{4}-\d{2}$/.test(mes)) {
      return res.status(400).json({ erro: "Mes invalido. Use YYYY-MM" });
    }

    const result = await pool.query(`
      SELECT
        TO_CHAR(data::date, 'DD') as dia,
        SUM(CASE WHEN tipo='entrada' THEN valor ELSE 0 END) as entradas,
        SUM(CASE WHEN tipo='saida' THEN valor ELSE 0 END) as saidas
      FROM movimentacoes
      WHERE LEFT(data, 7) = $1 AND usuario_id = $2
      GROUP BY TO_CHAR(data::date, 'DD')
      ORDER BY dia
    `, [mes, req.user.id]);

    const mapa = {};
    result.rows.forEach(d => {
      mapa[d.dia] = { entradas: Number(d.entradas) || 0, saidas: Number(d.saidas) || 0 };
    });

    const [ano, mesNum] = mes.split("-").map(Number);
    const diasNoMes = new Date(ano, mesNum, 0).getDate();
    const resultado = [];
    for (let i = 1; i <= diasNoMes; i++) {
      const dia = String(i).padStart(2, "0");
      resultado.push({ dia, entradas: mapa[dia]?.entradas || 0, saidas: mapa[dia]?.saidas || 0 });
    }

    res.json(resultado);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

async function startServer(port = process.env.PORT || 3000) {
  await ensureDB();
  const server = app.listen(port, () => {
    console.log(`Servidor rodando em http://localhost:${port}`);
  });
  return server;
}

// app é exportado para uso como serverless function no Vercel
module.exports = { app, startServer };
