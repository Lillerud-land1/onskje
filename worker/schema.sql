-- Ønskje: tabellar i D1. Køyr med:
--   wrangler d1 execute onskje --remote --file schema.sql   (eller --local for testing)

-- Kontoar. Ein konto utan namn er «anonym»: han er laga automatisk på éi eining
-- og kan få namn og passord seinare.
CREATE TABLE IF NOT EXISTS brukarar (
  id TEXT PRIMARY KEY,
  namn TEXT UNIQUE,
  salt TEXT,
  hash TEXT,
  iter INTEGER,
  laga INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS okter (
  tokenhash TEXT PRIMARY KEY,
  brukar TEXT NOT NULL,
  laga INTEGER NOT NULL,
  sist INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS okter_brukar ON okter (brukar);

CREATE TABLE IF NOT EXISTS forsok (
  namn TEXT NOT NULL,
  ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS forsok_namn ON forsok (namn);

CREATE TABLE IF NOT EXISTS gjenoppretting (
  brukar TEXT PRIMARY KEY,
  hash TEXT NOT NULL,
  laga INTEGER NOT NULL
);

-- Lister. delid er den offentlege id-en i delelenkja.
CREATE TABLE IF NOT EXISTS lister (
  id TEXT PRIMARY KEY,
  brukar TEXT NOT NULL,
  delid TEXT NOT NULL UNIQUE,
  data TEXT NOT NULL,
  pos REAL NOT NULL DEFAULT 0,
  laga INTEGER NOT NULL,
  endra INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS lister_brukar ON lister (brukar);

-- Ønske i ei liste. pos er rekkjefølgja (1 = mest ønskt).
CREATE TABLE IF NOT EXISTS ting (
  id TEXT PRIMARY KEY,
  liste TEXT NOT NULL,
  data TEXT NOT NULL,
  pos REAL NOT NULL DEFAULT 0,
  laga INTEGER NOT NULL,
  endra INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ting_liste ON ting (liste);

-- Reservasjonar frå folk som har fått delelenkja. Eigaren av lista får aldri sjå desse.
CREATE TABLE IF NOT EXISTS reservasjonar (
  id TEXT PRIMARY KEY,
  ting TEXT NOT NULL,
  liste TEXT NOT NULL,
  namn TEXT NOT NULL,
  antal INTEGER NOT NULL DEFAULT 1,
  nokkelhash TEXT NOT NULL,
  laga INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS res_liste ON reservasjonar (liste);
CREATE INDEX IF NOT EXISTS res_ting ON reservasjonar (ting);

-- Bilete brukaren har lima inn eller valt sjølv (når butikken ikkje gir bilete). Skalert ned i appen før opplasting.
CREATE TABLE IF NOT EXISTS bilete (
  id TEXT PRIMARY KEY,
  brukar TEXT NOT NULL,
  type TEXT NOT NULL,
  data BLOB NOT NULL,
  laga INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS bilete_brukar ON bilete (brukar);

-- Lister som er delte med ein brukar (opna via lenkje).
CREATE TABLE IF NOT EXISTS folgjer (
  brukar TEXT NOT NULL,
  delid TEXT NOT NULL,
  laga INTEGER NOT NULL,
  PRIMARY KEY (brukar, delid)
);
