-- Nijmegen Duckstad — per-IP rate-limiting (brute-force / spam-bescherming).
-- Draai met: wrangler d1 execute nijmegenduckstad --remote --file=migrations/0005_rate_limits.sql
--
-- Eenvoudige fixed-window teller per sleutel (bucket:ip). De Worker faalt 'open'
-- als deze tabel ontbreekt, dus de site blijft werken; rate-limiting is pas
-- actief zodra de tabel bestaat.

CREATE TABLE IF NOT EXISTS rate_limits (
  k        TEXT PRIMARY KEY,   -- bucket:ip  (bv. "login:1.2.3.4")
  count    INTEGER NOT NULL,
  reset_at TEXT NOT NULL       -- ISO-tijd waarop het venster reset
);
