const db = require("./db");

function getCategorias() {
  return db.prepare("SELECT * FROM categorias").all();
}

function addCategoria(nome) {
  return db.prepare("INSERT INTO categorias (nome) VALUES (?)").run(nome);
}

function getTransacoes(mes = null) {
  if (mes) {
    return db.prepare(`
      SELECT t.*, c.nome as categoria
      FROM transacoes t
      LEFT JOIN categorias c ON c.id = t.categoria_id
      WHERE substr(t.data, 1, 7) = ?
      ORDER BY t.data DESC
    `).all(mes);
  }

  return db.prepare(`
    SELECT t.*, c.nome as categoria
    FROM transacoes t
    LEFT JOIN categorias c ON c.id = t.categoria_id
    ORDER BY t.data DESC
  `).all();
}

function inserirTransacao(descricao, valor, tipo, categoria_id, data) {
  return db.prepare(`
    INSERT INTO transacoes (descricao, valor, tipo, categoria_id, data)
    VALUES (?, ?, ?, ?, ?)
  `).run(descricao, valor, tipo, categoria_id, data);
}

function deleteTransacao(id) {
  return db.prepare("DELETE FROM transacoes WHERE id = ?").run(id);
}

function updateTransacao(id, descricao, valor, tipo, categoria_id, data) {
  return db.prepare(`
    UPDATE transacoes
    SET descricao=?, valor=?, tipo=?, categoria_id=?, data=?
    WHERE id=?
  `).run(descricao, valor, tipo, categoria_id, data, id);
}

function getResumo(mesYYYYMM = null) {
  const where = mesYYYYMM ? "WHERE strftime('%Y-%m', data) = ?" : "";
  const stmt = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN tipo='entrada' THEN valor ELSE 0 END),0) AS entradas,
      COALESCE(SUM(CASE WHEN tipo='saida' THEN valor ELSE 0 END),0) AS saidas,
      COALESCE(SUM(CASE WHEN tipo='entrada' THEN valor ELSE 0 END),0) -
      COALESCE(SUM(CASE WHEN tipo='saida' THEN valor ELSE 0 END),0) AS saldo
    FROM transacoes
    ${where}
  `);

  return mesYYYYMM ? stmt.get(mesYYYYMM) : stmt.get();
}

function relatorioPorCategoria(mes) {
  return db.prepare(`
    SELECT
      c.nome AS categoria,
      COALESCE(SUM(CASE WHEN t.tipo='saida' THEN t.valor ELSE 0 END), 0) AS total_saidas,
      COALESCE(SUM(CASE WHEN t.tipo='entrada' THEN t.valor ELSE 0 END), 0) AS total_entradas
    FROM categorias c
    LEFT JOIN transacoes t
      ON t.categoria_id = c.id
     AND substr(t.data, 1, 7) = ?
    GROUP BY c.id
    ORDER BY total_saidas DESC, total_entradas DESC
  `).all(mes);
}

function getPrevisaoMes(mesYYYYMM) {
  const hoje = new Date();
  const y = hoje.getFullYear();
  const m = String(hoje.getMonth() + 1).padStart(2, "0");
  const mesAtual = `${y}-${m}`;
  const diaHoje = hoje.getDate();

  let diaMin = 1;
  if (mesYYYYMM === mesAtual) diaMin = diaHoje;
  if (mesYYYYMM < mesAtual) diaMin = 99;

  const rec = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN tipo='entrada' THEN valor ELSE 0 END),0) AS entradas_previstas,
      COALESCE(SUM(CASE WHEN tipo='saida' THEN valor ELSE 0 END),0) AS saidas_previstas
    FROM recorrencias
    WHERE ativo = 1
      AND dia_mes >= ?
  `).get(diaMin);

  const atual = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN tipo='entrada' THEN valor ELSE 0 END),0) -
      COALESCE(SUM(CASE WHEN tipo='saida' THEN valor ELSE 0 END),0) AS saldo_atual
    FROM transacoes
  `).get();

  const saldo_previsto =
    Number(atual.saldo_atual) + Number(rec.entradas_previstas) - Number(rec.saidas_previstas);

  return {
    mes: mesYYYYMM,
    mes_atual: mesAtual,
    dia_hoje: diaHoje,
    saldo_atual: Number(atual.saldo_atual),
    entradas_previstas: Number(rec.entradas_previstas),
    saidas_previstas: Number(rec.saidas_previstas),
    saldo_previsto: Number(saldo_previsto)
  };
}

function getRecorrencias() {
  return db.prepare(`
    SELECT r.*, c.nome as categoria
    FROM recorrencias r
    LEFT JOIN categorias c ON c.id = r.categoria_id
    ORDER BY r.dia_mes ASC, r.id DESC
  `).all();
}

function addRecorrencia(descricao, valor, tipo, categoria_id, dia_mes) {
  return db.prepare(`
    INSERT INTO recorrencias (descricao, valor, tipo, categoria_id, dia_mes)
    VALUES (?, ?, ?, ?, ?)
  `).run(descricao, valor, tipo, categoria_id ?? null, dia_mes);
}

function setRecorrenciaAtiva(id, ativo) {
  return db.prepare("UPDATE recorrencias SET ativo=? WHERE id=?").run(ativo ? 1 : 0, id);
}

function deleteRecorrencia(id) {
  return db.prepare("DELETE FROM recorrencias WHERE id=?").run(id);
}

function updateRecorrencia(id, descricao, valor, tipo, categoria_id, dia_mes, ativo) {
  return db.prepare(`
    UPDATE recorrencias
    SET descricao=?, valor=?, tipo=?, categoria_id=?, dia_mes=?, ativo=?
    WHERE id=?
  `).run(descricao, valor, tipo, categoria_id ?? null, dia_mes, ativo ? 1 : 0, id);
}

function resumoRecorrencias() {
  return db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN tipo='entrada' THEN valor ELSE 0 END),0) AS entradas,
      COALESCE(SUM(CASE WHEN tipo='saida' THEN valor ELSE 0 END),0) AS saidas,
      COALESCE(SUM(CASE WHEN tipo='entrada' THEN valor ELSE 0 END),0) -
      COALESCE(SUM(CASE WHEN tipo='saida' THEN valor ELSE 0 END),0) AS saldo
    FROM recorrencias
    WHERE ativo = 1
  `).get();
}

