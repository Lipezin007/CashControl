const db = require("./db");

function formatMes(date){
  return date.getFullYear() + "-" + String(date.getMonth()+1).padStart(2,"0");
}

function getCategorias(usuario_id) {
  return db.prepare(`
    SELECT *
    FROM categorias
    WHERE usuario_id = ?
    ORDER BY nome
  `).all(usuario_id);
}

function addCategoria(usuario_id, nome) {
  return db.prepare(`
    INSERT INTO categorias (usuario_id, nome)
    VALUES (?, ?)
  `).run(usuario_id, nome);
}

function inserirMovimentacao(descricao, valor, tipo, categoria_id, data, usuario_id) {
  return db.prepare(`
    INSERT INTO movimentacoes (descricao, valor, tipo, categoria_id, data, usuario_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(descricao, valor, tipo, categoria_id, data, usuario_id);
}

function updateMovimentacao(id, descricao, valor, tipo, categoria_id, data, usuario_id) {
  return db.prepare(`
    UPDATE movimentacoes
    SET descricao=?, valor=?, tipo=?, categoria_id=?, data=?
    WHERE id=? AND usuario_id = ?
  `).run(descricao, valor, tipo, categoria_id, data, id, usuario_id);
}

function getSaldoAtual(usuario_id){

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
      AND usuario_id = ?
  `).get(hoje, usuario_id);

  return row.saldo;
}

