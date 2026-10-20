-- Sistema de avaliações pós atendimento (garçom envia, cliente avalia)

CREATE TABLE IF NOT EXISTS av_config (
  cliente       TEXT PRIMARY KEY,
  nome          TEXT,              -- nome exibido (ex.: The Seven)
  pin_hash      TEXT,              -- SHA-256 do PIN de acesso dos garçons
  google_url    TEXT,              -- link para avaliar no Google (mostrado a quem dá nota alta)
  wa_template   TEXT,              -- nome do modelo aprovado na Meta
  wa_idioma     TEXT DEFAULT 'pt_BR'
);

CREATE TABLE IF NOT EXISTS av_garcons (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  cliente   TEXT NOT NULL,
  nome      TEXT NOT NULL,
  ativo     INTEGER NOT NULL DEFAULT 1,
  criado_em TEXT NOT NULL,
  UNIQUE (cliente, nome)
);

-- Cada pedido de avaliação feito por um garçom
CREATE TABLE IF NOT EXISTS av_pedidos (
  token         TEXT PRIMARY KEY,
  cliente       TEXT NOT NULL,
  garcom        TEXT NOT NULL,
  nome          TEXT,
  whatsapp      TEXT NOT NULL,
  dia           TEXT NOT NULL,     -- AAAA-MM-DD (Brasília)
  criado_em     TEXT NOT NULL,
  envio         TEXT,              -- api | manual | erro
  envio_erro    TEXT,
  aberto_em     TEXT,
  respondido_em TEXT
);
CREATE INDEX IF NOT EXISTS av_pedidos_cliente_dia ON av_pedidos (cliente, dia);

CREATE TABLE IF NOT EXISTS av_respostas (
  token       TEXT PRIMARY KEY,
  cliente     TEXT NOT NULL,
  garcom      TEXT NOT NULL,
  dia         TEXT NOT NULL,
  geral       INTEGER NOT NULL,    -- 1 a 5
  comida      INTEGER,             -- 1 a 5
  atendimento INTEGER,             -- 1 a 5
  comentario  TEXT,
  criado_em   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS av_respostas_cliente_dia ON av_respostas (cliente, dia);

-- Base de clientes do restaurante (uma linha por WhatsApp)
CREATE TABLE IF NOT EXISTS av_clientes (
  cliente       TEXT NOT NULL,
  whatsapp      TEXT NOT NULL,
  nome          TEXT,
  aniversario   TEXT,              -- MM-DD
  ofertas       INTEGER NOT NULL DEFAULT 0,  -- aceitou receber novidades
  avaliacoes    INTEGER NOT NULL DEFAULT 0,
  primeira_vez  TEXT NOT NULL,
  ultima_vez    TEXT NOT NULL,
  PRIMARY KEY (cliente, whatsapp)
);
CREATE INDEX IF NOT EXISTS av_clientes_aniv ON av_clientes (cliente, aniversario);