function gerarRecorrencias(mesYYYYMM) {
  const recorrs = db.prepare("SELECT * FROM recorrencias WHERE ativo = 1").all();

  const inserir = db.prepare(`
    INSERT INTO transacoes (descricao, valor, tipo, categoria_id, data)
    VALUES (?, ?, ?, ?, ?)
  `);

  let criadas = 0;
  for (const r of recorrs) {
    const data = `${mesYYYYMM}-${String(r.dia_mes).padStart(2, "0")}`;

    const existe = db.prepare(`
      SELECT 1 FROM transacoes
      WHERE descricao=? AND valor=? AND tipo=? AND IFNULL(categoria_id,0)=IFNULL(?,0) AND data=?
      LIMIT 1
    `).get(r.descricao, r.valor, r.tipo, r.categoria_id, data);

    if (!existe) {
      inserir.run(r.descricao, r.valor, r.tipo, r.categoria_id, data);
      criadas++;
    }
  }
  return { ok: true, mes: mesYYYYMM, criadas };
}

// ===== CARTÃO DE CRÉDITO =====
function addCartao(nome, limite, dia_fechamento, dia_vencimento) {
  return db.prepare(`
    INSERT INTO cartoes (nome, limite, dia_fechamento, dia_vencimento)
    VALUES (?, ?, ?, ?)
  `).run(nome, Number(limite || 0), Number(dia_fechamento), Number(dia_vencimento));
}

function getCartoes() {
  return db.prepare("SELECT * FROM cartoes WHERE ativo=1 ORDER BY nome").all();
}

function yyyymmFromDate(yyyy_mm_dd) {
  return String(yyyy_mm_dd).slice(0, 7);
}

