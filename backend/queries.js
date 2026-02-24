const db = require("./db");

function getCategorias() {
  return db.prepare("SELECT * FROM categorias").all();
}

function addCategoria(nome) {
  return db.prepare("INSERT INTO categorias (nome) VALUES (?)").run(nome);
}

function getMovimentacoes(mes = null) {
  if (mes) {
    return db.prepare(`
      SELECT m.*, c.nome as categoria
      FROM movimentacoes m
      LEFT JOIN categorias c ON c.id = m.categoria_id
      WHERE substr(m.data,1,7)=?
      ORDER BY m.data DESC
    `).all(mes);
  }

  return db.prepare(`
    SELECT m.*, c.nome as categoria
    FROM movimentacoes m
    LEFT JOIN categorias c ON c.id = m.categoria_id
    ORDER BY m.data DESC
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
  const i = Number(jurosMensal || 0);
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
      ca.id AS cartao_id,
      ca.nome AS cartao,
      COALESCE(SUM(pc.valor),0) AS total
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
  const trans = db.prepare(`
    SELECT t.*, c.nome AS categoria
    FROM transacoes t
    LEFT JOIN categorias c ON c.id = t.categoria_id
    WHERE substr(t.data, 1, 7) = ?
    ORDER BY t.data DESC
  `).all(mesYYYYMM).map(t => ({
    id: `t-${t.id}`,
    tipo: t.tipo,
    origem: t.origem || "pix",
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

  return [...trans, ...faturas].sort((a, b) => (b.data + "").localeCompare(a.data + ""));
}

function setParcelaStatus(id, status) {
  return db.prepare("UPDATE parcelas_cartao SET status=? WHERE id=?").run(status, Number(id));
}

function deleteCompraCartao(id) {
  return db.prepare("DELETE FROM compras_cartao WHERE id=?").run(Number(id));
}
function addMonths(yyyymm, k) {
  const [y, m] = yyyymm.split("-").map(Number);
  const d = new Date(y, (m - 1) + k, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function calcParcelaFixa(valorTotal, n, jurosMensal) {
  const P = Number(valorTotal), i = Number(jurosMensal || 0), N = Number(n);
  if (!i) return P / N;
  return (P * i) / (1 - Math.pow(1 + i, -N)); // PMT
}

function criarMovimentacao(data) {
  const stmt = db.prepare(`
    INSERT INTO movimentacoes
    (descricao, valor, tipo, origem, categoria_id, data)
    VALUES (?,?,?,?,?,?)
  `);
  return stmt.run(
    data.descricao,
    data.valor,
    data.tipo,
    data.origem,
    data.categoria_id,
    data.data
  );
}

function editarMovimentacao(id, data) {
  return db.prepare(`
    UPDATE movimentacoes
    SET descricao=?, valor=?, tipo=?, origem=?, categoria_id=?, data=?
    WHERE id=?
  `).run(
    data.descricao,
    data.valor,
    data.tipo,
    data.origem,
    data.categoria_id,
    data.data,
    id
  );
}

function deletarMovimentacao(id){
  return db.prepare(`DELETE FROM movimentacoes WHERE id=?`).run(id);
}
function getRelatorioCategorias(mes) {
  return db.prepare(`
    SELECT
      c.nome AS categoria,
      COALESCE(SUM(CASE WHEN m.tipo='saida' THEN m.valor ELSE 0 END), 0) AS total_saidas,
      COALESCE(SUM(CASE WHEN m.tipo='entrada' THEN m.valor ELSE 0 END), 0) AS total_entradas
    FROM categorias c
    LEFT JOIN movimentacoes m
      ON m.categoria_id = c.id
     AND substr(m.data, 1, 7) = ?
    GROUP BY c.id
    ORDER BY total_saidas DESC, total_entradas DESC
  `).all(mes);
}

function getPrevisao(mesYYYYMM) {
  const hoje = new Date();
  const y = hoje.getFullYear();
  const m = String(hoje.getMonth() + 1).padStart(2, "0");
  const mesAtual = `${y}-${m}`;
  const diaHoje = hoje.getDate();

  // mês atual: só conta recorrências do dia de hoje pra frente
  // mês futuro: conta tudo
  // mês passado: não conta nada (previsão)
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
    FROM movimentacoes
  `).get();

  const saldo_previsto =
    Number(atual.saldo_atual) + Number(rec.entradas_previstas) - Number(rec.saidas_previstas);

  return {
    mes: mesYYYYMM,
    saldo_atual: Number(atual.saldo_atual),
    entradas_previstas: Number(rec.entradas_previstas),
    saidas_previstas: Number(rec.saidas_previstas),
    saldo_previsto: Number(saldo_previsto),
  };
}
function addMonths(yyyymm, k) {
  const [y, m] = yyyymm.split("-").map(Number);
  const d = new Date(y, (m - 1) + k, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function calcParcelaFixa(valorTotal, n, jurosMensal) {
  const P = Number(valorTotal);
  const i = Number(jurosMensal || 0);
  const N = Number(n);
  if (!i) return P / N;
  return (P * i) / (1 - Math.pow(1 + i, -N));
}

function round2(n) { return Math.round(Number(n) * 100) / 100; }

function getMovimentacoes(mes) {
  return db.prepare(`
    SELECT m.*, c.nome AS categoria, ca.nome AS cartao
    FROM movimentacoes m
    LEFT JOIN categorias c ON c.id = m.categoria_id
    LEFT JOIN cartoes ca ON ca.id = m.cartao_id
    WHERE substr(m.data, 1, 7) = ?
    ORDER BY m.data DESC, m.id DESC
  `).all(mes);
}

function criarMovimentacao(payload) {
  const {
    descricao, valor, tipo, origem, data, categoria_id,
    cartao_id = null,
    parcelas = 1,
    juros_mensal = 0
  } = payload;

  const insert = db.prepare(`
    INSERT INTO movimentacoes
    (descricao, valor, tipo, origem, data, categoria_id, cartao_id, grupo_id, parcela_num, parcela_total, juros_mensal, status)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
  `);

  // normal (pix/débito/dinheiro/cartão à vista)
  if (origem !== "cartao_credito" || Number(parcelas) <= 1) {
    return insert.run(
      descricao,
      round2(valor),
      tipo,
      origem,
      data,
      categoria_id ?? null,
      cartao_id ?? null,
      null, null, null,
      round2(juros_mensal || 0),
      "aberta"
    );
  }

  // cartão parcelado -> N linhas futuras (saída)
  const grupoId = `cc-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  const mes0 = String(data).slice(0, 7);
  const dia = String(data).slice(8, 10);

  const N = Number(parcelas);
  const parc = round2(calcParcelaFixa(valor, N, juros_mensal || 0));

  // ajusta última parcela pra não dar float estranho
  const somaPrimeiras = round2(parc * (N - 1));
  const ultima = round2(round2(Number(valor)) - somaPrimeiras);

  for (let p = 1; p <= N; p++) {
    const mesRef = addMonths(mes0, p - 1);
    const dataParcela = `${mesRef}-${dia}`;
    const valorParcela = (p === N && ultima > 0) ? ultima : parc;

    insert.run(
      descricao,
      valorParcela,
      "saida",
      "cartao_credito",
      dataParcela,
      categoria_id ?? null,
      cartao_id ?? null,
      grupoId,
      p,
      N,
      round2(juros_mensal || 0),
      "aberta"
    );
  }

  return { ok: true, grupoId, parcelas: N };
}

function editarMovimentacao(id, payload) {
  const { descricao, valor, tipo, origem, data, categoria_id, cartao_id } = payload;
  return db.prepare(`
    UPDATE movimentacoes
    SET descricao=?, valor=?, tipo=?, origem=?, data=?, categoria_id=?, cartao_id=?
    WHERE id=? AND (grupo_id IS NULL)
  `).run(descricao, round2(valor), tipo, origem, data, categoria_id ?? null, cartao_id ?? null, Number(id));
}

function deletarMovimentacao(id) {
  return db.prepare(`DELETE FROM movimentacoes WHERE id=?`).run(Number(id));
}

module.exports = {
  // movimentações
  getMovimentacoes,
  criarMovimentacao,
  editarMovimentacao,
  deletarMovimentacao,

  // manter funções antigas
  getCategorias,
  addCategoria,
  getResumo,
  relatorioPorCategoria,
  getPrevisaoMes,
  getRecorrencias,
  addRecorrencia,
  updateRecorrencia,
  deleteRecorrencia,
  resumoRecorrencias,
  gerarRecorrencias,
  addCartao,
  getCartoes,
  yyyymmFromDate,
  addMonths,
  calcParcelaFixa,
  criarCompraCartao,
  getFaturaCartao,
  getFaturasMes,
  setParcelaStatus,
  deleteCompraCartao
};
module.exports.getRelatorioCategorias = getRelatorioCategorias;
module.exports.getPrevisao = getPrevisao;
module.exports.getMovimentacoes = getMovimentacoes;
module.exports.criarMovimentacao = criarMovimentacao;
module.exports.editarMovimentacao = editarMovimentacao;
module.exports.deletarMovimentacao = deletarMovimentacao;