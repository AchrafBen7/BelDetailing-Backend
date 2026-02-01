-- Crédits parrainage utilisés sur une réservation (réduction au checkout).
-- Débités du customer à la confirmation ; re-crédités en cas d'annulation/refus/remboursement.

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS credits_used NUMERIC(10,2) DEFAULT 0 NOT NULL;

COMMENT ON COLUMN bookings.credits_used IS 'Montant en € de crédit parrainage appliqué à cette réservation (débité à la confirmation)';
