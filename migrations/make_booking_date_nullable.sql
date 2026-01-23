-- ============================================================
-- MIGRATION: Make booking date nullable for missions
-- ============================================================
-- Date: 2026-01-22
-- Description: Rendre la colonne date nullable pour permettre les missions
--              sans date précise au moment de l'acceptation
-- ============================================================

-- Rendre la colonne date nullable
ALTER TABLE bookings 
ALTER COLUMN date DROP NOT NULL;

-- Ajouter un commentaire pour expliquer pourquoi date peut être null
COMMENT ON COLUMN bookings.date IS 'Date du service. NULL pour les missions où la date sera définie dans le Mission Agreement.';
