const pool = require("./db");

async function initDB() {
  console.log("Inicializando banco de dados...");

  await pool.query(`
    CREATE TABLE IF NOT EXISTS usuarios (
      id SERIAL PRIMARY KEY,
      nome TEXT,
      email TEXT UNIQUE,
      senha TEXT,
      reset_token_hash TEXT,
      reset_expires_at BIGINT
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS categorias (
      id SERIAL PRIMARY KEY,
      nome TEXT,
      usuario_id INTEGER
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS movimentacoes (
      id SERIAL PRIMARY KEY,
      descricao TEXT,
      valor REAL,
      tipo TEXT,
      data TEXT,
      categoria_id INTEGER,
      usuario_id INTEGER,
      cartao_id INTEGER,
      parcela_num INTEGER,
      parcela_total INTEGER,
      origem TEXT
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS cartoes (
      id SERIAL PRIMARY KEY,
      nome TEXT,
      limite REAL,
      dia_fechamento INTEGER,
      dia_vencimento INTEGER,
      usuario_id INTEGER,
      ativo INTEGER DEFAULT 1
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS compras_cartao (
      id SERIAL PRIMARY KEY,
      cartao_id INTEGER,
      descricao TEXT,
      valor_total REAL,
      parcelas INTEGER,
      juros_mensal REAL,
      data_compra TEXT,
      categoria_id INTEGER,
      usuario_id INTEGER
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS parcelas_cartao (
      id SERIAL PRIMARY KEY,
      cartao_id INTEGER,
      valor REAL,
      numero_parcela INTEGER,
      total_parcelas INTEGER,
      mes_ref TEXT,
      usuario_id INTEGER,
      status TEXT DEFAULT 'aberta',
      compra_id INTEGER
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS metas_categoria (
      id SERIAL PRIMARY KEY,
      usuario_id INTEGER,
      categoria_id INTEGER,
      mes TEXT,
      valor_meta REAL,
      UNIQUE(usuario_id, categoria_id, mes)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS recorrencias (
      id SERIAL PRIMARY KEY,
      descricao TEXT,
      valor REAL,
      tipo TEXT,
      categoria_id INTEGER,
      dia_mes INTEGER,
      ativo INTEGER DEFAULT 1,
      usuario_id INTEGER
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS caixinhas (
      id SERIAL PRIMARY KEY,
      nome TEXT,
      saldo REAL DEFAULT 0,
      objetivo REAL,
      rendimento_tipo TEXT,
      rendimento_percentual REAL,
      instituicao TEXT,
      produto TEXT,
      auto_percentual INTEGER DEFAULT 0,
      usuario_id INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS caixinha_movimentacoes (
      id SERIAL PRIMARY KEY,
      caixinha_id INTEGER,
      valor REAL,
      tipo TEXT,
      data TEXT,
      data_hora TEXT,
      usuario_id INTEGER
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS taxas_referencia (
      id SERIAL PRIMARY KEY,
      chave TEXT UNIQUE,
      valor REAL,
      fonte TEXT,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS rendimento_instituicoes (
      id SERIAL PRIMARY KEY,
      instituicao TEXT,
      produto TEXT,
      indexador TEXT,
      percentual REAL,
      fonte TEXT,
      source_url TEXT,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      ativo INTEGER DEFAULT 1,
      UNIQUE(instituicao, produto, indexador)
    )
  `);

  // Índices
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_usuarios_reset_token_hash ON usuarios(reset_token_hash)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_caixinhas_usuario_id ON caixinhas(usuario_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_caixinha_mov_caixinha_id ON caixinha_movimentacoes(caixinha_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_parcelas_cartao_cartao_id ON parcelas_cartao(cartao_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_parcelas_cartao_mes_ref ON parcelas_cartao(mes_ref)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_parcelas_cartao_compra_id ON parcelas_cartao(compra_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_taxas_referencia_chave ON taxas_referencia(chave)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_rendimento_inst_lookup ON rendimento_instituicoes(instituicao, produto, indexador)`);

  // CDI padrão como fallback inicial
  await pool.query(`
    INSERT INTO taxas_referencia (chave, valor, fonte)
    VALUES ('CDI_ANUAL', 0.1365, 'fallback-inicial')
    ON CONFLICT (chave) DO NOTHING
  `);

  console.log("Banco criado com sucesso.");
}

module.exports = initDB;
