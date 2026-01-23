-- ============================================================
-- SCRIPT: Run migration to make booking time nullable
-- ============================================================
-- Date: 2026-01-23
-- Description: Rendre les colonnes start_time et end_time nullable
--              pour permettre les missions sans heures précises au moment de l'acceptation
-- ============================================================

-- Exécuter ce script dans votre client PostgreSQL (psql, pgAdmin, Supabase SQL Editor, etc.)

-- Make start_time nullable
ALTER TABLE bookings
ALTER COLUMN start_time DROP NOT NULL;

-- Make end_time nullable
ALTER TABLE bookings
ALTER COLUMN end_time DROP NOT NULL;

-- Add comment to document the change
COMMENT ON COLUMN bookings.start_time IS 'Nullable for missions (offers). Times are managed in Mission Agreement.';
COMMENT ON COLUMN bookings.end_time IS 'Nullable for missions (offers). Times are managed in Mission Agreement.';

-- Vérification
SELECT 
    column_name, 
    is_nullable, 
    data_type 
FROM information_schema.columns 
WHERE table_name = 'bookings' 
AND column_name IN ('date', 'start_time', 'end_time')
ORDER BY column_name;
