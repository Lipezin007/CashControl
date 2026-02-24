const db = require("./db");

// categorias
function getCategorias() {
    return db.prepare("SELECT * FROM categorias").all();
}

function addCategoria(nome) {
    return db.prepare("INSERT INTO categorias (nome) VALUES (?)").run(nome);
}

// transacoes
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
function inserirTransacao(descricao, valor, tipo, categoria_id, data) {
    return db.prepare(`
        INSERT INTO transacoes (descricao, valor, tipo, categoria_id, data)
        VALUES (?, ?, ?, ?, ?)
    `).run(descricao, valor, tipo, categoria_id, data);
}

function deleteTransacao(id) {
    return db.prepare(`
        DELETE FROM transacoes WHERE id = ?
    `).run(id);
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

module.exports = {
    getCategorias,
    addCategoria,
    getTransacoes,
    inserirTransacao,
    deleteTransacao,
    updateTransacao,
    getResumo,
    getRecorrencias,
    addRecorrencia,
    setRecorrenciaAtiva,
    gerarRecorrencias,
    relatorioPorCategoria
};
// RECORRÊNCIAS
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
  return db.prepare(`UPDATE recorrencias SET ativo=? WHERE id=?`).run(ativo ? 1 : 0, id);
}

// gera transações do mês baseado nas recorrências ativas (sem duplicar)
function gerarRecorrencias(mesYYYYMM) {
  const recorrs = db.prepare(`
    SELECT * FROM recorrencias WHERE ativo = 1
  `).all();

  const inserir = db.prepare(`
    INSERT INTO transacoes (descricao, valor, tipo, categoria_id, data)
    VALUES (?, ?, ?, ?, ?)
  `);

  let criadas = 0;
  for (const r of recorrs) {
    const data = `${mesYYYYMM}-${String(r.dia_mes).padStart(2, "0")}`;

    // não duplica se já existe uma transação igual naquele dia
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

}// RECORRÊNCIAS
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
  return db.prepare(`UPDATE recorrencias SET ativo=? WHERE id=?`).run(ativo ? 1 : 0, id);
}

// gera transações do mês baseado nas recorrências ativas (sem duplicar)
function gerarRecorrencias(mesYYYYMM) {
  const recorrs = db.prepare(`
    SELECT * FROM recorrencias WHERE ativo = 1
  `).all();

  const inserir = db.prepare(`
    INSERT INTO transacoes (descricao, valor, tipo, categoria_id, data)
    VALUES (?, ?, ?, ?, ?)
  `);

  let criadas = 0;
  for (const r of recorrs) {
    const data = `${mesYYYYMM}-${String(r.dia_mes).padStart(2, "0")}`;

    // não duplica se já existe uma transação igual naquele dia
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