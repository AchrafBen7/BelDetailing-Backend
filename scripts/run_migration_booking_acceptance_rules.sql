-- ============================================================
-- SCRIPT: Booking acceptance rules (délai min, dernière minute, auto-annulation)
-- ============================================================
-- Règles NIOS:
-- - Réservation au minimum 1h avant le début (sinon refus).
-- - 1h–3h = demande "express" (acceptation sous 30 min).
-- - 3h–6h = délai acceptation 2h.
-- - > 6h = délai acceptation 24h.
-- Si le détaileur n'accepte pas avant acceptance_deadline → annulation auto + remboursement.
-- ============================================================

-- Colonne: date/heure limite pour que le détaileur accepte (sinon annulation auto)
ALTER TABLE bookings
ADD COLUMN IF NOT EXISTS acceptance_deadline timestamptz DEFAULT NULL;

COMMENT ON COLUMN bookings.acceptance_deadline IS 'Deadline for provider to accept. After this, booking is auto-declined and payment refunded.';

-- Colonne: demande "dernière minute" (résa entre 1h et 3h avant le début)
ALTER TABLE bookings
ADD COLUMN IF NOT EXISTS is_express_request boolean DEFAULT false;

COMMENT ON COLUMN bookings.is_express_request IS 'True when booking was made 1h–3h before service start (express/last-minute request).';

-- Vérification
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'bookings'
AND column_name IN ('acceptance_deadline', 'is_express_request')
ORDER BY column_name;
