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

db.close();