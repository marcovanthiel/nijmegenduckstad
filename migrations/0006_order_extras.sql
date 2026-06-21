-- Nijmegen Duckstad — bestellingen: vrijwillige extra-gift + cadeau-ontvanger.
-- Draai met: wrangler d1 execute nijmegenduckstad --remote --file=migrations/0006_order_extras.sql

ALTER TABLE orders ADD COLUMN extra_cents INTEGER NOT NULL DEFAULT 0; -- vrijwillige extra donatie
ALTER TABLE orders ADD COLUMN gift_name   TEXT;                       -- naam van de cadeau-ontvanger (optioneel)
