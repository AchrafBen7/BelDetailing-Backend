-- ============================================================
-- AJOUTER LA COLONNE operational_rules À LA TABLE mission_agreements
-- ============================================================
-- Date: 2025-01-23
-- Description: Ajouter la colonne operational_rules (JSONB) pour stocker
--              les règles opérationnelles des Mission Agreements.
--              Cette colonne est utilisée lors de la confirmation d'un contrat.
-- ============================================================

-- 1. Ajouter la colonne operational_rules
ALTER TABLE mission_agreements 
ADD COLUMN IF NOT EXISTS operational_rules JSONB DEFAULT '{}'::jsonb;

-- 2. Ajouter un commentaire pour documentation
COMMENT ON COLUMN mission_agreements.operational_rules IS 
'Règles opérationnelles de la mission (présence, dates, matériel, véhicules, preuves, incidents, paiement, facturation, annulation). Format JSONB.';

-- 3. Vérifier que la colonne a été ajoutée
SELECT 
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_name = 'mission_agreements'
  AND column_name = 'operational_rules';

-- Si la requête ci-dessus retourne une ligne, la colonne a été ajoutée avec succès.
