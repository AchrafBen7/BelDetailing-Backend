-- Migration: transfert au détaileur 3h après l'heure de résa
-- - stripe_charge_id: charge Stripe après capture (pour créer le Transfer plus tard)
-- - provider_transfer_id: Stripe Transfer id une fois le versement effectué

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS stripe_charge_id text,
  ADD COLUMN IF NOT EXISTS provider_transfer_id text;

COMMENT ON COLUMN bookings.stripe_charge_id IS 'Charge Stripe après capture; utilisé pour Transfer au détaileur 3h après résa';
COMMENT ON COLUMN bookings.provider_transfer_id IS 'Stripe Transfer id une fois le détaileur payé (3h après date+heure résa)';
