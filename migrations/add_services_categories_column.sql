-- ============================================================
-- AJOUTER LA COLONNE categories À LA TABLE services
-- ============================================================
-- Description: Support des catégories multiples pour les services
--              (ex: engine_bay, polishing, ceramic).
--              La colonne category (singulier) reste pour compatibilité.
-- ============================================================

ALTER TABLE services
ADD COLUMN IF NOT EXISTS categories JSONB DEFAULT '[]'::jsonb;

COMMENT ON COLUMN services.categories IS 'Catégories du service (array JSON), ex: ["engine_bay","polishing","ceramic"]. La colonne category contient la première.';
