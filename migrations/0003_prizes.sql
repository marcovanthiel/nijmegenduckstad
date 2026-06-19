-- Nijmegen Duckstad — prijzenadministratie (te winnen prijzen + inbrengers).
-- Draai met: wrangler d1 execute nijmegenduckstad --remote --file=migrations/0003_prizes.sql

CREATE TABLE IF NOT EXISTS prizes (
  id                   TEXT PRIMARY KEY,            -- UUID
  created_at           TEXT NOT NULL,
  title                TEXT NOT NULL,               -- de prijs, bv. "Ballonvaart voor 2 personen"
  value                TEXT,                        -- vrije tekst, bv. "t.w.v. € 250"
  description          TEXT,                        -- extra omschrijving (optioneel)
  donor_name           TEXT NOT NULL,               -- inbrenger (naam)
  donor_company        TEXT,                        -- bedrijf / organisatie (optioneel)
  donor_email          TEXT,                        -- inbrenger e-mail (voor de bevestigingsmail)
  donor_phone          TEXT,                        -- inbrenger telefoon (optioneel)
  conditions           TEXT,                        -- voorwaarden waaronder de prijs is ingebracht
  confirmation_sent_at TEXT                         -- wanneer de bevestigingsmail is verstuurd (NULL = nog niet)
);
CREATE INDEX IF NOT EXISTS idx_prizes_created ON prizes(created_at);
