-- Nijmegen Duckstad — eigen, cookieloze pageview-telling (privacy-vriendelijk, geen PII).
-- Geaggregeerd per dag + pad + referrer-host. Draai met:
--   wrangler d1 execute nijmegenduckstad --remote --file=migrations/0007_pageviews.sql

CREATE TABLE IF NOT EXISTS pageviews (
  day  TEXT NOT NULL,            -- YYYY-MM-DD
  path TEXT NOT NULL,            -- bv. "/", "/bestellen"
  ref  TEXT NOT NULL DEFAULT '', -- referrer-host of '' (direct)
  n    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, path, ref)
);
CREATE INDEX IF NOT EXISTS idx_pageviews_day ON pageviews(day);
