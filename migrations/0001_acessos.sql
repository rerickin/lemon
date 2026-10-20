-- Contador das páginas de links (lmon.cc). Já existe em produção.
CREATE TABLE IF NOT EXISTS acessos (dia TEXT NOT NULL, cliente TEXT NOT NULL, tipo TEXT NOT NULL, rotulo TEXT NOT NULL DEFAULT '', total INTEGER NOT NULL DEFAULT 0, unicos INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (dia, cliente, tipo, rotulo));
