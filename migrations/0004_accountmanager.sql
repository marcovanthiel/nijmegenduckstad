-- Nijmegen Duckstad — accountmanager-rol + koppeling aan ingebrachte prijzen.
-- Draai met: wrangler d1 execute nijmegenduckstad --remote --file=migrations/0004_accountmanager.sql
--
-- - users krijgen naam + telefoon (voor de ondertekening van prijs-bevestigingen).
-- - prizes krijgen een gekoppelde accountmanager (verwijzing naar users.id).
-- - de rol 'accountmanager' is gewoon een nieuwe waarde in users.role (geen schema-wijziging nodig).

ALTER TABLE users  ADD COLUMN name  TEXT;
ALTER TABLE users  ADD COLUMN phone TEXT;
ALTER TABLE prizes ADD COLUMN account_manager_id TEXT;  -- NULL = geen accountmanager gekoppeld
