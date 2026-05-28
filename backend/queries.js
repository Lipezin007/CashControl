const pool = require("./db");
const { getTaxaReferencia, DEFAULT_CDI_ANUAL } = require("./rendimentoService");

// Helper para transações PostgreSQL
async function withTransaction(callback) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

function formatMes(date) {
  return date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0");
}

function round2(n) { return Math.round(Number(n) * 100) / 100; }

function yyyymmFromDate(yyyy_mm_dd) {
  return String(yyyy_mm_dd).slice(0, 7);
}

function addMonths(yyyymm, k) {
  const [y, m] = yyyymm.split("-").map(Number);
  const d = new Date(y, (m - 1) + k, 1);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
}

function calcParcelaFixa(valorTotal, n, jurosMensal) {
  const P = Number(valorTotal);
  const i = Number(jurosMensal || 0);
  const N = Number(n);
  if (!i) return P / N;
  return (P * i) / (1 - Math.pow(1 + i, -N));
}

function parseDataFlex(isoLikeDate) {
  if (!isoLikeDate) return null;
  const raw = String(isoLikeDate).trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [y, m, d] = raw.split("-").map(Number);
    return new Date(y, m - 1, d, 12, 0, 0, 0);
  }
  const parsed = new Date(raw.replace(" ", "T"));
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function diasDecorridos(dataInicio) {
  const inicio = parseDataFlex(dataInicio);
  if (!inicio) return 0;
  const hoje = new Date();
  const inicioDia = new Date(inicio.getFullYear(), inicio.getMonth(), inicio.getDate());
  const hojeDia = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
  return Math.max(0, Math.floor((hojeDia - inicioDia) / 86400000));
}

function calcularRendimento(saldo, percentual, dias, cdiAnual) {
  const p = Number(percentual || 0);
  const d = Number(dias || 0);
  const s = Number(saldo || 0);
  const cdi = Number(cdiAnual || 0);
  if (s <= 0 || p <= 0 || d <= 0 || cdi <= 0) return s;
  const taxaDia = (p / 100) * cdi / 365;
  return Number((s * Math.pow(1 + taxaDia, d)).toFixed(2));
}