function getResumo(mesYYYYMM, usuario_id) {

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
      AND usuario_id = ?
  `).get(mesYYYYMM, usuario_id);

  return row;
}

function relatorioPorCategoria(mes, usuario_id = null) {
  return db.prepare(`
    SELECT
      c.nome AS categoria,
      COALESCE(SUM(CASE WHEN t.tipo='saida' THEN t.valor ELSE 0 END), 0) AS total_saidas,
      COALESCE(SUM(CASE WHEN t.tipo='entrada' THEN t.valor ELSE 0 END), 0) AS total_entradas
    FROM categorias c
    LEFT JOIN movimentacoes t
      ON t.categoria_id = c.id
     AND (c.usuario_id IS NULL OR c.usuario_id = ?)
     AND substr(t.data, 1, 7) = ?
    WHERE (c.usuario_id IS NULL OR c.usuario_id = ?)
    GROUP BY c.id
    ORDER BY total_saidas DESC, total_entradas DESC
  `).all(usuario_id, mes, usuario_id);
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

function getRecorrencias(usuario_id = null) {
  return db.prepare(`
    SELECT r.*, c.nome as categoria
    FROM recorrencias r
    LEFT JOIN categorias c ON c.id = r.categoria_id
      AND (c.usuario_id IS NULL OR c.usuario_id = ?)
    WHERE r.usuario_id = ?
    ORDER BY r.dia_mes ASC, r.id DESC
  `).all(usuario_id, usuario_id);
}

function addRecorrencia(descricao, valor, tipo, categoria_id, dia_mes, usuario_id) {
  return db.prepare(`
    INSERT INTO recorrencias (descricao, valor, tipo, categoria_id, dia_mes, ativo, usuario_id)
    VALUES (?, ?, ?, ?, ?, 1, ?)
  `).run(descricao, valor, tipo, categoria_id ?? null, dia_mes, usuario_id);
}

function setRecorrenciaAtiva(id, ativo, usuario_id) {
  return db.prepare("UPDATE recorrencias SET ativo=? WHERE id=? AND usuario_id=?").run(ativo ? 1 : 0, id, usuario_id);
}

function deleteRecorrencia(id, usuario_id) {
  return db.prepare("DELETE FROM recorrencias WHERE id=? AND usuario_id=?").run(id, usuario_id);
}

function updateRecorrencia(id, descricao, valor, tipo, categoria_id, dia_mes, ativo, usuario_id) {
  return db.prepare(`
    UPDATE recorrencias
    SET descricao=?, valor=?, tipo=?, categoria_id=?, dia_mes=?, ativo=?
    WHERE id=? AND usuario_id=?
  `).run(descricao, valor, tipo, categoria_id ?? null, dia_mes, ativo ? 1 : 0, id, usuario_id);
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

function gerarRecorrencias(mesYYYYMM, usuario_id) {
  const recorrs = db.prepare("SELECT * FROM recorrencias WHERE ativo = 1 AND usuario_id = ?").all(usuario_id);

  const inserir = db.prepare(`
  INSERT INTO movimentacoes
  (descricao, valor, tipo, origem, categoria_id, data, usuario_id)
  VALUES (?, ?, ?, 'pix', ?, ?, ?)
`);

  let criadas = 0;
  for (const r of recorrs) {
    const data = `${mesYYYYMM}-${String(r.dia_mes).padStart(2, "0")}`;

    const existe = db.prepare(`
      SELECT 1 FROM movimentacoes
      WHERE descricao=? AND valor=? AND tipo=? AND IFNULL(categoria_id,0)=IFNULL(?,0) AND data=? AND usuario_id = ?
      LIMIT 1
    `).get(r.descricao, r.valor, r.tipo, r.categoria_id, data, usuario_id);

    if (!existe) {
      inserir.run(r.descricao, r.valor, r.tipo, r.categoria_id, data, usuario_id);
      criadas++;
    }
  }
  return { ok: true, mes: mesYYYYMM, criadas };
}

// ===== CARTÃO DE CRÉDITO =====
function addCartao(usuario_id, nome, limite, dia_fechamento, dia_vencimento) {
  return db.prepare(`
    INSERT INTO cartoes
    (usuario_id, nome, limite, dia_fechamento, dia_vencimento)
    VALUES (?, ?, ?, ?, ?)
  `).run(usuario_id, nome, limite, dia_fechamento, dia_vencimento);
}

function getCartoes(usuario_id) {
  return db.prepare(`
    SELECT *
    FROM cartoes
    WHERE usuario_id = ?
    AND ativo = 1
    ORDER BY nome
  `).all(usuario_id);
}

function updateCartao(id, usuario_id, nome, limite, dia_fechamento, dia_vencimento) {
  return db.prepare(`
    UPDATE cartoes
    SET nome = ?,
        limite = ?,
        dia_fechamento = ?,
        dia_vencimento = ?
    WHERE id = ?
      AND usuario_id = ?
      AND ativo = 1
  `).run(
    nome,
    Number(limite || 0),
    Number(dia_fechamento),
    Number(dia_vencimento),
    Number(id),
    usuario_id
  );
}

function deleteCartao(id, usuario_id) {
  return db.prepare(`
    UPDATE cartoes
    SET ativo = 0
    WHERE id = ?
      AND usuario_id = ?
      AND ativo = 1
  `).run(Number(id), usuario_id);
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
  categoria_id,
  usuario_id
}) {

  const cartao = db.prepare(`
    SELECT dia_fechamento
    FROM cartoes
    WHERE id = ?
      AND usuario_id = ?
  `).get(cartao_id, usuario_id);

  if (!cartao) {
    return { ok:false, erro:"Cartão não encontrado" };
  }

  const insertCompra = db.prepare(`
    INSERT INTO compras_cartao
    (cartao_id, descricao, valor_total, parcelas, juros_mensal, data_compra, categoria_id, usuario_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertParcela = db.prepare(`
    INSERT INTO parcelas_cartao (
  cartao_id,
  valor,
  numero_parcela,
  total_parcelas,
  mes_ref,
  usuario_id,
  status,
  compra_id
)
VALUES (?, ?, ?, ?, ?, ?, 'aberta', ?)
  `);

 const data = new Date(data_compra);
const diaCompra = data.getDate();

// cria a data no primeiro dia do mês da compra
let mes0Date = new Date(data.getFullYear(), data.getMonth(), 1);

// se passou do fechamento → vai para próxima fatura
if (data.getDate() > cartao.dia_fechamento) {
  mes0Date.setMonth(mes0Date.getMonth() + 1);
}

const mes0 =
  mes0Date.getFullYear() +
  "-" +
  String(mes0Date.getMonth() + 1).padStart(2, "0");

  const compra = insertCompra.run(
  cartao_id,
  descricao,
  Number(valor_total),
  Number(parcelas),
  Number(juros_mensal || 0),
  data_compra,
  categoria_id ?? null,
  usuario_id
);

  const compraId = compra.lastInsertRowid;

  const N = Number(parcelas);
  const total = Number(valor_total);

  const parcelaBase = Math.floor((total / N) * 100) / 100;

  let totalDistribuido = 0;
console.log("mes inicial:", mes0Date);
  for (let p = 1; p <= N; p++) {

  let valorParcela = parcelaBase;

  if (p === N) {
    valorParcela = Number((total - totalDistribuido).toFixed(2));
  }

  totalDistribuido += valorParcela;

  const d = new Date(mes0Date);
  d.setMonth(mes0Date.getMonth() + (p - 1));

  const mesRef =
    d.getFullYear() +
    "-" +
    String(d.getMonth() + 1).padStart(2, "0");

  insertParcela.run(
  cartao_id,     // 1
  valorParcela,  // 2
  p,             // 3
  N,             // 4
  mesRef,        // 5
  usuario_id,    // 6 🔥
  compraId       // 7 🔥
);
}

  return { ok:true, compraId };
}

function getFaturaCartao(cartao_id, mes, usuario_id = null){

  const itens = db.prepare(`
    SELECT
      pc.compra_id,
      pc.numero_parcela,
      pc.total_parcelas,
      cc.descricao,
      cc.categoria_id,
      c.nome AS categoria,
      pc.valor,
      pc.mes_ref,
      pc.status
    FROM parcelas_cartao pc
    JOIN compras_cartao cc ON cc.id = pc.compra_id
    JOIN cartoes ca ON ca.id = pc.cartao_id
    LEFT JOIN categorias c ON c.id = cc.categoria_id
      AND (c.usuario_id IS NULL OR c.usuario_id = ?)
    WHERE pc.cartao_id = ?
      AND pc.mes_ref = ?
      AND pc.status = 'aberta'
      AND ca.usuario_id = ?
    ORDER BY pc.numero_parcela
  `).all(usuario_id, cartao_id, mes, usuario_id);

  const total = itens.reduce((s,x)=> s + Number(x.valor),0);

  return {
    cartao_id,
    mes,
    total,
    itens
  };
}

function getFaturasMes(mesYYYYMM, usuario_id) {
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
      AND ca.usuario_id = ?
    GROUP BY ca.id
    HAVING total > 0
    ORDER BY total DESC
  `).all(mesYYYYMM, usuario_id);
}


function setParcelaStatus(id, status, usuario_id) {
  return db.prepare("UPDATE parcelas_cartao SET status=? WHERE id=? AND cartao_id IN (SELECT id FROM cartoes WHERE usuario_id = ?)"
  ).run(status, Number(id), usuario_id);
}

function deleteCompraCartao(id, usuario_id) {
  const compra = db.prepare(`
    SELECT cc.id
    FROM compras_cartao cc
    JOIN cartoes ca ON ca.id = cc.cartao_id
    WHERE cc.id = ?
      AND ca.usuario_id = ?
  `).get(id, usuario_id);

  if (!compra) {
    return { ok: false, erro: "Acesso negado" };
  }

  // apaga parcelas primeiro
  db.prepare(`
    DELETE FROM parcelas_cartao
    WHERE compra_id = ?
  `).run(id);

  // depois apaga a compra
  db.prepare(`
    DELETE FROM compras_cartao
    WHERE id = ?
  `).run(id);

  return { ok: true };
}

// ===== FIM CARTÃO DE CRÉDITO =====



function getRelatorioCategorias(mes, usuario_id) {

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
        AND usuario_id = ?

  ) mov ON mov.categoria_id = c.id

  LEFT JOIN metas_categoria meta
    ON meta.categoria_id = c.id
    AND meta.mes = ?
    AND meta.usuario_id = ?

  WHERE c.usuario_id = ?

  GROUP BY c.id
  ORDER BY total_saidas DESC

  `).all(
    mes, usuario_id,
    mes, usuario_id,
    usuario_id
  );
}

