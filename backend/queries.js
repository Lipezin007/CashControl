const db = require("./db");


function getCategorias() {
  return db.prepare("SELECT * FROM categorias").all();
}

function addCategoria(nome) {
  return db.prepare("INSERT INTO categorias (nome) VALUES (?)").run(nome);
}

function inserirMovimentacao(descricao, valor, tipo, categoria_id, data) {
  return db.prepare(`
    INSERT INTO movimentacoes (descricao, valor, tipo, categoria_id, data)
    VALUES (?, ?, ?, ?, ?)
  `).run(descricao, valor, tipo, categoria_id, data);
}

function updateMovimentacao(id, descricao, valor, tipo, categoria_id, data) {
  return db.prepare(`
    UPDATE movimentacoes
    SET descricao=?, valor=?, tipo=?, categoria_id=?, data=?
    WHERE id=?
  `).run(descricao, valor, tipo, categoria_id, data, id);
}

function getSaldoAtual(){

  const hoje = new Date().toISOString().slice(0,10);

  const row = db.prepare(`
    SELECT COALESCE(SUM(
      CASE
        WHEN tipo='entrada' THEN valor
        WHEN tipo='saida' THEN -valor
      END
    ),0) AS saldo
    FROM movimentacoes
    WHERE data <= ?
  `).get(hoje);

  return row.saldo;
}

function getResumo(mesYYYYMM) {

  const row = db.prepare(`
    SELECT
      COALESCE(SUM(valor) FILTER (WHERE tipo='entrada'),0) AS entradas,
      COALESCE(SUM(valor) FILTER (WHERE tipo='saida'),0) AS saidas,
      COALESCE(SUM(
        CASE
          WHEN tipo='entrada' THEN valor
          WHEN tipo='saida' THEN -valor
        END
      ),0) AS saldo
    FROM movimentacoes
    WHERE substr(data,1,7)=?
  `).get(mesYYYYMM);

  return row;
}

function relatorioPorCategoria(mes) {
  return db.prepare(`
    SELECT
      c.nome AS categoria,
      COALESCE(SUM(CASE WHEN t.tipo='saida' THEN t.valor ELSE 0 END), 0) AS total_saidas,
      COALESCE(SUM(CASE WHEN t.tipo='entrada' THEN t.valor ELSE 0 END), 0) AS total_entradas
    FROM categorias c
    LEFT JOIN movimentacoes t
      ON t.categoria_id = c.id
     AND substr(t.data, 1, 7) = ?
    GROUP BY c.id
    ORDER BY total_saidas DESC, total_entradas DESC
  `).all(mes);
}

