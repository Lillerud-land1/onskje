-- 2026-11-07: kort delekode (7 teikn) for kortare delelenkjer. Køyr éin gong på ein eksisterande database.
ALTER TABLE lister ADD COLUMN kort TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS lister_kort ON lister (kort);
