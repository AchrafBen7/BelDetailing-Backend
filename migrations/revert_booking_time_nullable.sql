-- ============================================================
-- MIGRATION: Revert - Make booking start_time and end_time NOT NULL again
-- ============================================================
-- Date: 2026-01-23
-- Description: Revert la migration précédente car start_time et end_time
--              sont nécessaires pour les bookings (services ponctuels).
--              Les missions (offers) ne doivent pas créer de booking.
-- ============================================================

-- Remettre start_time NOT NULL
ALTER TABLE bookings
ALTER COLUMN start_time SET NOT NULL;

-- Remettre end_time NOT NULL
ALTER TABLE bookings
ALTER COLUMN end_time SET NOT NULL;

-- Supprimer les commentaires ajoutés
COMMENT ON COLUMN bookings.start_time IS NULL;
COMMENT ON COLUMN bookings.end_time IS NULL;
