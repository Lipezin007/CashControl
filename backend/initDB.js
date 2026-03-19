const Database = require("better-sqlite3");
const path = require("path");

const dbPath = path.join(__dirname, "..", "database", "database.db");

const db = new Database(dbPath);

console.log("Inicializando banco de dados...");

db.exec(`

CREATE TABLE IF NOT EXISTS usuarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT,
  email TEXT UNIQUE,
  senha TEXT,
  reset_token_hash TEXT,
  reset_expires_at INTEGER
);

CREATE TABLE IF NOT EXISTS categorias (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT,
  usuario_id INTEGER
);

CREATE TABLE IF NOT EXISTS movimentacoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
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
);

CREATE TABLE IF NOT EXISTS cartoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT,
  limite REAL,
  dia_fechamento INTEGER,
  dia_vencimento INTEGER,
  usuario_id INTEGER,
  ativo INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS compras_cartao (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cartao_id INTEGER,
  descricao TEXT,
  valor_total REAL,
  parcelas INTEGER,
  juros_mensal REAL,
  data_compra TEXT,
  categoria_id INTEGER,
  usuario_id INTEGER
);

CREATE TABLE IF NOT EXISTS parcelas_cartao (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cartao_id INTEGER,
  valor REAL,
  numero_parcela INTEGER,
  total_parcelas INTEGER,
  mes_ref TEXT,
  usuario_id INTEGER,
  status TEXT DEFAULT 'aberta',
  compra_id INTEGER,
  FOREIGN KEY (compra_id) REFERENCES compras_cartao(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS metas_categoria (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id INTEGER,
  categoria_id INTEGER,
  mes TEXT,
  valor_meta REAL,
  UNIQUE(usuario_id, categoria_id, mes)
);

CREATE TABLE IF NOT EXISTS recorrencias (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  descricao TEXT,
  valor REAL,
  tipo TEXT,
  categoria_id INTEGER,
  dia_mes INTEGER,
  ativo INTEGER DEFAULT 1,
  usuario_id INTEGER
);

CREATE TABLE IF NOT EXISTS caixinhas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
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
);

CREATE TABLE IF NOT EXISTS caixinha_movimentacoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  caixinha_id INTEGER,
  valor REAL,
  tipo TEXT,
  data TEXT,
  data_hora TEXT,
  usuario_id INTEGER,
  FOREIGN KEY (caixinha_id) REFERENCES caixinhas(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS taxas_referencia (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chave TEXT UNIQUE,
  valor REAL,
  fonte TEXT,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS rendimento_instituicoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  instituicao TEXT,
  produto TEXT,
  indexador TEXT,
  percentual REAL,
  fonte TEXT,
  source_url TEXT,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  ativo INTEGER DEFAULT 1,
  UNIQUE(instituicao, produto, indexador)
);

`);

/* -------------------------
   CATEGORIAS PADRÃO
--------------------------*/

const qtd = db.prepare(`
  SELECT COUNT(*) as total FROM categorias
`).get().total;

if (qtd === 0) {

    const categorias = [
        "Alimentação",
        "Transporte",
        "Moradia",
        "Lazer",
        "Saúde",
        "Educação",
        "Salário",
        "Investimentos",
        "Outros"
    ];

    const insert = db.prepare(`
    INSERT INTO categorias (nome) VALUES (?)
  `);

    for (const c of categorias) {
        insert.run(c);
    }

    console.log("Categorias padrão criadas!");
}

console.log("Banco criado com sucesso.");

// Migração leve para bases antigas
const userColumns = db.prepare("PRAGMA table_info(usuarios)").all();
const temResetToken = userColumns.some(c => c.name === "reset_token_hash");
const temResetExpires = userColumns.some(c => c.name === "reset_expires_at");

if (!temResetToken) {
    db.exec("ALTER TABLE usuarios ADD COLUMN reset_token_hash TEXT");
}
if (!temResetExpires) {
    db.exec("ALTER TABLE usuarios ADD COLUMN reset_expires_at INTEGER");
}

