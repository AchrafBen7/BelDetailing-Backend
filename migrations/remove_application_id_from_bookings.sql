-- ============================================================
-- SUPPRIMER LES COLONNES application_id ET offer_id DE LA TABLE bookings
-- ============================================================
-- Date: 2025-01-23
-- Description: Supprimer les colonnes application_id et offer_id de la table bookings
--              car les missions (offers) ne doivent PAS créer de bookings.
--              Les missions sont gérées via Mission Agreement uniquement.
--              Les bookings sont uniquement pour les services ponctuels avec start_time/end_time.
-- ============================================================
-- ⚠️ ATTENTION : Cette migration supprime définitivement ces colonnes
-- ⚠️ Assurez-vous que ces colonnes n'est plus utilisées avant d'exécuter cette migration
-- ============================================================

-- 1. Vérifier et supprimer la colonne application_id
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 
    FROM information_schema.columns 
    WHERE table_name = 'bookings' 
      AND column_name = 'application_id'
  ) THEN
    -- Supprimer la colonne si elle existe
    ALTER TABLE bookings DROP COLUMN application_id;
    RAISE NOTICE '✅ Colonne application_id supprimée de la table bookings';
  ELSE
    RAISE NOTICE 'ℹ️ Colonne application_id n''existe pas dans la table bookings';
  END IF;
END $$;

-- 2. Vérifier et supprimer la colonne offer_id
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 
    FROM information_schema.columns 
    WHERE table_name = 'bookings' 
      AND column_name = 'offer_id'
  ) THEN
    -- Supprimer la colonne si elle existe
    ALTER TABLE bookings DROP COLUMN offer_id;
    RAISE NOTICE '✅ Colonne offer_id supprimée de la table bookings';
  ELSE
    RAISE NOTICE 'ℹ️ Colonne offer_id n''existe pas dans la table bookings';
  END IF;
END $$;

-- 3. Vérifier que les colonnes ont bien été supprimées
SELECT 
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_name = 'bookings'
  AND (column_name = 'application_id' OR column_name = 'offer_id')
ORDER BY column_name;
-- Cette requête ne doit retourner aucune ligne si les colonnes ont été supprimées