function getPrevisao(mesYYYYMM, usuario_id) {
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
      AND usuario_id = ?
  `).get(diaMin, usuario_id);

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
    AND usuario_id = ?
`).get(usuario_id);

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

function getMovimentacoes(mes, usuario_id = null){

  return db.prepare(`
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
  `).all(usuario_id, mes, usuario_id);

}

function criarMovimentacao(payload) {

  const {
    descricao,
    valor,
    tipo,
    origem,
    data,
    categoria_id,
    usuario_id
  } = payload;

  if (origem === "cartao_credito") {
    return criarCompraCartao(payload);
  }

  return db.prepare(`
    INSERT INTO movimentacoes
    (descricao, valor, tipo, origem, data, categoria_id, usuario_id)
    VALUES (?,?,?,?,?,?,?)
  `).run(
    descricao,
    round2(valor),
    tipo,
    origem,
    data,
    categoria_id ?? null,
    usuario_id
  );
}

function editarMovimentacao(id, payload, usuario_id) {
  const { descricao, valor, tipo, origem, data, categoria_id, cartao_id } = payload;

  return db.prepare(`
    UPDATE movimentacoes
    SET descricao=?, valor=?, tipo=?, origem=?, data=?, categoria_id=?, cartao_id=?
    WHERE id=? AND usuario_id = ?
  `).run(
    descricao,
    round2(valor),
    tipo,
    origem,
    data,
    categoria_id ?? null,
    cartao_id ?? null,
    Number(id),
    usuario_id
  );
}

