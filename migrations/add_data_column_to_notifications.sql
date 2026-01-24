-- ============================================================
-- AJOUTER LA COLONNE data À LA TABLE notifications
-- ============================================================
-- Date: 2025-01-23
-- Description: Ajouter la colonne data (JSONB) pour stocker
--              des données supplémentaires dans les notifications.
--              Cette colonne permet de stocker des métadonnées
--              spécifiques à chaque type de notification.
-- ============================================================

-- 1. Ajouter la colonne data
ALTER TABLE notifications 
ADD COLUMN IF NOT EXISTS data JSONB DEFAULT '{}'::jsonb;

-- 2. Ajouter un commentaire pour documentation
COMMENT ON COLUMN notifications.data IS 
'Données supplémentaires de la notification (métadonnées, liens, IDs de ressources, etc.). Format JSONB.';

-- 3. Vérifier que la colonne a été ajoutée
SELECT 
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_name = 'notifications'
  AND column_name = 'data';

-- Si la requête ci-dessus retourne une ligne, la colonne a été ajoutée avec succès.
