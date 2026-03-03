const db = require("./db");

console.log("Inicializando banco de dados...");

db.exec(`

CREATE TABLE IF NOT EXISTS usuarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT,
  email TEXT UNIQUE,
  senha TEXT
);

CREATE TABLE IF NOT EXISTS categorias (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT
);

CREATE TABLE IF NOT EXISTS movimentacoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  descricao TEXT,
  valor REAL,
  tipo TEXT,
  origem TEXT,
  data TEXT,
  categoria_id INTEGER,
  usuario_id INTEGER,
  parcela_num INTEGER,
  parcela_total INTEGER,
  cartao_id INTEGER
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

CREATE TABLE IF NOT EXISTS parcelas_cartao (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cartao_id INTEGER,
  descricao TEXT,
  valor REAL,
  numero_parcela INTEGER,
  total_parcelas INTEGER,
  mes_ref TEXT,
  categoria_id INTEGER,
  usuario_id INTEGER,
  status TEXT DEFAULT 'pendente'
);

CREATE TABLE IF NOT EXISTS recorrencias (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  descricao TEXT,
  valor REAL,
  tipo TEXT,
  categoria_id INTEGER,
  dia_mes INTEGER,
  usuario_id INTEGER,
  ativo INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS metas_categoria (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id INTEGER,
  categoria_id INTEGER,
  valor_meta REAL,
  mes TEXT
);

`);

console.log("Banco inicializado!");