function deletarMovimentacao(id, usuario_id) {
  return db.prepare(`DELETE FROM movimentacoes WHERE id=? AND usuario_id = ?`).run(Number(id), usuario_id);
}

function getLimiteCartao(cartao_id, usuario_id){

  const cartao = db.prepare(`
    SELECT limite
    FROM cartoes
    WHERE id=?
      AND usuario_id = ?
  `).get(cartao_id, usuario_id);

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

function getDashboard(mes, usuario_id) {

  const resumo = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN tipo='entrada' THEN valor ELSE 0 END),0) as entradas,
      COALESCE(SUM(CASE WHEN tipo='saida' THEN valor ELSE 0 END),0) as saidas
    FROM movimentacoes
    WHERE substr(data,1,7)=?
      AND usuario_id = ?
  `).get(mes, usuario_id);

  const saldo = db.prepare(`
    SELECT
      COALESCE(SUM(
        CASE
          WHEN tipo='entrada' THEN valor
          WHEN tipo='saida' THEN -valor
        END
      ),0) as saldo
    FROM movimentacoes
    WHERE usuario_id = ?
  `).get(usuario_id);

  const fatura = db.prepare(`
    SELECT COALESCE(SUM(pc.valor),0) as total
    FROM parcelas_cartao pc
    JOIN compras_cartao cc ON cc.id = pc.compra_id
    WHERE pc.mes_ref = ?
      AND pc.status = 'aberta'
      AND cc.usuario_id = ?
  `).get(mes, usuario_id);

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

function getMetasComGasto(mes, usuario_id = null) {
  return db.prepare(`
    SELECT
      c.nome as categoria,
      m.valor_meta,
      COALESCE(SUM(
        CASE WHEN mov.tipo='saida' THEN mov.valor ELSE 0 END
      ),0) as gasto_mes
    FROM metas_categoria m
    JOIN categorias c ON c.id = m.categoria_id
      AND (c.usuario_id IS NULL OR c.usuario_id = ?)
    LEFT JOIN movimentacoes mov
      ON mov.categoria_id = c.id
     AND substr(mov.data,1,7)=?
     AND mov.usuario_id = ?
    WHERE m.usuario_id = ?
    GROUP BY c.id
  `).all(usuario_id, mes, usuario_id, usuario_id);
}

function getControleCartao(cartao_id, usuario_id) {

  const cartao = db.prepare(`
    SELECT id, nome, limite
    FROM cartoes
    WHERE id = ?
      AND usuario_id = ?
  `).get(cartao_id, usuario_id);

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

function getPrevisaoCartao(cartao_id, usuario_id){

  return db.prepare(`
    SELECT
      pc.mes_ref,
      SUM(pc.valor) as total
    FROM parcelas_cartao pc
    JOIN cartoes ca ON ca.id = pc.cartao_id
    WHERE pc.cartao_id = ?
      AND pc.status = 'aberta'
      AND pc.mes_ref >= strftime('%Y-%m','now')
      AND ca.usuario_id = ?
    GROUP BY pc.mes_ref
    ORDER BY pc.mes_ref
  `).all(cartao_id, usuario_id);

}

function getMesFaturaAtual(cartao_id, usuario_id){

  const cartao = db.prepare(`
    SELECT dia_fechamento
    FROM cartoes
    WHERE id = ?
      AND usuario_id = ?
  `).get(cartao_id, usuario_id);

  const hoje = new Date();

  const dia = hoje.getDate();

  let mes = hoje.toISOString().slice(0,7);

  if(dia > cartao.dia_fechamento){
    mes = addMonths(mes,1);
  }

  return mes;
}

function getPrevisaoLimite(cartao_id, usuario_id){

  const cartao = db.prepare(`
    SELECT limite
    FROM cartoes
    WHERE id = ?
      AND usuario_id = ?
  `).get(cartao_id, usuario_id);

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

};