function addMonths(yyyymm, k) {
  const [y, m] = yyyymm.split("-").map(Number);
  const d = new Date(y, (m - 1) + k, 1);
  const yy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${yy}-${mm}`;
}

function calcParcelaFixa(valorTotal, n, jurosMensal) {
  const P = Number(valorTotal);
  const i = Number(jurosMensal);
  const N = Number(n);
  if (!i) return P / N;
  return (P * i) / (1 - Math.pow(1 + i, -N));
}

function criarCompraCartao({ cartao_id, descricao, valor_total, parcelas, juros_mensal, data_compra, categoria_id }) {
  const insertCompra = db.prepare(`
    INSERT INTO compras_cartao (cartao_id, descricao, valor_total, parcelas, juros_mensal, data_compra, categoria_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const insertParcela = db.prepare(`
    INSERT INTO parcelas_cartao (compra_id, cartao_id, numero_parcela, total_parcelas, mes_ref, valor)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const compraInfo = insertCompra.run(
    Number(cartao_id),
    descricao,
    Number(valor_total),
    Number(parcelas),
    Number(juros_mensal || 0),
    data_compra,
    categoria_id ?? null
  );

  const compraId = compraInfo.lastInsertRowid;
  const mes0 = yyyymmFromDate(data_compra);
  const parcelaFixa = calcParcelaFixa(valor_total, parcelas, juros_mensal || 0);

  for (let p = 1; p <= Number(parcelas); p++) {
    const mesRef = addMonths(mes0, p - 1);
    insertParcela.run(compraId, Number(cartao_id), p, Number(parcelas), mesRef, parcelaFixa);
  }

  return { ok: true, compraId };
}

function getFaturaCartao(cartao_id, mesYYYYMM) {
  const itens = db.prepare(`
    SELECT pc.*, cc.descricao, cc.categoria_id, c.nome AS categoria
    FROM parcelas_cartao pc
    JOIN compras_cartao cc ON cc.id = pc.compra_id
    LEFT JOIN categorias c ON c.id = cc.categoria_id
    WHERE pc.cartao_id = ? AND pc.mes_ref = ? AND pc.status != 'cancelada'
    ORDER BY pc.numero_parcela ASC
  `).all(Number(cartao_id), mesYYYYMM);

  const total = itens.reduce((s, x) => s + Number(x.valor), 0);
  return { cartao_id: Number(cartao_id), mes: mesYYYYMM, total, itens };
}
function getFaturasMes(mesYYYYMM) {
  return db.prepare(`
    SELECT
      ca.id as cartao_id,
      ca.nome as cartao,
      COALESCE(SUM(pc.valor),0) as total
    FROM cartoes ca
    LEFT JOIN parcelas_cartao pc
      ON pc.cartao_id = ca.id
     AND pc.mes_ref = ?
     AND pc.status != 'cancelada'
    WHERE ca.ativo = 1
    GROUP BY ca.id
    HAVING total > 0
    ORDER BY total DESC
  `).all(mesYYYYMM);
}

function getMovimentacoes(mesYYYYMM) {
  const trans = getTransacoes(mesYYYYMM).map(t => ({
    id: `t-${t.id}`,
    tipo: t.tipo,
    origem: t.origem ?? "pix",
    data: t.data,
    descricao: t.descricao,
    categoria: t.categoria ?? "-",
    valor: Number(t.valor),
  }));

  const faturas = getFaturasMes(mesYYYYMM).map(f => ({
    id: `cc-${f.cartao_id}-${mesYYYYMM}`,
    tipo: "saida",
    origem: "cartao_credito",
    data: `${mesYYYYMM}-01`,
    descricao: `Fatura ${f.cartao}`,
    categoria: "Cartão",
    valor: Number(f.total),
  }));

  // junta e ordena
  return [...trans, ...faturas].sort((a, b) => (b.data + "").localeCompare(a.data + ""));
}

function setParcelaStatus(id, status) {
  return db.prepare("UPDATE parcelas_cartao SET status=? WHERE id=?").run(status, Number(id));
}

function deleteCompraCartao(id) {
  return db.prepare("DELETE FROM compras_cartao WHERE id=?").run(Number(id));
}

module.exports = {
  getCategorias,
  addCategoria,
  getTransacoes,
  inserirTransacao,
  deleteTransacao,
  updateTransacao,
  getResumo,
  relatorioPorCategoria,
  getPrevisaoMes,
  getRecorrencias,
  addRecorrencia,
  setRecorrenciaAtiva,
  deleteRecorrencia,
  updateRecorrencia,
  resumoRecorrencias,
  gerarRecorrencias,
  addCartao,
  getCartoes,
  criarCompraCartao,
  getFaturaCartao,
  setParcelaStatus,
  deleteCompraCartao,
  getFaturasMes,
  getMovimentacoes,
};