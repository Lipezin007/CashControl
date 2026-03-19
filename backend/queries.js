const db = require("./db");
const { getTaxaReferencia, DEFAULT_CDI_ANUAL } = require("./rendimentoService");

// Arquivo central das regras de consulta/cálculo.
// A ideia aqui é manter SQL + regra de negócio perto, com funções pequenas por domínio.

function formatMes(date) {
    return date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0");
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

function getSaldoAtual(usuario_id) {

  // Saldo consolidado até hoje (entrada soma, saída subtrai).

    const hoje = new Date().toISOString().slice(0, 10);

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

function getSaldoDisponivelParaCaixinhas(usuario_id) {
  // Saldo disponível = saldo fora de caixinha - saldo já alocado nas caixinhas.
    const externo = db.prepare(`
    SELECT COALESCE(SUM(
      CASE
        WHEN tipo='entrada' THEN valor
        WHEN tipo='saida' THEN -valor
      END
    ),0) AS saldo
    FROM movimentacoes
    WHERE usuario_id = ?
      AND IFNULL(origem, '') != 'caixinha'
  `).get(usuario_id).saldo;

    const totalCaixinhas = db.prepare(`
    SELECT COALESCE(SUM(saldo),0) AS total
    FROM caixinhas
    WHERE usuario_id = ?
  `).get(usuario_id).total;

    return Number(externo || 0) - Number(totalCaixinhas || 0);
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

function getPrevisaoMes(mesYYYYMM) {

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
    const categoriaId = categoria_id != null ? categoria_id : null;
    return db.prepare(`
    INSERT INTO recorrencias (descricao, valor, tipo, categoria_id, dia_mes, ativo, usuario_id)
    VALUES (?, ?, ?, ?, ?, 1, ?)
  `).run(descricao, valor, tipo, categoriaId, dia_mes, usuario_id);
}

function setRecorrenciaAtiva(id, ativo, usuario_id) {
    return db.prepare("UPDATE recorrencias SET ativo=? WHERE id=? AND usuario_id = ?").run(
        ativo ? 1 : 0,
        id,
        usuario_id
    );
}

function deleteRecorrencia(id, usuario_id) {
    return db.prepare("DELETE FROM recorrencias WHERE id=? AND usuario_id = ?").run(id, usuario_id);
}

function updateRecorrencia(id, descricao, valor, tipo, categoria_id, dia_mes, ativo, usuario_id) {
    const categoriaId = categoria_id != null ? categoria_id : null;
    return db.prepare(`
    UPDATE recorrencias
    SET descricao=?, valor=?, tipo=?, categoria_id=?, dia_mes=?, ativo=?
    WHERE id=? AND usuario_id=?
  `).run(descricao, valor, tipo, categoriaId, dia_mes, ativo ? 1 : 0, id, usuario_id);
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
        return { ok: false, erro: "CartÃ£o nÃ£o encontrado" };
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

    // cria a data no primeiro dia do mÃªs da compra
    let mes0Date = new Date(data.getFullYear(), data.getMonth(), 1);

    // se passou do fechamento â†’ vai para prÃ³xima fatura
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
            cartao_id, // 1
            valorParcela, // 2
            p, // 3
            N, // 4
            mesRef, // 5
            usuario_id, // 6 ðŸ”¥
            compraId // 7 ðŸ”¥
        );
    }

    return { ok: true, compraId };
}

function getFaturaCartao(cartao_id, mes, usuario_id = null) {

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

    const total = itens.reduce((s, x) => s + Number(x.valor), 0);

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
    return db.prepare("UPDATE parcelas_cartao SET status=? WHERE id=? AND cartao_id IN (SELECT id FROM cartoes WHERE usuario_id = ?)").run(status, Number(id), usuario_id);
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

// ===== FIM CARTÃƒO DE CRÃ‰DITO =====

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

    // mÃªs atual: sÃ³ conta recorrÃªncias do dia de hoje pra frente
    // mÃªs futuro: conta tudo
    // mÃªs passado: nÃ£o conta nada (previsÃ£o)
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

function getMovimentacoes(mes, usuario_id = null) {

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
    VALUES (?, ?, ?, ?, ?, ?, ?)
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

function getLimiteCartao(cartao_id, usuario_id) {

    const cartao = db.prepare(`
        AND usuario_id = ?
    `).get(cartao_id, usuario_id);

    const usado = db.prepare(`
        SELECT COALESCE(SUM(valor), 0) as total FROM parcelas_cartao WHERE cartao_id = ? AND status != 'paga'
    `).get(cartao_id);

    return {
    limite: cartao.limite,
    usado: usado.total,
    disponivel: cartao.limite - usado.total
    };
}

function getDashboard(mes, usuario_id) {

    const resumo = db.prepare(`
        SELECT COALESCE(SUM(CASE WHEN tipo = 'entrada'
            THEN valor ELSE 0 END), 0) as entradas,
        COALESCE(SUM(CASE WHEN tipo = 'saida'
            THEN valor ELSE 0 END), 0) as saidas FROM movimentacoes WHERE substr(data, 1, 7) = ?
        AND usuario_id = ?
    `).get(mes, usuario_id);

    const saldo = db.prepare(`
        SELECT COALESCE(SUM(
            CASE WHEN tipo = 'entrada'
            THEN valor WHEN tipo = 'saida'
            THEN - valor END
        ), 0) as saldo FROM movimentacoes WHERE usuario_id = ?
    `).get(usuario_id);

    const fatura = db.prepare(`
        SELECT COALESCE(SUM(pc.valor), 0) as total FROM parcelas_cartao pc JOIN compras_cartao cc ON cc.id = pc.compra_id WHERE pc.mes_ref = ?
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
        INSERT INTO metas_categoria(usuario_id, categoria_id, mes, valor_meta) VALUES(?, ?, ?, ?) ON CONFLICT(usuario_id, categoria_id, mes) DO UPDATE SET valor_meta = excluded.valor_meta `).run(usuario_id, categoria_id, mes, valor_meta);
}

function getMetasComGasto(mes, usuario_id = null) {
    return db.prepare(`
        SELECT c.nome as categoria,
        m.valor_meta,
        COALESCE(SUM(
            CASE WHEN mov.tipo = 'saida'
            THEN mov.valor ELSE 0 END
        ), 0) as gasto_mes FROM metas_categoria m JOIN categorias c ON c.id = m.categoria_id AND(c.usuario_id IS NULL OR c.usuario_id = ? ) LEFT JOIN movimentacoes mov ON mov.categoria_id = c.id AND substr(mov.data, 1, 7) = ?
        AND mov.usuario_id = ?
        WHERE m.usuario_id = ?
        GROUP BY c.id 
    `).all(usuario_id, mes, usuario_id, usuario_id);
}

function getControleCartao(cartao_id, usuario_id) {

    const cartao = db.prepare(`
        SELECT id, nome, limite FROM cartoes WHERE id = ?
        AND usuario_id = ?
    `).get(cartao_id, usuario_id);

    if (!cartao) return null;

    const usado = db.prepare(`
        SELECT COALESCE(SUM(valor), 0) as total FROM parcelas_cartao WHERE cartao_id = ?
        AND status = 'aberta'
    `).get(cartao_id).total;

    const disponivel = cartao.limite - usado;

    const percentual = cartao.limite > 0 ?
        (usado / cartao.limite) * 100 :
        0;

    return {
        nome: cartao.nome,
        limite: cartao.limite,
        usado,
        disponivel,
        percentual
    };
}

function getPrevisaoCartao(cartao_id, usuario_id) {

    return db.prepare(`
        SELECT pc.mes_ref,
        SUM(pc.valor) as total FROM parcelas_cartao pc JOIN cartoes ca ON ca.id = pc.cartao_id WHERE pc.cartao_id = ?
        AND pc.status = 'aberta'
        AND pc.mes_ref >= strftime('%Y-%m', 'now') AND ca.usuario_id = ?
        GROUP BY pc.mes_ref ORDER BY pc.mes_ref 
    `).all(cartao_id, usuario_id);
}

function getMesFaturaAtual(cartao_id, usuario_id) {

    const cartao = db.prepare(`
        SELECT dia_fechamento FROM cartoes WHERE id = ?
        AND usuario_id = ?
    `).get(cartao_id, usuario_id);

    const hoje = new Date();

    const dia = hoje.getDate();

    let mes = hoje.toISOString().slice(0, 7);

    if (dia > cartao.dia_fechamento) {
        mes = addMonths(mes, 1);
    }

    return mes;
}

function getPrevisaoLimite(cartao_id, usuario_id) {

    const cartao = db.prepare(`
        SELECT limite FROM cartoes WHERE id = ?
        AND usuario_id = ?
    `).get(cartao_id, usuario_id);

    const parcelas = db.prepare(`
        SELECT mes_ref,
        SUM(valor) as total FROM parcelas_cartao WHERE cartao_id = ?
        AND status = 'aberta'
        GROUP BY mes_ref ORDER BY mes_ref 
    `).all(cartao_id);

    let usado = parcelas.reduce((s, p) => s + p.total, 0);

    return parcelas.map(p => {

        usado -= p.total;

        return {
            mes: p.mes_ref,
            limite_liberado: cartao.limite - usado
        };

    });

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
  const diff = hojeDia - inicioDia;

  return Math.max(0, Math.floor(diff / 86400000));
}

function calcularRendimento(saldo, percentual, dias, cdiAnual) {
  // Juros compostos simplificados com base em % do CDI anual.
    const p = Number(percentual || 0);
    const d = Number(dias || 0);
    const s = Number(saldo || 0);
    const cdi = Number(cdiAnual || 0);

    if (s <= 0 || p <= 0 || d <= 0 || cdi <= 0) {
        return s;
    }

    const taxaDia = (p / 100) * cdi / 365;
    return Number((s * Math.pow(1 + taxaDia, d)).toFixed(2));
}

  function normalizarTextoBusca(valor) {
    return String(valor || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .toUpperCase();
  }

function getPercentualAutomatico(caixinha) {
    const instituicao = String(caixinha.instituicao || "").trim();
    const produto = String(caixinha.produto || "Conta").trim();
    const indexador = String(caixinha.rendimento_tipo || "CDI").toUpperCase();

    if (!instituicao) return null;

    const instituicaoNorm = normalizarTextoBusca(instituicao);
    const produtoNorm = normalizarTextoBusca(produto);
    const indexadoresBusca = indexador === "CDI" ? ["CDI"] : [indexador, "CDI"];

    for (const idx of indexadoresBusca) {
      const candidatos = db.prepare(`
        SELECT instituicao, produto, percentual, fonte, updated_at
        FROM rendimento_instituicoes
        WHERE ativo = 1
          AND upper(indexador) = upper(?)
        ORDER BY updated_at DESC
      `).all(idx);

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

function getCaixinhas(usuario_id) {
  // Sempre devolve a caixinha já com campos derivados pra renderização no front.
    const cdiAnual = getTaxaReferencia("CDI_ANUAL", DEFAULT_CDI_ANUAL);

    const rows = db.prepare(`
    SELECT
      c.*,
      (
        SELECT MAX(COALESCE(cm.data_hora, cm.data))
        FROM caixinha_movimentacoes cm
        WHERE cm.caixinha_id = c.id
          AND cm.usuario_id = c.usuario_id
      ) AS ultima_movimentacao_em
    FROM caixinhas c
    WHERE c.usuario_id = ?
        ORDER BY datetime(created_at) DESC, id DESC 
    `).all(usuario_id);

    return rows.map((c) => {
    const dataInicioRendimento = c.ultima_movimentacao_em || c.created_at;
    const dias = diasDecorridos(dataInicioRendimento);
        const auto = Number(c.auto_percentual || 0) === 1;
        const autoTaxa = auto ? getPercentualAutomatico(c) : null;
        const percentualAplicado = autoTaxa ? Number(autoTaxa.percentual) : Number(c.rendimento_percentual || 0);
        const saldoAtualizado = calcularRendimento(c.saldo, percentualAplicado, dias, cdiAnual);
    const rendimento = Number((saldoAtualizado - Number(c.saldo || 0)).toFixed(2));
      const percentualOrigem = autoTaxa ? "automatico" : (auto ? "manual_fallback" : "manual");
      const avisoAuto = auto && !autoTaxa
        ? "Taxa da instituição não encontrada. Usando percentual manual."
        : null;

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
    });
}

function addCaixinha(
    usuario_id,
    nome,
    objetivo,
    rendimento_tipo,
    rendimento_percentual,
    instituicao,
    produto,
    auto_percentual
) {
    return db.prepare(`
        INSERT INTO caixinhas(
            nome, saldo, objetivo, rendimento_tipo, rendimento_percentual,
            instituicao, produto, auto_percentual, usuario_id
        ) VALUES(?, 0, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        String(nome || "").trim(),
        objetivo != null && objetivo !== "" ? Number(objetivo) : null,
        rendimento_tipo ? String(rendimento_tipo).trim() : null,
        rendimento_percentual != null && rendimento_percentual !== "" ? Number(rendimento_percentual) : null,
        instituicao ? String(instituicao).trim() : null,
        produto ? String(produto).trim() : null,
        auto_percentual ? 1 : 0,
        usuario_id
    );
}

function updateCaixinha(
    id,
    usuario_id,
    nome,
    objetivo,
    rendimento_tipo,
    rendimento_percentual,
    instituicao,
    produto,
    auto_percentual
) {
    return db.prepare(`
        UPDATE caixinhas SET nome = ? ,
        objetivo = ? ,
        rendimento_tipo = ? ,
        rendimento_percentual = ? ,
        instituicao = ? ,
        produto = ? ,
        auto_percentual = ?
        WHERE id = ?
        AND usuario_id = ?
    `).run(
        String(nome || "").trim(),
        objetivo != null && objetivo !== "" ? Number(objetivo) : null,
        rendimento_tipo ? String(rendimento_tipo).trim() : null,
        rendimento_percentual != null && rendimento_percentual !== "" ? Number(rendimento_percentual) : null,
        instituicao ? String(instituicao).trim() : null,
        produto ? String(produto).trim() : null,
        auto_percentual ? 1 : 0,
        Number(id),
        usuario_id
    );
}

function deleteCaixinha(id, usuario_id) {
  const tx = db.transaction(() => {
    const caixinha = db.prepare(`
      SELECT id, nome, saldo
      FROM caixinhas
      WHERE id = ?
        AND usuario_id = ?
    `).get(Number(id), usuario_id);

    if (!caixinha) {
      throw new Error("Caixinha não encontrada");
    }

    const saldo = Number(caixinha.saldo || 0);

    if (saldo > 0) {
      db.prepare(`
        INSERT INTO movimentacoes (
          descricao,
          valor,
          tipo,
          origem,
          categoria_id,
          data,
          usuario_id
        )
        VALUES (?, ?, 'entrada', 'caixinha', NULL, date('now'), ?)
      `).run(
        `Resgate ao excluir caixinha: ${caixinha.nome}`,
        saldo,
        usuario_id
      );
    }

    db.prepare(`
      DELETE FROM caixinha_movimentacoes
      WHERE caixinha_id = ?
        AND usuario_id = ?
    `).run(Number(id), usuario_id);

    db.prepare(`
      DELETE FROM caixinhas
      WHERE id = ?
        AND usuario_id = ?
    `).run(Number(id), usuario_id);

    return { ok: true, valor_devolvido: saldo };
  });

  return tx();
}

function movimentarCaixinha(caixinha_id, usuario_id, valor, tipo, data) {
  // Movimentação em caixinha também espelha no saldo principal pra manter consistência.
    const valorNum = Number(valor);
    if (!Number.isFinite(valorNum) || valorNum <= 0) {
        return { ok: false, erro: "Valor invÃ¡lido" };
    }

    if (tipo !== "deposito" && tipo !== "saque") {
        return { ok: false, erro: "Tipo invÃ¡lido" };
    }

    const caixinha = db.prepare(`
        SELECT id, nome, saldo
        FROM caixinhas
        WHERE id = ?
            AND usuario_id = ?
    `).get(Number(caixinha_id), usuario_id);

    if (!caixinha) {
        return { ok: false, erro: "Caixinha nÃ£o encontrada" };
    }

    if (tipo === "deposito") {
        const saldoDisponivel = Number(getSaldoDisponivelParaCaixinhas(usuario_id) || 0);
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

    if (novoSaldo < 0) {
        return { ok: false, erro: "Saldo insuficiente na caixinha" };
    }

    const dataMov = data || new Date().toISOString().slice(0, 10);
    const dataHoraMov = new Date().toISOString();
    const descricaoTransferencia =
        tipo === "deposito" ?
        `Transferência para caixinha : ${caixinha.nome}`
        :
        `Resgate da caixinha : ${caixinha.nome}`
        ;
    const tipoMovPrincipal = tipo === "deposito" ? "saida" : "entrada";

    const tx = db.transaction(() => {
        db.prepare(`
            UPDATE caixinhas SET saldo = ?
            WHERE id = ?
            AND usuario_id = ?
        `).run(Number(novoSaldo.toFixed(2)), Number(caixinha_id), usuario_id);

        db.prepare(`
            INSERT INTO caixinha_movimentacoes(caixinha_id, valor, tipo, data, data_hora, usuario_id) VALUES(?, ?, ?, ?, ?, ?)
        `).run(Number(caixinha_id), valorNum, tipo, dataMov, dataHoraMov, usuario_id);

        // MantÃ©m coerÃªncia do saldo geral registrando transferÃªncia entre conta principal e caixinha.
        db.prepare(`
            INSERT INTO movimentacoes(descricao, valor, tipo, origem, categoria_id, data, usuario_id) VALUES(?, ?, ?, 'caixinha', NULL, ?, ?)
        `).run(descricaoTransferencia, valorNum, tipoMovPrincipal, dataMov, usuario_id);
    });

    tx();

    return {
        ok: true,
        saldo: Number(novoSaldo.toFixed(2))
    };
}

function getCaixinhaMovimentacoes(caixinha_id, usuario_id) {
    return db.prepare(`
        SELECT id, caixinha_id, valor, tipo, data, data_hora FROM caixinha_movimentacoes WHERE caixinha_id = ?
        AND usuario_id = ?
        ORDER BY date(data) DESC, id DESC 
    `).all(Number(caixinha_id), usuario_id);
}

function getCaixinhasTaxasEmUso(usuario_id) {
  const caixinhas = getCaixinhas(usuario_id);

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

function getCaixinhasEvolucao(periodo, usuario_id, referencia = null) {
  // Evolução histórica sem projeção futura: mostra só o que já aconteceu até "agora".
  const periodoNormalizado = ["diario", "semanal", "mensal", "anual"].includes(periodo)
    ? periodo
    : "mensal";
  const cdiAnual = getTaxaReferencia("CDI_ANUAL", DEFAULT_CDI_ANUAL);

  const now = referencia ? new Date(referencia) : new Date();
  const nowTs = now.getTime();
  const buckets = [];

  const pushBucketAteAgora = (idx, label, start, end) => {
    if (start.getTime() > nowTs) return;
    buckets.push({ idx, label, start, end });
  };

  const caixinhas = db.prepare(`
    SELECT id, nome, saldo, rendimento_percentual, auto_percentual, instituicao, produto, rendimento_tipo
    FROM caixinhas
    WHERE usuario_id = ?
    ORDER BY nome
  `).all(usuario_id);

  if (!caixinhas.length) return [];

  const movimentos = db.prepare(`
    SELECT caixinha_id, valor, tipo, data, data_hora
    FROM caixinha_movimentacoes
    WHERE usuario_id = ?
    ORDER BY COALESCE(data_hora, data) ASC, id ASC
  `).all(usuario_id).map((m) => {
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
      const start = new Date(ini);
      start.setHours(h, 0, 0, 0);

      const end = new Date(start);
      end.setHours(h + 1, 0, 0, 0);

      pushBucketAteAgora(h, `${String(h).padStart(2, "0")}h`, start, end);
    }
  }

      if (periodoNormalizado === "semanal") {
    const diaSemana = now.getDay();
    const desloc = diaSemana === 0 ? -6 : 1 - diaSemana;
    const segunda = new Date(now.getFullYear(), now.getMonth(), now.getDate() + desloc, 0, 0, 0, 0);
    const labels = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sab", "Dom"];

    for (let i = 0; i < 7; i++) {
      const start = new Date(segunda);
      start.setDate(segunda.getDate() + i);

      const end = new Date(start);
      end.setDate(start.getDate() + 1);

      pushBucketAteAgora(i, labels[i], start, end);
    }
  }

      if (periodoNormalizado === "mensal") {
  const ano = now.getFullYear();
  const mes = now.getMonth();
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
        const autoTaxa = auto ? getPercentualAutomatico(c) : null;
        const percentualAplicado = autoTaxa
          ? Number(autoTaxa.percentual || 0)
          : Number(c.rendimento_percentual || 0);

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
    getCaixinhasEvolucao,

};