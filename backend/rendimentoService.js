const pool = require("./db");
const taxasPadraoInstituicoes = require("./data/rendimentoInstituicoes.default.json");

const DEFAULT_CDI_ANUAL = 0.1365;

async function fetchJSON(url) {
  const res = await fetch(url, { headers: { "User-Agent": "CashControl/1.0" } });
  if (!res.ok) throw new Error(`Falha ao consultar ${url}: ${res.status}`);
  return res.json();
}

async function upsertTaxaReferencia(chave, valor, fonte) {
  await pool.query(`
    INSERT INTO taxas_referencia (chave, valor, fonte, updated_at)
    VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
    ON CONFLICT (chave) DO UPDATE SET
      valor = EXCLUDED.valor,
      fonte = EXCLUDED.fonte,
      updated_at = CURRENT_TIMESTAMP
  `, [chave, Number(valor), fonte]);
}

async function getTaxaReferencia(chave, fallback = null) {
  const result = await pool.query(
    "SELECT valor FROM taxas_referencia WHERE chave = $1",
    [chave]
  );
  if (!result.rows[0]) return fallback;
  return Number(result.rows[0].valor);
}

async function atualizarCDIAnual() {
  const taxas = await fetchJSON("https://brasilapi.com.br/api/taxas/v1");
  if (!Array.isArray(taxas)) throw new Error("Resposta inválida da API de taxas");

  const cdi = taxas.find((t) => String(t.nome || "").toUpperCase() === "CDI");
  if (!cdi || typeof cdi.valor === "undefined") throw new Error("CDI não encontrado na API de taxas");

  const cdiAnual = Number(cdi.valor) / 100;
  if (!Number.isFinite(cdiAnual) || cdiAnual <= 0) throw new Error("Valor de CDI inválido");

  await upsertTaxaReferencia("CDI_ANUAL", cdiAnual, "brasilapi");
  return { ok: true, chave: "CDI_ANUAL", valor: cdiAnual, fonte: "brasilapi" };
}

async function upsertRendimentoInstituicao(item) {
  const instituicao = String(item.instituicao || "").trim();
  const produto = String(item.produto || "Conta").trim();
  const indexador = String(item.indexador || "CDI").trim().toUpperCase();
  const percentual = Number(item.percentual);

  if (!instituicao || !Number.isFinite(percentual) || percentual <= 0) {
    return { ok: false, erro: "Item inválido" };
  }

  await pool.query(`
    INSERT INTO rendimento_instituicoes (
      instituicao, produto, indexador, percentual, fonte, source_url, updated_at, ativo
    )
    VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP, 1)
    ON CONFLICT (instituicao, produto, indexador) DO UPDATE SET
      percentual = EXCLUDED.percentual,
      fonte = EXCLUDED.fonte,
      source_url = EXCLUDED.source_url,
      updated_at = CURRENT_TIMESTAMP,
      ativo = 1
  `, [
    instituicao,
    produto,
    indexador,
    percentual,
    item.fonte ? String(item.fonte) : "feed-publico",
    item.source_url ? String(item.source_url) : null
  ]);

  return { ok: true };
}

function isLocalFallbackEnabled() {
  const raw = String(process.env.USE_LOCAL_DEFAULT_RATES || "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

async function desativarTaxasLocalDefault() {
  await pool.query(`
    UPDATE rendimento_instituicoes
    SET ativo = 0
    WHERE fonte = 'local-default' OR source_url = 'local://default-rates'
  `);
}

async function atualizarTaxasInstituicoes() {
  const url = process.env.TAXAS_BANCOS_URL;
  const usarFallbackLocal = isLocalFallbackEnabled();

  let lista = null;
  let fonte = null;

  if (!url) {
    if (!usarFallbackLocal) {
      await desativarTaxasLocalDefault();
      return {
        ok: true,
        skipped: true,
        motivo: "TAXAS_BANCOS_URL não configurada",
        local_default_ativo: false
      };
    }
    lista = Array.isArray(taxasPadraoInstituicoes) ? taxasPadraoInstituicoes : [];
    fonte = "local-default";
  } else {
    const payload = await fetchJSON(url);
    lista = Array.isArray(payload) ? payload : payload?.data;
    fonte = url;
  }

  if (!Array.isArray(lista)) throw new Error("Feed de instituições inválido (esperado array)");

  let atualizadas = 0;
  for (const item of lista) {
    const r = await upsertRendimentoInstituicao({
      ...item,
      fonte: item?.fonte || fonte,
      source_url: item?.source_url || (fonte === "local-default" ? "local://default-rates" : fonte)
    });
    if (r.ok) atualizadas++;
  }

  return { ok: true, atualizadas, fonte };
}

async function getRendimentoInstituicoes(indexador = null) {
  if (indexador) {
    const result = await pool.query(`
      SELECT instituicao, produto, indexador, percentual, fonte, source_url, updated_at
      FROM rendimento_instituicoes
      WHERE ativo = 1 AND UPPER(indexador) = UPPER($1)
      ORDER BY instituicao, produto
    `, [String(indexador)]);
    return result.rows;
  }

  const result = await pool.query(`
    SELECT instituicao, produto, indexador, percentual, fonte, source_url, updated_at
    FROM rendimento_instituicoes
    WHERE ativo = 1
    ORDER BY instituicao, produto
  `);
  return result.rows;
}

async function getTaxasStatus() {
  const cdiResult = await pool.query(`
    SELECT chave, valor, fonte, updated_at
    FROM taxas_referencia
    WHERE chave = 'CDI_ANUAL'
  `);

  const cdi = cdiResult.rows[0] || {
    chave: "CDI_ANUAL",
    valor: DEFAULT_CDI_ANUAL,
    fonte: "fallback",
    updated_at: null
  };

  const totalResult = await pool.query(
    "SELECT COUNT(*)::int AS total FROM rendimento_instituicoes WHERE ativo = 1"
  );

  return {
    cdi,
    total_instituicoes: Number(totalResult.rows[0].total),
    fonte_instituicoes: process.env.TAXAS_BANCOS_URL || (isLocalFallbackEnabled() ? "local-default" : null)
  };
}

async function atualizarTudoRendimento() {
  const resultado = { cdi: null, instituicoes: null, erros: [] };

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