db.exec("CREATE INDEX IF NOT EXISTS idx_usuarios_reset_token_hash ON usuarios(reset_token_hash)");
db.exec("CREATE INDEX IF NOT EXISTS idx_caixinhas_usuario_id ON caixinhas(usuario_id)");
db.exec("CREATE INDEX IF NOT EXISTS idx_caixinha_mov_caixinha_id ON caixinha_movimentacoes(caixinha_id)");
db.exec("CREATE INDEX IF NOT EXISTS idx_parcelas_cartao_cartao_id ON parcelas_cartao(cartao_id)");
db.exec("CREATE INDEX IF NOT EXISTS idx_parcelas_cartao_mes_ref ON parcelas_cartao(mes_ref)");
db.exec("CREATE INDEX IF NOT EXISTS idx_parcelas_cartao_compra_id ON parcelas_cartao(compra_id)");
db.exec("CREATE INDEX IF NOT EXISTS idx_taxas_referencia_chave ON taxas_referencia(chave)");
db.exec("CREATE INDEX IF NOT EXISTS idx_rendimento_inst_lookup ON rendimento_instituicoes(instituicao, produto, indexador)");

const parcelasCols = db.prepare("PRAGMA table_info(parcelas_cartao)").all();
const temStatusParcela = parcelasCols.some(c => c.name === "status");
const temCompraIdParcela = parcelasCols.some(c => c.name === "compra_id");

if (!temStatusParcela) {
    db.exec("ALTER TABLE parcelas_cartao ADD COLUMN status TEXT DEFAULT 'aberta'");
}

if (!temCompraIdParcela) {
    db.exec("ALTER TABLE parcelas_cartao ADD COLUMN compra_id INTEGER");
}

const caixinhasCols = db.prepare("PRAGMA table_info(caixinhas)").all();
const temInstituicao = caixinhasCols.some(c => c.name === "instituicao");
const temProduto = caixinhasCols.some(c => c.name === "produto");
const temAutoPercentual = caixinhasCols.some(c => c.name === "auto_percentual");
const temCreatedAtCaixinha = caixinhasCols.some(c => c.name === "created_at");

if (!temInstituicao) {
    db.exec("ALTER TABLE caixinhas ADD COLUMN instituicao TEXT");
}

if (!temProduto) {
    db.exec("ALTER TABLE caixinhas ADD COLUMN produto TEXT");
}

if (!temAutoPercentual) {
    db.exec("ALTER TABLE caixinhas ADD COLUMN auto_percentual INTEGER DEFAULT 0");
}

if (!temCreatedAtCaixinha) {
    db.exec("ALTER TABLE caixinhas ADD COLUMN created_at TEXT");
}

db.exec(`
  UPDATE caixinhas
  SET created_at = COALESCE(
    created_at,
    (
      SELECT MIN(COALESCE(cm.data_hora, cm.data))
      FROM caixinha_movimentacoes cm
      WHERE cm.caixinha_id = caixinhas.id
        AND cm.usuario_id = caixinhas.usuario_id
    ),
    CURRENT_TIMESTAMP
  )
  WHERE created_at IS NULL OR TRIM(created_at) = ''
`);

const caixinhaMovCols = db.prepare("PRAGMA table_info(caixinha_movimentacoes)").all();
const temDataHoraCaixinhaMov = caixinhaMovCols.some(c => c.name === "data_hora");

if (!temDataHoraCaixinhaMov) {
    db.exec("ALTER TABLE caixinha_movimentacoes ADD COLUMN data_hora TEXT");
}

const cdiDefault = db.prepare("SELECT chave FROM taxas_referencia WHERE chave='CDI_ANUAL'").get();
if (!cdiDefault) {
    db.prepare(`
    INSERT INTO taxas_referencia (chave, valor, fonte)
    VALUES ('CDI_ANUAL', 0.1365, 'fallback-inicial')
  `).run();
}

db.close();