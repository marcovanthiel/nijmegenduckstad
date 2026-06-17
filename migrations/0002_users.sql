-- Nijmegen Duckstad — adminaccounts met rollen + sessies + wachtwoordreset.
-- Draai met: wrangler d1 execute nijmegenduckstad --remote --file=migrations/0002_users.sql

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,                 -- UUID
  email         TEXT NOT NULL UNIQUE,             -- = gebruikersnaam (lowercase)
  pass_hash     TEXT,                             -- pbkdf2$iter$salt$hash; NULL tot eerste keer instellen
  role          TEXT NOT NULL DEFAULT 'readonly', -- 'admin' | 'readonly'
  created_at    TEXT NOT NULL,
  reset_token   TEXT,                             -- eenmalige token voor (eerste) wachtwoord instellen / reset
  reset_expires TEXT
);
CREATE INDEX IF NOT EXISTS idx_users_reset ON users(reset_token);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,                    -- random sessietoken (cookie)
  user_id    TEXT NOT NULL,
  email      TEXT NOT NULL,
  role       TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_exp ON sessions(expires);
