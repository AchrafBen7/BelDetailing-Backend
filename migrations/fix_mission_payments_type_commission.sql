-- Migration: Fix mission_payments type constraint to include "commission"
-- Date: 2026-01-25
-- Description: Add "commission" to the CHECK constraint on mission_payments.type

-- 1) Vérifier et supprimer l'ancienne contrainte CHECK sur type (si elle existe)
DO $$
BEGIN
  -- Vérifier si la contrainte existe et la modifier
  IF EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'mission_payments_type_valid'
  ) THEN
    -- Supprimer l'ancienne contrainte
    ALTER TABLE mission_payments DROP CONSTRAINT mission_payments_type_valid;
    RAISE NOTICE 'Constraint mission_payments_type_valid dropped';
  END IF;
END $$;

-- 2) Ajouter la nouvelle contrainte avec "commission" inclus
ALTER TABLE mission_payments
ADD CONSTRAINT mission_payments_type_valid
CHECK (type IN (
  'deposit',
  'commission',  -- ✅ AJOUTÉ: Type pour la commission NIOS (7%)
  'installment',
  'final',
  'monthly'
));

-- 3) Ajouter un commentaire pour documenter
COMMENT ON CONSTRAINT mission_payments_type_valid ON mission_payments IS 
'Types de paiement valides: deposit (acompte), commission (commission NIOS), installment (échéance), final (solde), monthly (mensuel)';
