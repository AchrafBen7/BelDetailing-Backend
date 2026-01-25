-- Migration: Add 'processing' and 'succeeded' statuses to mission_payments for SEPA async flow
-- Date: 2026-01-25
-- Description: SEPA Direct Debit is asynchronous, so we need 'processing' (payment sent to bank) and 'succeeded' (money received) statuses

DO $$
BEGIN
  -- Supprimer l'ancienne contrainte si elle existe
  IF EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'mission_payments_status_check'
  ) THEN
    ALTER TABLE mission_payments DROP CONSTRAINT mission_payments_status_check;
  END IF;
END $$;

-- Ajouter la nouvelle contrainte avec les statuts SEPA asynchrones
ALTER TABLE mission_payments
ADD CONSTRAINT mission_payments_status_check
CHECK (status IN (
  'pending',
  'authorized',
  'processing',    -- ✅ SEPA : Prélèvement envoyé à la banque (en attente de confirmation)
  'succeeded',     -- ✅ SEPA : Argent réellement reçu (2-5 jours après processing)
  'captured',      -- ✅ Carte bancaire : Paiement capturé immédiatement
  'captured_held', -- ✅ Acompte capturé mais en attente de transfert (J+1)
  'transferred',   -- ✅ Acompte transféré au detailer
  'failed',
  'refunded',
  'cancelled'
));

COMMENT ON CONSTRAINT mission_payments_status_check ON mission_payments IS 'Assure que le statut est l''un des statuts valides. SEPA: processing (prélèvement envoyé) → succeeded (argent reçu). Carte: captured (immédiat).';

COMMENT ON COLUMN mission_payments.status IS 'Status du paiement: pending, authorized, processing (SEPA: prélèvement envoyé), succeeded (SEPA: argent reçu), captured (carte: immédiat), captured_held (acompte en attente J+1), transferred (acompte transféré), failed, refunded, cancelled';
