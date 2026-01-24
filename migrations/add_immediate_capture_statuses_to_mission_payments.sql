-- Migration: Add immediate capture statuses and columns to mission_payments
-- Date: 2026-01-24
-- Description: Add "captured_held" and "transferred" statuses, plus columns for transfer tracking

-- 1) Ajouter les nouveaux statuts à la contrainte CHECK (si elle existe)
-- Note: Si la table utilise un ENUM, il faudra modifier le type ENUM
DO $$
BEGIN
  -- Vérifier si la contrainte existe et la modifier
  IF EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'mission_payments_status_check'
  ) THEN
    -- Supprimer l'ancienne contrainte
    ALTER TABLE mission_payments DROP CONSTRAINT mission_payments_status_check;
  END IF;
END $$;

-- 2) Ajouter la nouvelle contrainte avec les statuts étendus
ALTER TABLE mission_payments
ADD CONSTRAINT mission_payments_status_check
CHECK (status IN (
  'pending',
  'authorized',
  'captured',
  'captured_held',  -- ✅ NOUVEAU: Acompte capturé mais en attente de transfert (J+1)
  'transferred',    -- ✅ NOUVEAU: Acompte transféré au detailer
  'failed',
  'refunded',
  'cancelled'
));

-- 3) Ajouter les colonnes pour le tracking des transferts
ALTER TABLE mission_payments
ADD COLUMN IF NOT EXISTS stripe_transfer_id TEXT,
ADD COLUMN IF NOT EXISTS transferred_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS hold_until TIMESTAMPTZ;

-- 4) Ajouter des index pour les requêtes fréquentes
CREATE INDEX IF NOT EXISTS idx_mission_payments_status_captured_held 
ON mission_payments(status) 
WHERE status = 'captured_held';

CREATE INDEX IF NOT EXISTS idx_mission_payments_hold_until 
ON mission_payments(hold_until) 
WHERE hold_until IS NOT NULL;

-- 5) Ajouter un commentaire pour documenter les nouveaux statuts
COMMENT ON COLUMN mission_payments.status IS 'Status du paiement: pending, authorized, captured, captured_held (acompte capturé en attente J+1), transferred (acompte transféré), failed, refunded, cancelled';
COMMENT ON COLUMN mission_payments.stripe_transfer_id IS 'ID du transfert Stripe vers le Connected Account du detailer';
COMMENT ON COLUMN mission_payments.transferred_at IS 'Date/heure du transfert vers le detailer';
COMMENT ON COLUMN mission_payments.hold_until IS 'Date/heure jusqu''à laquelle l''acompte est en "hold" (J+1)';
