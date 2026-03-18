const db = require("./db");

const DEFAULT_CDI_ANUAL = 0.1365;

async function fetchJSON(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "CashControl/1.0" }
  });

  if (!res.ok) {
    throw new Error(`Falha ao consultar ${url}: ${res.status}`);
  }

  return res.json();
}

function upsertTaxaReferencia(chave, valor, fonte) {
  db.prepare(`
    INSERT INTO taxas_referencia (chave, valor, fonte, updated_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(chave) DO UPDATE SET
      valor = excluded.valor,
      fonte = excluded.fonte,
      updated_at = CURRENT_TIMESTAMP
  `).run(chave, Number(valor), fonte);
}

function getTaxaReferencia(chave, fallback = null) {
  const row = db.prepare(`
    SELECT valor
    FROM taxas_referencia
    WHERE chave = ?
  `).get(chave);

  if (!row) return fallback;
  return Number(row.valor);
}

async function atualizarCDIAnual() {
  // BrasilAPI: endpoint público sem token.
  const taxas = await fetchJSON("https://brasilapi.com.br/api/taxas/v1");

  if (!Array.isArray(taxas)) {
    throw new Error("Resposta inválida da API de taxas");
  }

  const cdi = taxas.find((t) => String(t.nome || "").toUpperCase() === "CDI");
  if (!cdi || typeof cdi.valor === "undefined") {
    throw new Error("CDI não encontrado na API de taxas");
  }

  const cdiAnual = Number(cdi.valor) / 100;
  if (!Number.isFinite(cdiAnual) || cdiAnual <= 0) {
    throw new Error("Valor de CDI inválido");
  }

  upsertTaxaReferencia("CDI_ANUAL", cdiAnual, "brasilapi");

  return {
    ok: true,
    chave: "CDI_ANUAL",
    valor: cdiAnual,
    fonte: "brasilapi"
  };
}

function upsertRendimentoInstituicao(item) {
  const instituicao = String(item.instituicao || "").trim();
  const produto = String(item.produto || "Conta").trim();
  const indexador = String(item.indexador || "CDI").trim().toUpperCase();
  const percentual = Number(item.percentual);

  if (!instituicao || !Number.isFinite(percentual) || percentual <= 0) {
    return { ok: false, erro: "Item inválido" };
  }

  db.prepare(`
    INSERT INTO rendimento_instituicoes (
      instituicao, produto, indexador, percentual, fonte, source_url, updated_at, ativo
    )
    VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, 1)
    ON CONFLICT(instituicao, produto, indexador) DO UPDATE SET
      percentual = excluded.percentual,
      fonte = excluded.fonte,
      source_url = excluded.source_url,
      updated_at = CURRENT_TIMESTAMP,
      ativo = 1
  `).run(
    instituicao,
    produto,
    indexador,
    percentual,
    item.fonte ? String(item.fonte) : "feed-publico",
    item.source_url ? String(item.source_url) : null
  );

  return { ok: true };
}

async function atualizarTaxasInstituicoes() {
  const url = process.env.TAXAS_BANCOS_URL;

  if (!url) {
    return {
      ok: true,
      skipped: true,
      motivo: "TAXAS_BANCOS_URL não configurada"
    };
  }

  const payload = await fetchJSON(url);
  const lista = Array.isArray(payload) ? payload : payload?.data;

  if (!Array.isArray(lista)) {
    throw new Error("Feed de instituições inválido (esperado array)");
  }

  let atualizadas = 0;
  for (const item of lista) {
    const r = upsertRendimentoInstituicao(item);
    if (r.ok) atualizadas++;
  }

  return {
    ok: true,
    atualizadas,
    fonte: url
  };
}

function getRendimentoInstituicoes(indexador = null) {
  if (indexador) {
    return db.prepare(`
      SELECT instituicao, produto, indexador, percentual, fonte, source_url, updated_at
      FROM rendimento_instituicoes
      WHERE ativo = 1
        AND indexador = ?
      ORDER BY instituicao, produto
    `).all(String(indexador).toUpperCase());
  }

  return db.prepare(`
    SELECT instituicao, produto, indexador, percentual, fonte, source_url, updated_at
    FROM rendimento_instituicoes
    WHERE ativo = 1
    ORDER BY instituicao, produto
  `).all();
}

function getTaxasStatus() {
  const cdi = db.prepare(`
    SELECT chave, valor, fonte, updated_at
    FROM taxas_referencia
    WHERE chave = 'CDI_ANUAL'
  `).get() || {
    chave: "CDI_ANUAL",
    valor: DEFAULT_CDI_ANUAL,
    fonte: "fallback",
    updated_at: null
  };

  const totalInstituicoes = db.prepare(`
    SELECT COUNT(*) AS total
    FROM rendimento_instituicoes
    WHERE ativo = 1
  `).get().total;

  return {
    cdi,
    total_instituicoes: totalInstituicoes,
    fonte_instituicoes: process.env.TAXAS_BANCOS_URL || null
  };
}

async function atualizarTudoRendimento() {
  const resultado = {
    cdi: null,
    instituicoes: null,
    erros: []
  };

  try {
    resultado.cdi = await atualizarCDIAnual();
  } catch (err) {
    resultado.erros.push(`CDI: ${err.message}`);
  }

  try {
    resultado.instituicoes = await atualizarTaxasInstituicoes();
  } catch (err) {
    resultado.erros.push(`Instituições: ${err.message}`);
  }

  return resultado;
}

function iniciarAgendadorRendimento() {
  const intervaloHoras = Number(process.env.RENDIMENTO_SYNC_HOURS || 6);
  const ms = Math.max(1, intervaloHoras) * 60 * 60 * 1000;

  atualizarTudoRendimento().catch((err) => {
    console.error("[Rendimento] Falha na atualização inicial:", err.message);
  });

  setInterval(() => {
    atualizarTudoRendimento().catch((err) => {
      console.error("[Rendimento] Falha no agendador:", err.message);
    });
  }, ms);
}

module.exports = {
  DEFAULT_CDI_ANUAL,
  getTaxaReferencia,
  atualizarCDIAnual,
  atualizarTaxasInstituicoes,
  atualizarTudoRendimento,
  getRendimentoInstituicoes,
  getTaxasStatus,
  iniciarAgendadorRendimento
};
