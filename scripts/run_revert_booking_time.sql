-- ============================================================
-- SCRIPT: Revert migration - Make booking time NOT NULL again
-- ============================================================
-- Date: 2026-01-23
-- Description: Remettre start_time et end_time en NOT NULL
--              car les missions (offers) ne créent plus de booking
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

-- Vérification
SELECT 
    column_name, 
    is_nullable, 
    data_type 
FROM information_schema.columns 
WHERE table_name = 'bookings' 
AND column_name IN ('start_time', 'end_time')
ORDER BY column_name;

-- Résultat attendu :
-- start_time: is_nullable = NO
-- end_time: is_nullable = NO