function normalizarTextoBusca(valor) {
  return String(valor || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

// ===== CATEGORIAS =====

async function getCategorias(usuario_id) {
  const result = await pool.query(
    "SELECT * FROM categorias WHERE usuario_id = $1 ORDER BY nome",
    [usuario_id]
  );
  return result.rows;
}

async function addCategoria(usuario_id, nome) {
  const result = await pool.query(
    "INSERT INTO categorias (usuario_id, nome) VALUES ($1, $2) RETURNING id",
    [usuario_id, nome]
  );
  return result.rows[0];
}

// ===== MOVIMENTAÇÕES =====

async function inserirMovimentacao(descricao, valor, tipo, categoria_id, data, usuario_id) {
  await pool.query(
    "INSERT INTO movimentacoes (descricao, valor, tipo, categoria_id, data, usuario_id) VALUES ($1, $2, $3, $4, $5, $6)",
    [descricao, valor, tipo, categoria_id, data, usuario_id]
  );
}

async function updateMovimentacao(id, descricao, valor, tipo, categoria_id, data, usuario_id) {
  const result = await pool.query(
    "UPDATE movimentacoes SET descricao=$1, valor=$2, tipo=$3, categoria_id=$4, data=$5 WHERE id=$6 AND usuario_id=$7",
    [descricao, valor, tipo, categoria_id, data, id, usuario_id]
  );
  return { changes: result.rowCount };
}

async function getMovimentacoes(mes, usuario_id = null) {
  const result = await pool.query(`
    SELECT
      m.id, m.data, m.descricao, m.valor, m.tipo,
      c.nome as categoria,
      NULL as parcela_num,
      NULL as parcela_total
    FROM movimentacoes m
    LEFT JOIN categorias c ON c.id = m.categoria_id
      AND (c.usuario_id IS NULL OR c.usuario_id = $1)
    WHERE TO_CHAR(m.data::date, 'YYYY-MM') = $2
      AND m.usuario_id = $1
    ORDER BY m.data DESC
  `, [usuario_id, mes]);
  return result.rows;
}

async function criarMovimentacao(payload) {
  const { descricao, valor, tipo, origem, data, categoria_id, usuario_id } = payload;
  if (origem === "cartao_credito") return criarCompraCartao(payload);
  await pool.query(`
    INSERT INTO movimentacoes (descricao, valor, tipo, origem, data, categoria_id, usuario_id)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
  `, [descricao, round2(valor), tipo, origem, data, categoria_id ?? null, usuario_id]);
}

async function editarMovimentacao(id, payload, usuario_id) {
  const { descricao, valor, tipo, origem, data, categoria_id, cartao_id } = payload;
  const result = await pool.query(`
    UPDATE movimentacoes
    SET descricao=$1, valor=$2, tipo=$3, origem=$4, data=$5, categoria_id=$6, cartao_id=$7
    WHERE id=$8 AND usuario_id=$9
  `, [descricao, round2(valor), tipo, origem, data, categoria_id ?? null, cartao_id ?? null, Number(id), usuario_id]);
  return { changes: result.rowCount };
}

async function deletarMovimentacao(id, usuario_id) {
  const result = await pool.query(
    "DELETE FROM movimentacoes WHERE id=$1 AND usuario_id=$2",
    [Number(id), usuario_id]
  );
  return { changes: result.rowCount };
}

// ===== SALDOS =====

async function getSaldoAtual(usuario_id) {
  const hoje = new Date().toISOString().slice(0, 10);
  const result = await pool.query(`
    SELECT COALESCE(SUM(
      CASE WHEN tipo='entrada' THEN valor WHEN tipo='saida' THEN -valor END
    ), 0) AS saldo
    FROM movimentacoes
    WHERE data <= $1 AND usuario_id = $2
  `, [hoje, usuario_id]);
  return Number(result.rows[0].saldo);
}

async function getSaldoDisponivelParaCaixinhas(usuario_id) {
  const extResult = await pool.query(`
    SELECT COALESCE(SUM(
      CASE WHEN tipo='entrada' THEN valor WHEN tipo='saida' THEN -valor END
    ), 0) AS saldo
    FROM movimentacoes
    WHERE usuario_id = $1 AND COALESCE(origem, '') != 'caixinha'
  `, [usuario_id]);

  const totalResult = await pool.query(
    "SELECT COALESCE(SUM(saldo), 0) AS total FROM caixinhas WHERE usuario_id = $1",
    [usuario_id]
  );

  return Number(extResult.rows[0].saldo || 0) - Number(totalResult.rows[0].total || 0);
}

async function getResumo(mesYYYYMM, usuario_id) {
  const result = await pool.query(`
    SELECT
      COALESCE(SUM(valor) FILTER (WHERE tipo='entrada'), 0) AS entradas,
      COALESCE(SUM(valor) FILTER (WHERE tipo='saida'), 0) AS saidas,
      COALESCE(SUM(
        CASE WHEN tipo='entrada' THEN valor WHEN tipo='saida' THEN -valor END
      ), 0) AS saldo
    FROM movimentacoes
    WHERE LEFT(data, 7) = $1 AND usuario_id = $2
  `, [mesYYYYMM, usuario_id]);
  return result.rows[0];
}

async function relatorioPorCategoria(mes, usuario_id = null) {
  const result = await pool.query(`
    SELECT
      c.nome AS categoria,
      COALESCE(SUM(CASE WHEN t.tipo='saida' THEN t.valor ELSE 0 END), 0) AS total_saidas,
      COALESCE(SUM(CASE WHEN t.tipo='entrada' THEN t.valor ELSE 0 END), 0) AS total_entradas
    FROM categorias c
    LEFT JOIN movimentacoes t
      ON t.categoria_id = c.id
      AND (c.usuario_id IS NULL OR c.usuario_id = $1)
      AND LEFT(t.data, 7) = $2
    WHERE (c.usuario_id IS NULL OR c.usuario_id = $1)
    GROUP BY c.id, c.nome
    ORDER BY total_saidas DESC, total_entradas DESC
  `, [usuario_id, mes]);
  return result.rows;
}

// ===== RECORRÊNCIAS =====

async function getRecorrencias(usuario_id = null) {
  const result = await pool.query(`
    SELECT r.*, c.nome as categoria
    FROM recorrencias r
    LEFT JOIN categorias c ON c.id = r.categoria_id
      AND (c.usuario_id IS NULL OR c.usuario_id = $1)
    WHERE r.usuario_id = $1
    ORDER BY r.dia_mes ASC, r.id DESC
  `, [usuario_id]);
  return result.rows;
}

async function addRecorrencia(descricao, valor, tipo, categoria_id, dia_mes, usuario_id) {
  const result = await pool.query(`
    INSERT INTO recorrencias (descricao, valor, tipo, categoria_id, dia_mes, ativo, usuario_id)
    VALUES ($1, $2, $3, $4, $5, 1, $6) RETURNING id
  `, [descricao, valor, tipo, categoria_id ?? null, dia_mes, usuario_id]);
  return result.rows[0];
}

async function setRecorrenciaAtiva(id, ativo, usuario_id) {
  const result = await pool.query(
    "UPDATE recorrencias SET ativo=$1 WHERE id=$2 AND usuario_id=$3",
    [ativo ? 1 : 0, id, usuario_id]
  );
  return { changes: result.rowCount };
}

async function deleteRecorrencia(id, usuario_id) {
  const result = await pool.query(
    "DELETE FROM recorrencias WHERE id=$1 AND usuario_id=$2",
    [id, usuario_id]
  );
  return { changes: result.rowCount };
}

async function updateRecorrencia(id, descricao, valor, tipo, categoria_id, dia_mes, ativo, usuario_id) {
  const result = await pool.query(`
    UPDATE recorrencias
    SET descricao=$1, valor=$2, tipo=$3, categoria_id=$4, dia_mes=$5, ativo=$6
    WHERE id=$7 AND usuario_id=$8
  `, [descricao, valor, tipo, categoria_id ?? null, dia_mes, ativo ? 1 : 0, id, usuario_id]);
  return { changes: result.rowCount };
}

async function resumoRecorrencias() {
  const result = await pool.query(`
    SELECT
      COALESCE(SUM(CASE WHEN tipo='entrada' THEN valor ELSE 0 END), 0) AS entradas,
      COALESCE(SUM(CASE WHEN tipo='saida' THEN valor ELSE 0 END), 0) AS saidas,
      COALESCE(SUM(CASE WHEN tipo='entrada' THEN valor ELSE 0 END), 0) -
      COALESCE(SUM(CASE WHEN tipo='saida' THEN valor ELSE 0 END), 0) AS saldo
    FROM recorrencias
    WHERE ativo = 1
  `);
  return result.rows[0];
}

async function gerarRecorrencias(mesYYYYMM, usuario_id) {
  const recorrsResult = await pool.query(
    "SELECT * FROM recorrencias WHERE ativo = 1 AND usuario_id = $1",
    [usuario_id]
  );

  let criadas = 0;
  for (const r of recorrsResult.rows) {
    const data = `${mesYYYYMM}-${String(r.dia_mes).padStart(2, "0")}`;

    const existeResult = await pool.query(`
      SELECT 1 FROM movimentacoes
      WHERE descricao=$1 AND valor=$2 AND tipo=$3
        AND COALESCE(categoria_id, 0) = COALESCE($4, 0)
        AND data=$5 AND usuario_id=$6
      LIMIT 1
    `, [r.descricao, r.valor, r.tipo, r.categoria_id, data, usuario_id]);

    if (!existeResult.rows[0]) {
      await pool.query(`
        INSERT INTO movimentacoes (descricao, valor, tipo, origem, categoria_id, data, usuario_id)
        VALUES ($1, $2, $3, 'pix', $4, $5, $6)
      `, [r.descricao, r.valor, r.tipo, r.categoria_id, data, usuario_id]);
      criadas++;
    }
  }

  return { ok: true, mes: mesYYYYMM, criadas };
}

// ===== CARTÕES =====

async function addCartao(usuario_id, nome, limite, dia_fechamento, dia_vencimento) {
  const result = await pool.query(`
    INSERT INTO cartoes (usuario_id, nome, limite, dia_fechamento, dia_vencimento)
    VALUES ($1, $2, $3, $4, $5) RETURNING id
  `, [usuario_id, nome, limite, dia_fechamento, dia_vencimento]);
  return result.rows[0];
}

async function getCartoes(usuario_id) {
  const result = await pool.query(
    "SELECT * FROM cartoes WHERE usuario_id = $1 AND ativo = 1 ORDER BY nome",
    [usuario_id]
  );
  return result.rows;
}

async function updateCartao(id, usuario_id, nome, limite, dia_fechamento, dia_vencimento) {
  const result = await pool.query(`
    UPDATE cartoes
    SET nome=$1, limite=$2, dia_fechamento=$3, dia_vencimento=$4
    WHERE id=$5 AND usuario_id=$6 AND ativo=1
  `, [nome, Number(limite || 0), Number(dia_fechamento), Number(dia_vencimento), Number(id), usuario_id]);
  return { changes: result.rowCount };
}

async function deleteCartao(id, usuario_id) {
  const result = await pool.query(
    "UPDATE cartoes SET ativo=0 WHERE id=$1 AND usuario_id=$2 AND ativo=1",
    [Number(id), usuario_id]
  );
  return { changes: result.rowCount };
}

async function criarCompraCartao({
  cartao_id, descricao, valor_total, parcelas, juros_mensal, data_compra, categoria_id, usuario_id
}) {
  return withTransaction(async (client) => {
    const cartaoResult = await client.query(
      "SELECT dia_fechamento FROM cartoes WHERE id=$1 AND usuario_id=$2",
      [cartao_id, usuario_id]
    );

    const cartao = cartaoResult.rows[0];
    if (!cartao) return { ok: false, erro: "Cartão não encontrado" };

    const compraResult = await client.query(`
      INSERT INTO compras_cartao
        (cartao_id, descricao, valor_total, parcelas, juros_mensal, data_compra, categoria_id, usuario_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id
    `, [cartao_id, descricao, Number(valor_total), Number(parcelas), Number(juros_mensal || 0), data_compra, categoria_id ?? null, usuario_id]);

    const compraId = compraResult.rows[0].id;

    const data = new Date(data_compra);
    let mes0Date = new Date(data.getFullYear(), data.getMonth(), 1);
    if (data.getDate() > cartao.dia_fechamento) mes0Date.setMonth(mes0Date.getMonth() + 1);

    const N = Number(parcelas);
    const total = Number(valor_total);
    const parcelaBase = Math.floor((total / N) * 100) / 100;
    let totalDistribuido = 0;

    console.log("mes inicial:", mes0Date);
    for (let p = 1; p <= N; p++) {
      let valorParcela = parcelaBase;
      if (p === N) valorParcela = Number((total - totalDistribuido).toFixed(2));
      totalDistribuido += valorParcela;

      const d = new Date(mes0Date);
      d.setMonth(mes0Date.getMonth() + (p - 1));
      const mesRef = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");

      await client.query(`
        INSERT INTO parcelas_cartao
          (cartao_id, valor, numero_parcela, total_parcelas, mes_ref, usuario_id, status, compra_id)
        VALUES ($1, $2, $3, $4, $5, $6, 'aberta', $7)
      `, [cartao_id, valorParcela, p, N, mesRef, usuario_id, compraId]);
    }

    return { ok: true, compraId };
  });
}

async function getFaturaCartao(cartao_id, mes, usuario_id = null) {
  const result = await pool.query(`
    SELECT
      pc.compra_id, pc.numero_parcela, pc.total_parcelas,
      cc.descricao, cc.categoria_id,
      c.nome AS categoria,
      pc.valor, pc.mes_ref, pc.status
    FROM parcelas_cartao pc
    JOIN compras_cartao cc ON cc.id = pc.compra_id
    JOIN cartoes ca ON ca.id = pc.cartao_id
    LEFT JOIN categorias c ON c.id = cc.categoria_id
      AND (c.usuario_id IS NULL OR c.usuario_id = $1)
    WHERE pc.cartao_id = $2 AND pc.mes_ref = $3
      AND pc.status = 'aberta' AND ca.usuario_id = $1
    ORDER BY pc.numero_parcela
  `, [usuario_id, cartao_id, mes]);

  const itens = result.rows;
  const total = itens.reduce((s, x) => s + Number(x.valor), 0);
  return { cartao_id, mes, total, itens };
}

async function getFaturasMes(mesYYYYMM, usuario_id) {
  const result = await pool.query(`
    SELECT
      ca.id AS cartao_id,
      ca.nome AS cartao,
      COALESCE(SUM(pc.valor), 0) AS total
    FROM cartoes ca
    LEFT JOIN parcelas_cartao pc
      ON pc.cartao_id = ca.id AND pc.mes_ref = $1 AND pc.status = 'aberta'
    WHERE ca.ativo = 1 AND ca.usuario_id = $2
    GROUP BY ca.id, ca.nome
    HAVING COALESCE(SUM(pc.valor), 0) > 0
    ORDER BY total DESC
  `, [mesYYYYMM, usuario_id]);
  return result.rows;
}

async function setParcelaStatus(id, status, usuario_id) {
  const result = await pool.query(
    "UPDATE parcelas_cartao SET status=$1 WHERE id=$2 AND cartao_id IN (SELECT id FROM cartoes WHERE usuario_id=$3)",
    [status, Number(id), usuario_id]
  );
  return { changes: result.rowCount };
}

async function deleteCompraCartao(id, usuario_id) {
  return withTransaction(async (client) => {
    const compraResult = await client.query(`
      SELECT cc.id FROM compras_cartao cc
      JOIN cartoes ca ON ca.id = cc.cartao_id
      WHERE cc.id=$1 AND ca.usuario_id=$2
    `, [id, usuario_id]);

    if (!compraResult.rows[0]) return { ok: false, erro: "Acesso negado" };

    await client.query("DELETE FROM parcelas_cartao WHERE compra_id=$1", [id]);
    await client.query("DELETE FROM compras_cartao WHERE id=$1", [id]);
    return { ok: true };
  });
}

// ===== RELATÓRIOS =====

async function getRelatorioCategorias(mes, usuario_id) {
  const result = await pool.query(`
    SELECT
      c.id,
      c.nome AS categoria,
      COALESCE(SUM(saidas), 0) as total_saidas,
      COALESCE(SUM(entradas), 0) as total_entradas,
      COALESCE(meta.valor_meta, 0) as meta
    FROM categorias c
    LEFT JOIN (
      SELECT
        categoria_id,
        CASE WHEN tipo='saida' THEN valor ELSE 0 END as saidas,
        CASE WHEN tipo='entrada' THEN valor ELSE 0 END as entradas
      FROM movimentacoes
      WHERE LEFT(data, 7) = $1 AND usuario_id = $2
    ) mov ON mov.categoria_id = c.id
    LEFT JOIN metas_categoria meta
      ON meta.categoria_id = c.id AND meta.mes = $1 AND meta.usuario_id = $2
    WHERE c.usuario_id = $2
    GROUP BY c.id, c.nome, meta.valor_meta
    ORDER BY total_saidas DESC
  `, [mes, usuario_id]);
  return result.rows;
}

async function getPrevisao(mesYYYYMM, usuario_id) {
  const hoje = new Date();
  const mesAtual = hoje.getFullYear() + "-" + String(hoje.getMonth() + 1).padStart(2, "0");
  const diaHoje = hoje.getDate();

  let diaMin = 1;
  if (mesYYYYMM === mesAtual) diaMin = diaHoje;
  if (mesYYYYMM < mesAtual) diaMin = 99;

  const recResult = await pool.query(`
    SELECT
      COALESCE(SUM(CASE WHEN tipo='entrada' THEN valor ELSE 0 END), 0) AS entradas_previstas,
      COALESCE(SUM(CASE WHEN tipo='saida' THEN valor ELSE 0 END), 0) AS saidas_previstas
    FROM recorrencias
    WHERE ativo = 1 AND dia_mes >= $1 AND usuario_id = $2
  `, [diaMin, usuario_id]);

  const atualResult = await pool.query(`
    SELECT COALESCE(SUM(
      CASE WHEN tipo='entrada' THEN valor WHEN tipo='saida' THEN -valor END
    ), 0) AS saldo_atual
    FROM movimentacoes
    WHERE data <= CURRENT_DATE::text AND usuario_id = $1
  `, [usuario_id]);

  const rec = recResult.rows[0];
  const atual = atualResult.rows[0];
  const saldo_previsto = Number(atual.saldo_atual) + Number(rec.entradas_previstas) - Number(rec.saidas_previstas);

  return {
    mes: mesYYYYMM,
    saldo_atual: Number(atual.saldo_atual),
    entradas_previstas: Number(rec.entradas_previstas),
    saidas_previstas: Number(rec.saidas_previstas),
    saldo_previsto: Number(saldo_previsto)
  };
}

async function getPrevisaoMes(mesYYYYMM) {
  const resumo = await getResumo(mesYYYYMM);
  return {
    saldo_atual: resumo.saldo,
    entradas_previstas: resumo.entradas,
    saidas_previstas: resumo.saidas,
    saldo_previsto: Number(resumo.saldo) + Number(resumo.entradas) - Number(resumo.saidas)
  };
}

// ===== DASHBOARD / METAS =====

async function getDashboard(mes, usuario_id) {
  const resumoResult = await pool.query(`
    SELECT
      COALESCE(SUM(CASE WHEN tipo='entrada' THEN valor ELSE 0 END), 0) as entradas,
      COALESCE(SUM(CASE WHEN tipo='saida' THEN valor ELSE 0 END), 0) as saidas
    FROM movimentacoes
    WHERE LEFT(data, 7) = $1 AND usuario_id = $2
  `, [mes, usuario_id]);

  const saldoResult = await pool.query(`
    SELECT COALESCE(SUM(
      CASE WHEN tipo='entrada' THEN valor WHEN tipo='saida' THEN -valor END
    ), 0) as saldo
    FROM movimentacoes WHERE usuario_id = $1
  `, [usuario_id]);

  const faturaResult = await pool.query(`
    SELECT COALESCE(SUM(pc.valor), 0) as total
    FROM parcelas_cartao pc
    JOIN compras_cartao cc ON cc.id = pc.compra_id
    WHERE pc.mes_ref = $1 AND pc.status = 'aberta' AND cc.usuario_id = $2
  `, [mes, usuario_id]);

  return {
    saldo: Number(saldoResult.rows[0].saldo),
    entradas: Number(resumoResult.rows[0].entradas),
    saidas: Number(resumoResult.rows[0].saidas),
    fatura: Number(faturaResult.rows[0].total)
  };
}

async function setMetaCategoria(usuario_id, categoria_id, valor_meta, mes) {
  await pool.query(`
    INSERT INTO metas_categoria (usuario_id, categoria_id, mes, valor_meta)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (usuario_id, categoria_id, mes) DO UPDATE SET valor_meta = EXCLUDED.valor_meta
  `, [usuario_id, categoria_id, mes, valor_meta]);
  return { ok: true };
}

async function getMetasComGasto(mes, usuario_id = null) {
  const result = await pool.query(`
    SELECT
      c.nome as categoria,
      m.valor_meta,
      COALESCE(SUM(CASE WHEN mov.tipo='saida' THEN mov.valor ELSE 0 END), 0) as gasto_mes
    FROM metas_categoria m
    JOIN categorias c ON c.id = m.categoria_id
      AND (c.usuario_id IS NULL OR c.usuario_id = $1)
    LEFT JOIN movimentacoes mov ON mov.categoria_id = c.id
      AND LEFT(mov.data, 7) = $2 AND mov.usuario_id = $1
    WHERE m.usuario_id = $1
    GROUP BY c.id, c.nome, m.valor_meta
  `, [usuario_id, mes]);
  return result.rows;
}

// ===== CONTROLE DE CARTÃO =====

async function getControleCartao(cartao_id, usuario_id) {
  const cartaoResult = await pool.query(
    "SELECT id, nome, limite FROM cartoes WHERE id=$1 AND usuario_id=$2",
    [cartao_id, usuario_id]
  );

  const cartao = cartaoResult.rows[0];
  if (!cartao) return null;

  const usadoResult = await pool.query(
    "SELECT COALESCE(SUM(valor), 0) as total FROM parcelas_cartao WHERE cartao_id=$1 AND status='aberta'",
    [cartao_id]
  );

  const usado = Number(usadoResult.rows[0].total);
  const limite = Number(cartao.limite);
  const disponivel = limite - usado;
  const percentual = limite > 0 ? (usado / limite) * 100 : 0;

  return { nome: cartao.nome, limite, usado, disponivel, percentual };
}

async function getPrevisaoCartao(cartao_id, usuario_id) {
  const result = await pool.query(`
    SELECT pc.mes_ref, SUM(pc.valor) as total
    FROM parcelas_cartao pc
    JOIN cartoes ca ON ca.id = pc.cartao_id
    WHERE pc.cartao_id = $1 AND pc.status = 'aberta'
      AND pc.mes_ref >= TO_CHAR(CURRENT_DATE, 'YYYY-MM')
      AND ca.usuario_id = $2
    GROUP BY pc.mes_ref
    ORDER BY pc.mes_ref
  `, [cartao_id, usuario_id]);
  return result.rows;
}

async function getMesFaturaAtual(cartao_id, usuario_id) {
  const result = await pool.query(
    "SELECT dia_fechamento FROM cartoes WHERE id=$1 AND usuario_id=$2",
    [cartao_id, usuario_id]
  );
  const cartao = result.rows[0];
  const hoje = new Date();
  let mes = hoje.toISOString().slice(0, 7);
  if (hoje.getDate() > cartao.dia_fechamento) mes = addMonths(mes, 1);
  return mes;
}

async function getPrevisaoLimite(cartao_id, usuario_id) {
  const cartaoResult = await pool.query(
    "SELECT limite FROM cartoes WHERE id=$1 AND usuario_id=$2",
    [cartao_id, usuario_id]
  );

  const parcelasResult = await pool.query(`
    SELECT mes_ref, SUM(valor) as total
    FROM parcelas_cartao
    WHERE cartao_id=$1 AND status='aberta'
    GROUP BY mes_ref ORDER BY mes_ref
  `, [cartao_id]);

  const limite = Number(cartaoResult.rows[0].limite);
  const parcelas = parcelasResult.rows;
  let usado = parcelas.reduce((s, p) => s + Number(p.total), 0);

  return parcelas.map(p => {
    usado -= Number(p.total);
    return { mes: p.mes_ref, limite_liberado: limite - usado };
  });
}

async function getLimiteCartao(cartao_id, usuario_id) {
  const cartao = await pool.query(
    "SELECT limite FROM cartoes WHERE id=$1 AND usuario_id=$2",
    [cartao_id, usuario_id]
  );
  const usado = await pool.query(
    "SELECT COALESCE(SUM(valor), 0) as total FROM parcelas_cartao WHERE cartao_id=$1 AND status != 'paga'",
    [cartao_id]
  );
  const limite = Number(cartao.rows[0]?.limite || 0);
  const totalUsado = Number(usado.rows[0].total);
  return { limite, usado: totalUsado, disponivel: limite - totalUsado };
}

// ===== CAIXINHAS =====

async function getPercentualAutomatico(caixinha) {
  const instituicao = String(caixinha.instituicao || "").trim();
  const produto = String(caixinha.produto || "Conta").trim();
  const indexador = String(caixinha.rendimento_tipo || "CDI").toUpperCase();

  if (!instituicao) return null;

  const instituicaoNorm = normalizarTextoBusca(instituicao);
  const produtoNorm = normalizarTextoBusca(produto);
  const indexadoresBusca = indexador === "CDI" ? ["CDI"] : [indexador, "CDI"];

  for (const idx of indexadoresBusca) {
    const result = await pool.query(`
      SELECT instituicao, produto, percentual, fonte, updated_at
      FROM rendimento_instituicoes
      WHERE ativo = 1 AND UPPER(indexador) = UPPER($1)
      ORDER BY updated_at DESC
    `, [idx]);

    const candidatos = result.rows;
    if (!candidatos.length) continue;

    const exato = candidatos.find((t) =>
      normalizarTextoBusca(t.instituicao) === instituicaoNorm &&
      normalizarTextoBusca(t.produto || "Conta") === produtoNorm
    );
    if (exato) return exato;

    const porInstituicao = candidatos.find((t) =>
      normalizarTextoBusca(t.instituicao) === instituicaoNorm
    );
    if (porInstituicao) return porInstituicao;
  }

  return null;
}

async function getCaixinhas(usuario_id) {
  const cdiAnual = await getTaxaReferencia("CDI_ANUAL", DEFAULT_CDI_ANUAL);

  const result = await pool.query(`
    SELECT
      c.*,
      (
        SELECT MAX(COALESCE(cm.data_hora, cm.data))
        FROM caixinha_movimentacoes cm
        WHERE cm.caixinha_id = c.id AND cm.usuario_id = c.usuario_id
      ) AS ultima_movimentacao_em
    FROM caixinhas c
    WHERE c.usuario_id = $1
    ORDER BY created_at DESC, id DESC
  `, [usuario_id]);

  return Promise.all(result.rows.map(async (c) => {
    const dataInicioRendimento = c.ultima_movimentacao_em || c.created_at;
    const dias = diasDecorridos(dataInicioRendimento);
    const auto = Number(c.auto_percentual || 0) === 1;
    const autoTaxa = auto ? await getPercentualAutomatico(c) : null;
    const percentualAplicado = autoTaxa ? Number(autoTaxa.percentual) : Number(c.rendimento_percentual || 0);
    const saldoAtualizado = calcularRendimento(c.saldo, percentualAplicado, dias, cdiAnual);
    const rendimento = Number((saldoAtualizado - Number(c.saldo || 0)).toFixed(2));
    const percentualOrigem = autoTaxa ? "automatico" : (auto ? "manual_fallback" : "manual");
    const avisoAuto = auto && !autoTaxa ? "Taxa da instituição não encontrada. Usando percentual manual." : null;

    return {
      ...c,
      data_inicio_rendimento: dataInicioRendimento,
      percentual_aplicado: percentualAplicado,
      percentual_origem: percentualOrigem,
      percentual_fonte: autoTaxa?.fonte || null,
      percentual_updated_at: autoTaxa?.updated_at || null,
      aviso_auto: avisoAuto,
      cdi_anual: cdiAnual,
      dias,
      dias_rendimento: dias,
      saldo_atualizado: saldoAtualizado,
      rendimento,
      rendimento_estimado: rendimento
    };
  }));
}

async function addCaixinha(usuario_id, nome, objetivo, rendimento_tipo, rendimento_percentual, instituicao, produto, auto_percentual) {
  const result = await pool.query(`
    INSERT INTO caixinhas
      (nome, saldo, objetivo, rendimento_tipo, rendimento_percentual, instituicao, produto, auto_percentual, usuario_id)
    VALUES ($1, 0, $2, $3, $4, $5, $6, $7, $8) RETURNING id
  `, [
    String(nome || "").trim(),
    objetivo != null && objetivo !== "" ? Number(objetivo) : null,
    rendimento_tipo ? String(rendimento_tipo).trim() : null,
    rendimento_percentual != null && rendimento_percentual !== "" ? Number(rendimento_percentual) : null,
    instituicao ? String(instituicao).trim() : null,
    produto ? String(produto).trim() : null,
    auto_percentual ? 1 : 0,
    usuario_id
  ]);
  return result.rows[0];
}

async function updateCaixinha(id, usuario_id, nome, objetivo, rendimento_tipo, rendimento_percentual, instituicao, produto, auto_percentual) {
  const result = await pool.query(`
    UPDATE caixinhas
    SET nome=$1, objetivo=$2, rendimento_tipo=$3, rendimento_percentual=$4,
        instituicao=$5, produto=$6, auto_percentual=$7
    WHERE id=$8 AND usuario_id=$9
  `, [
    String(nome || "").trim(),
    objetivo != null && objetivo !== "" ? Number(objetivo) : null,
    rendimento_tipo ? String(rendimento_tipo).trim() : null,
    rendimento_percentual != null && rendimento_percentual !== "" ? Number(rendimento_percentual) : null,
    instituicao ? String(instituicao).trim() : null,
    produto ? String(produto).trim() : null,
    auto_percentual ? 1 : 0,
    Number(id),
    usuario_id
  ]);
  return { changes: result.rowCount };
}

async function deleteCaixinha(id, usuario_id) {
  return withTransaction(async (client) => {
    const caixinhaResult = await client.query(
      "SELECT id, nome, saldo FROM caixinhas WHERE id=$1 AND usuario_id=$2",
      [Number(id), usuario_id]
    );

    const caixinha = caixinhaResult.rows[0];
    if (!caixinha) throw new Error("Caixinha não encontrada");

    const saldo = Number(caixinha.saldo || 0);

    if (saldo > 0) {
      await client.query(`
        INSERT INTO movimentacoes (descricao, valor, tipo, origem, categoria_id, data, usuario_id)
        VALUES ($1, $2, 'entrada', 'caixinha', NULL, CURRENT_DATE::text, $3)
      `, [`Resgate ao excluir caixinha: ${caixinha.nome}`, saldo, usuario_id]);
    }

    await client.query(
      "DELETE FROM caixinha_movimentacoes WHERE caixinha_id=$1 AND usuario_id=$2",
      [Number(id), usuario_id]
    );

    await client.query(
      "DELETE FROM caixinhas WHERE id=$1 AND usuario_id=$2",
      [Number(id), usuario_id]
    );

    return { ok: true, valor_devolvido: saldo };
  });
}

async function movimentarCaixinha(caixinha_id, usuario_id, valor, tipo, data) {
  const valorNum = Number(valor);
  if (!Number.isFinite(valorNum) || valorNum <= 0) return { ok: false, erro: "Valor inválido" };
  if (tipo !== "deposito" && tipo !== "saque") return { ok: false, erro: "Tipo inválido" };

  const caixinhaResult = await pool.query(
    "SELECT id, nome, saldo FROM caixinhas WHERE id=$1 AND usuario_id=$2",
    [Number(caixinha_id), usuario_id]
  );

  const caixinha = caixinhaResult.rows[0];
  if (!caixinha) return { ok: false, erro: "Caixinha não encontrada" };

  if (tipo === "deposito") {
    const saldoDisponivel = Number(await getSaldoDisponivelParaCaixinhas(usuario_id) || 0);
    if (saldoDisponivel < valorNum) {
      return {
        ok: false,
        erro: "Saldo insuficiente para depositar na caixinha",
        saldo_disponivel: Number(saldoDisponivel.toFixed(2))
      };
    }
  }

  const delta = tipo === "deposito" ? valorNum : -valorNum;
  const novoSaldo = Number(caixinha.saldo || 0) + delta;
  if (novoSaldo < 0) return { ok: false, erro: "Saldo insuficiente na caixinha" };

  const dataMov = data || new Date().toISOString().slice(0, 10);
  const dataHoraMov = new Date().toISOString();
  const descricaoTransferencia = tipo === "deposito"
    ? `Transferência para caixinha : ${caixinha.nome}`
    : `Resgate da caixinha : ${caixinha.nome}`;
  const tipoMovPrincipal = tipo === "deposito" ? "saida" : "entrada";

  await withTransaction(async (client) => {
    await client.query(
      "UPDATE caixinhas SET saldo=$1 WHERE id=$2 AND usuario_id=$3",
      [Number(novoSaldo.toFixed(2)), Number(caixinha_id), usuario_id]
    );
    await client.query(
      "INSERT INTO caixinha_movimentacoes (caixinha_id, valor, tipo, data, data_hora, usuario_id) VALUES ($1, $2, $3, $4, $5, $6)",
      [Number(caixinha_id), valorNum, tipo, dataMov, dataHoraMov, usuario_id]
    );
    await client.query(
      "INSERT INTO movimentacoes (descricao, valor, tipo, origem, categoria_id, data, usuario_id) VALUES ($1, $2, $3, 'caixinha', NULL, $4, $5)",
      [descricaoTransferencia, valorNum, tipoMovPrincipal, dataMov, usuario_id]
    );
  });

  return { ok: true, saldo: Number(novoSaldo.toFixed(2)) };
}

async function getCaixinhaMovimentacoes(caixinha_id, usuario_id) {
  const result = await pool.query(`
    SELECT id, caixinha_id, valor, tipo, data, data_hora
    FROM caixinha_movimentacoes
    WHERE caixinha_id=$1 AND usuario_id=$2
    ORDER BY data DESC, id DESC
  `, [Number(caixinha_id), usuario_id]);
  return result.rows;
}

async function getCaixinhasTaxasEmUso(usuario_id) {
  const caixinhas = await getCaixinhas(usuario_id);
  return caixinhas.map((c) => ({
    id: Number(c.id),
    nome: c.nome,
    instituicao: c.instituicao || null,
    produto: c.produto || null,
    rendimento_tipo: c.rendimento_tipo || null,
    auto_percentual: Number(c.auto_percentual || 0) === 1,
    percentual_configurado: Number(c.rendimento_percentual || 0),
    percentual_aplicado: Number(c.percentual_aplicado || 0),
    percentual_origem: c.percentual_origem || "manual",
    percentual_fonte: c.percentual_fonte || null,
    percentual_updated_at: c.percentual_updated_at || null,
    aviso_auto: c.aviso_auto || null
  }));
}

async function getCaixinhasEvolucao(periodo, usuario_id, referencia = null) {
  const periodoNormalizado = ["diario", "semanal", "mensal", "anual"].includes(periodo) ? periodo : "mensal";
  const cdiAnual = await getTaxaReferencia("CDI_ANUAL", DEFAULT_CDI_ANUAL);

  const now = referencia ? new Date(referencia) : new Date();
  const nowTs = now.getTime();
  const buckets = [];

  const pushBucketAteAgora = (idx, label, start, end) => {
    if (start.getTime() > nowTs) return;
    buckets.push({ idx, label, start, end });
  };

  const caixinhasResult = await pool.query(`
    SELECT id, nome, saldo, rendimento_percentual, auto_percentual, instituicao, produto, rendimento_tipo
    FROM caixinhas WHERE usuario_id = $1 ORDER BY nome
  `, [usuario_id]);
  const caixinhas = caixinhasResult.rows;
  if (!caixinhas.length) return [];

  const movimentosResult = await pool.query(`
    SELECT caixinha_id, valor, tipo, data, data_hora
    FROM caixinha_movimentacoes
    WHERE usuario_id = $1
    ORDER BY COALESCE(data_hora, data) ASC, id ASC
  `, [usuario_id]);

  const movimentos = movimentosResult.rows.map((m) => {
    const raw = m.data_hora || (m.data ? `${m.data}T12:00:00` : null);
    const dt = raw ? new Date(String(raw).replace(" ", "T")) : null;
    return {
      caixinha_id: Number(m.caixinha_id),
      delta: m.tipo === "saque" ? -Number(m.valor || 0) : Number(m.valor || 0),
      dt: dt && !Number.isNaN(dt.getTime()) ? dt : null
    };
  }).filter((m) => m.dt);

  if (periodoNormalizado === "diario") {
    const ini = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    for (let h = 0; h < 24; h++) {
      const start = new Date(ini); start.setHours(h, 0, 0, 0);
      const end = new Date(start); end.setHours(h + 1, 0, 0, 0);
      pushBucketAteAgora(h, `${String(h).padStart(2, "0")}h`, start, end);
    }
  }

  if (periodoNormalizado === "semanal") {
    const diaSemana = now.getDay();
    const desloc = diaSemana === 0 ? -6 : 1 - diaSemana;
    const segunda = new Date(now.getFullYear(), now.getMonth(), now.getDate() + desloc, 0, 0, 0, 0);
    const labels = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sab", "Dom"];
    for (let i = 0; i < 7; i++) {
      const start = new Date(segunda); start.setDate(segunda.getDate() + i);
      const end = new Date(start); end.setDate(start.getDate() + 1);
      pushBucketAteAgora(i, labels[i], start, end);
    }
  }

  if (periodoNormalizado === "mensal") {
    const ano = now.getFullYear(); const mes = now.getMonth();
    const diasNoMes = new Date(ano, mes + 1, 0).getDate();
    for (let d = 1; d <= diasNoMes; d++) {
      const start = new Date(ano, mes, d, 0, 0, 0, 0);
      const end = new Date(ano, mes, d + 1, 0, 0, 0, 0);
      pushBucketAteAgora(d - 1, String(d).padStart(2, "0"), start, end);
    }
  }

  if (periodoNormalizado === "anual") {
    const ano = now.getFullYear();
    const labels = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
    for (let m = 0; m < 12; m++) {
      const start = new Date(ano, m, 1, 0, 0, 0, 0);
      const end = new Date(ano, m + 1, 1, 0, 0, 0, 0);
      pushBucketAteAgora(m, labels[m], start, end);
    }
  }

  if (!buckets.length) return [];
  const rangeStart = buckets[0].start;
  const result = [];

  for (const c of caixinhas) {
    const auto = Number(c.auto_percentual || 0) === 1;
    const autoTaxa = auto ? await getPercentualAutomatico(c) : null;
    const percentualAplicado = autoTaxa ? Number(autoTaxa.percentual || 0) : Number(c.rendimento_percentual || 0);

    const movCaixinha = movimentos.filter((m) => m.caixinha_id === Number(c.id));
    const deltaDentroRange = movCaixinha
      .filter((m) => m.dt >= rangeStart)
      .reduce((acc, m) => acc + Number(m.delta || 0), 0);

    let saldoRodando = Number(c.saldo || 0) - Number(deltaDentroRange || 0);

    for (const b of buckets) {
      const deltaBucket = movCaixinha
        .filter((m) => m.dt >= b.start && m.dt < b.end)
        .reduce((acc, m) => acc + Number(m.delta || 0), 0);

      saldoRodando += deltaBucket;
      const fimEfetivoBucket = new Date(Math.min(b.end.getTime(), nowTs));
      const diasBucket = Math.max(0, (fimEfetivoBucket.getTime() - b.start.getTime()) / 86400000);
      saldoRodando = calcularRendimento(saldoRodando, percentualAplicado, diasBucket, cdiAnual);

      result.push({
        caixinha_id: Number(c.id),
        caixinha_nome: c.nome,
        periodo: b.label,
        bucket_idx: b.idx,
        saldo_acumulado: Number(saldoRodando.toFixed(2))
      });
    }
  }

  return result;
}

module.exports = {
  getMovimentacoes,
  criarMovimentacao,
  editarMovimentacao,
  deletarMovimentacao,

  getCategorias,
  addCategoria,
  getResumo,

  relatorioPorCategoria,
  getRelatorioCategorias,
  getPrevisaoMes,

  getRecorrencias,
  addRecorrencia,
  updateRecorrencia,
  deleteRecorrencia,

  resumoRecorrencias,
  gerarRecorrencias,
  getPrevisaoCartao,
  addCartao,
  updateCartao,
  deleteCartao,
  getCartoes,
  criarCompraCartao,
  getFaturaCartao,
  getFaturasMes,
  getPrevisao,
  setParcelaStatus,
  deleteCompraCartao,

  getSaldoAtual,
  getSaldoDisponivelParaCaixinhas,
  getLimiteCartao,
  getDashboard,
  setMetaCategoria,
  getMetasComGasto,
  getControleCartao,
  setRecorrenciaAtiva,
  inserirMovimentacao,
  updateMovimentacao,
  getMesFaturaAtual,
  getPrevisaoLimite,
  formatMes,

  getCaixinhas,
  addCaixinha,
  updateCaixinha,
  deleteCaixinha,
  movimentarCaixinha,
  getCaixinhaMovimentacoes,
  getCaixinhasTaxasEmUso,
  getCaixinhasEvolucao
};