function getPrevisaoMes(mesYYYYMM){

  const resumo = getResumo(mesYYYYMM);
  const fatura = getFaturaCartao(mesYYYYMM);

  return {
    saldo_atual: resumo.saldo,
    entradas_previstas: resumo.entradas,
    saidas_previstas: resumo.saidas + fatura,
    saldo_previsto: resumo.saldo + resumo.entradas - resumo.saidas - fatura
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
  INSERT INTO movimentacoes
  (descricao, valor, tipo, origem, categoria_id, data)
  VALUES (?, ?, ?, 'pix', ?, ?)
`);

  let criadas = 0;
  for (const r of recorrs) {
    const data = `${mesYYYYMM}-${String(r.dia_mes).padStart(2, "0")}`;

    const existe = db.prepare(`
      SELECT 1 FROM movimentacoes
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

function criarCompraCartao({
  cartao_id,
  descricao,
  valor_total,
  parcelas,
  juros_mensal,
  data_compra,
  categoria_id
}) {

  const cartao = db.prepare(`
    SELECT dia_fechamento
    FROM cartoes
    WHERE id = ?
  `).get(cartao_id);

  if (!cartao) {
    return { ok:false, erro:"Cartão não encontrado" };
  }

  const insertCompra = db.prepare(`
    INSERT INTO compras_cartao
    (cartao_id, descricao, valor_total, parcelas, juros_mensal, data_compra, categoria_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const insertParcela = db.prepare(`
    INSERT INTO parcelas_cartao
    (compra_id, cartao_id, numero_parcela, total_parcelas, mes_ref, valor, status)
    VALUES (?, ?, ?, ?, ?, ?, 'aberta')
  `);

  const data = new Date(data_compra);
  const diaCompra = data.getDate();

  let mes0 = data_compra.slice(0,7);

  if (diaCompra > cartao.dia_fechamento) {
    const d = new Date(data_compra);
    d.setMonth(d.getMonth() + 1);
    mes0 = d.toISOString().slice(0,7);
  }

  const compra = insertCompra.run(
    cartao_id,
    descricao,
    Number(valor_total),
    Number(parcelas),
    Number(juros_mensal || 0),
    data_compra,
    categoria_id ?? null
  );

  const compraId = compra.lastInsertRowid;

  const N = Number(parcelas);
  const total = Number(valor_total);

  const parcelaBase = Math.floor((total / N) * 100) / 100;

  let totalDistribuido = 0;

  for (let p = 1; p <= N; p++) {

    let valorParcela = parcelaBase;

    if (p === N) {
      valorParcela = Number((total - totalDistribuido).toFixed(2));
    }

    totalDistribuido += valorParcela;

    const d = new Date(mes0 + "-01");
    d.setMonth(d.getMonth() + (p - 1));

    const mesRef = d.toISOString().slice(0,7);

    insertParcela.run(
      compraId,
      cartao_id,
      p,
      N,
      mesRef,
      valorParcela
    );
  }

  return { ok:true, compraId };
}

function getFaturaCartao(cartao_id, mes){

  const itens = db.prepare(`
    SELECT
      pc.compra_id, 
      pc.numero_parcela,
      pc.total_parcelas,
      cc.descricao,
      pc.valor,
      cc.categoria_id,
      pc.mes_ref,
      pc.status
    FROM parcelas_cartao pc
    JOIN compras_cartao cc ON cc.id = pc.compra_id
    WHERE pc.cartao_id = ?
    AND pc.mes_ref = ?
    AND pc.status = 'aberta'
    ORDER BY pc.numero_parcela
  `).all(cartao_id, mes);

  const total = itens.reduce((s,x)=> s + Number(x.valor),0);

  return {
    cartao_id,
    mes,
    total,
    itens
  };
}

function pagarFatura(cartao_id, mes){

  const fatura = getFaturaCartao(cartao_id, mes);

  if(!fatura.itens.length) {
    return {ok:false, erro:"Fatura vazia"};
  }

  // cria movimentação de pagamento
  db.prepare(`
    INSERT INTO movimentacoes
    (descricao, valor, tipo, origem, data)
    VALUES (?, ?, 'saida', 'cartao_credito', date('now'))
  `).run(
    `Pagamento fatura cartão ${cartao_id} ${mes}`,
    fatura.total
  );

  // marca parcelas como pagas
  db.prepare(`
    UPDATE parcelas_cartao
    SET status='paga'
    WHERE cartao_id = ?
    AND mes_ref = ?
  `).run(cartao_id, mes);

  return {ok:true};
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
      AND pc.status = 'aberta'
    WHERE ca.ativo = 1
    GROUP BY ca.id
    HAVING total > 0
    ORDER BY total DESC
  `).all(mesYYYYMM);
}


function setParcelaStatus(id, status) {
  return db.prepare("UPDATE parcelas_cartao SET status=? WHERE id=?").run(status, Number(id));
}

function deleteCompraCartao(id) {

  // apaga parcelas primeiro
  db.prepare(`
    DELETE FROM parcelas_cartao
    WHERE compra_id = ?
  `).run(id);

  // depois apaga a compra
  return db.prepare(`
    DELETE FROM compras_cartao
    WHERE id = ?
  `).run(id);
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
    c.id,
    c.nome AS categoria,

    COALESCE(SUM(saidas),0) as total_saidas,
    COALESCE(SUM(entradas),0) as total_entradas,
    COALESCE(meta.valor_meta,0) as meta

  FROM categorias c

  LEFT JOIN (

      SELECT
        categoria_id,
        CASE WHEN tipo='saida' THEN valor ELSE 0 END as saidas,
        CASE WHEN tipo='entrada' THEN valor ELSE 0 END as entradas
      FROM movimentacoes
      WHERE substr(data,1,7)=?

      UNION ALL

      SELECT
        cc.categoria_id,
        pc.valor as saidas,
        0 as entradas
      FROM parcelas_cartao pc
      JOIN compras_cartao cc ON cc.id = pc.compra_id
      WHERE pc.mes_ref = ?
      AND pc.status != 'cancelada'

  ) mov ON mov.categoria_id = c.id

  LEFT JOIN metas_categoria meta
    ON meta.categoria_id = c.id
    AND meta.mes = ?

  GROUP BY c.id
  ORDER BY total_saidas DESC

  `).all(mes, mes, mes);
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
    COALESCE(SUM(
      CASE
        WHEN tipo='entrada' THEN valor
        WHEN tipo='saida' THEN -valor
      END
    ),0) AS saldo_atual
  FROM movimentacoes
  WHERE data <= date('now')
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


function round2(n) { return Math.round(Number(n) * 100) / 100; }

function getMovimentacoes(mes){

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
    WHERE strftime('%Y-%m', m.data) = ?
  `).all(mes);


  const cartao = db.prepare(`
    SELECT
      pc.id,
      pc.mes_ref || '-01' as data,
      cc.descricao,
      pc.valor,
      'saida' as tipo,
      cat.nome as categoria,
      pc.numero_parcela as parcela_num,
      pc.total_parcelas as parcela_total
    FROM parcelas_cartao pc
    JOIN compras_cartao cc ON cc.id = pc.compra_id
    LEFT JOIN categorias cat ON cat.id = cc.categoria_id
    WHERE pc.mes_ref = ?
      AND pc.status != 'cancelada'
  `).all(mes);

  return [...mov, ...cartao].sort((a,b)=>b.data.localeCompare(a.data));
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

  // CARTÃO PARCELADO
  if (origem === "cartao_credito" && Number(parcelas) > 1) {

    const grupoId = `cc-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

    const mes0 = String(data).slice(0, 7);
    const dia = String(data).slice(8, 10);

    const N = Number(parcelas);
    const valorParcela = round2(Number(valor) / N);

    for (let p = 1; p <= N; p++) {

      const mesRef = addMonths(mes0, p - 1);
      const dataParcela = `${mesRef}-${dia}`;

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
        0,
        "aberta"
      );
    }

    return { ok: true };
  }

  // MOVIMENTAÇÃO NORMAL
  return insert.run(
    descricao,
    round2(valor),
    tipo,
    origem,
    data,
    categoria_id ?? null,
    cartao_id ?? null,
    null,
    null,
    null,
    0,
    "aberta"
  );
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

function getLimiteCartao(cartao_id){

  const cartao = db.prepare(`
    SELECT limite
    FROM cartoes
    WHERE id=?
  `).get(cartao_id);

  const usado = db.prepare(`
    SELECT COALESCE(SUM(valor),0) as total
    FROM parcelas_cartao
    WHERE cartao_id=? AND status!='paga'
  `).get(cartao_id);

  return {
    limite: cartao.limite,
    usado: usado.total,
    disponivel: cartao.limite - usado.total
  };
}

function getDashboard(mes){

  const resumo = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN tipo='entrada' THEN valor ELSE 0 END),0) as entradas,
      COALESCE(SUM(CASE WHEN tipo='saida' THEN valor ELSE 0 END),0) as saidas
    FROM movimentacoes
    WHERE substr(data,1,7)=?
  `).get(mes);

  const saldo = db.prepare(`
    SELECT
      COALESCE(SUM(
        CASE
          WHEN tipo='entrada' THEN valor
          WHEN tipo='saida' THEN -valor
        END
      ),0) as saldo
    FROM movimentacoes
  `).get();

  const fatura = db.prepare(`
    SELECT COALESCE(SUM(valor),0) as total
    FROM parcelas_cartao
    WHERE mes_ref = ?
  `).get(mes);

  return {
    saldo: saldo.saldo,
    entradas: resumo.entradas,
    saidas: resumo.saidas,
    fatura: fatura.total
  };

}

function setMetaCategoria(usuario_id, categoria_id, valor_meta, mes) {
  return db.prepare(`
    INSERT INTO metas_categoria (usuario_id, categoria_id, mes, valor_meta)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(usuario_id, categoria_id, mes)
    DO UPDATE SET valor_meta = excluded.valor_meta
  `).run(usuario_id, categoria_id, mes, valor_meta);
}

function getMetasComGasto(mes) {
  return db.prepare(`
    SELECT
      c.nome as categoria,
      m.valor_meta,
      COALESCE(SUM(
        CASE WHEN mov.tipo='saida' THEN mov.valor ELSE 0 END
      ),0) as gasto_mes
    FROM metas_categoria m
    JOIN categorias c ON c.id = m.categoria_id
    LEFT JOIN movimentacoes mov
      ON mov.categoria_id = c.id
     AND substr(mov.data,1,7)=?
    GROUP BY c.id
  `).all(mes);
}

function getControleCartao(cartao_id) {

  const cartao = db.prepare(`
    SELECT id, nome, limite
    FROM cartoes
    WHERE id = ?
  `).get(cartao_id);

  if (!cartao) return null;

  const usado = db.prepare(`
    SELECT COALESCE(SUM(valor),0) as total
    FROM parcelas_cartao
    WHERE cartao_id = ?
      AND status = 'aberta'
  `).get(cartao_id).total;

  const disponivel = cartao.limite - usado;

  const percentual = cartao.limite > 0
    ? (usado / cartao.limite) * 100
    : 0;

  return {
    nome: cartao.nome,
    limite: cartao.limite,
    usado,
    disponivel,
    percentual
  };
}

function getPrevisaoCartao(cartao_id){

  return db.prepare(`
    SELECT
      mes_ref,
      SUM(valor) as total
    FROM parcelas_cartao
    WHERE cartao_id = ?
      AND status = 'aberta'
      AND mes_ref >= strftime('%Y-%m','now')
    GROUP BY mes_ref
    ORDER BY mes_ref
  `).all(cartao_id);

}

function getMesFaturaAtual(cartao_id){

  const cartao = db.prepare(`
    SELECT dia_fechamento
    FROM cartoes
    WHERE id = ?
  `).get(cartao_id);

  const hoje = new Date();

  const dia = hoje.getDate();

  let mes = hoje.toISOString().slice(0,7);

  if(dia > cartao.dia_fechamento){
    mes = addMonths(mes,1);
  }

  return mes;
}

function getPrevisaoLimite(cartao_id){

  const cartao = db.prepare(`
    SELECT limite
    FROM cartoes
    WHERE id = ?
  `).get(cartao_id);

  const parcelas = db.prepare(`
    SELECT
      mes_ref,
      SUM(valor) as total
    FROM parcelas_cartao
    WHERE cartao_id = ?
      AND status = 'aberta'
    GROUP BY mes_ref
    ORDER BY mes_ref
  `).all(cartao_id);

  let usado = parcelas.reduce((s,p)=> s + p.total,0);

  return parcelas.map(p => {

    usado -= p.total;

    return {
      mes: p.mes_ref,
      limite_liberado: cartao.limite - usado
    };

  });

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
  getCartoes,
  criarCompraCartao,
  getFaturaCartao,
  getFaturasMes,
  getPrevisao,
  setParcelaStatus,
  deleteCompraCartao,

  getSaldoAtual,
  getLimiteCartao,
  pagarFatura,
  getDashboard,
  setMetaCategoria,
  getMetasComGasto,
  getControleCartao,
  setRecorrenciaAtiva,
  inserirMovimentacao,
  updateMovimentacao,
  getMesFaturaAtual,
  getPrevisaoLimite,

};