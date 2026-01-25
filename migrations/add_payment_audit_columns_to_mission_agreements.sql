-- Migration: Add payment audit columns to mission_agreements
-- Purpose: Track payment confirmation, transfers, and cancellation for legal compliance

ALTER TABLE mission_agreements
ADD COLUMN IF NOT EXISTS payment_confirmed_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS payment_status VARCHAR(50) DEFAULT 'pending_confirmation',
ADD COLUMN IF NOT EXISTS scheduled_transfer_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS transfer_executed_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS transfer_id VARCHAR(255),
ADD COLUMN IF NOT EXISTS cancellation_reason TEXT,
ADD COLUMN IF NOT EXISTS cancellation_requested_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS cancellation_requested_by VARCHAR(50), -- 'company' | 'detailer' | 'system'
ADD COLUMN IF NOT EXISTS refund_amount DECIMAL(10,2),
ADD COLUMN IF NOT EXISTS refund_executed_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS refund_id VARCHAR(255);

-- Add check constraint for payment_status
ALTER TABLE mission_agreements
DROP CONSTRAINT IF EXISTS mission_agreements_payment_status_check;

ALTER TABLE mission_agreements
ADD CONSTRAINT mission_agreements_payment_status_check
CHECK (payment_status IN (
  'pending_confirmation',  -- En attente de confirmation par la company
  'processing',            -- Paiement en cours (SEPA async)
  'succeeded',             -- Paiement réussi
  'payment_failed',        -- Paiement échoué
  'canceled',              -- Paiement annulé
  'requires_payment_method' -- Nécessite une nouvelle méthode de paiement
));

-- Add check constraint for cancellation_requested_by
ALTER TABLE mission_agreements
DROP CONSTRAINT IF EXISTS mission_agreements_cancellation_requested_by_check;

ALTER TABLE mission_agreements
ADD CONSTRAINT mission_agreements_cancellation_requested_by_check
CHECK (cancellation_requested_by IS NULL OR cancellation_requested_by IN ('company', 'detailer', 'system'));

-- Create index for payment_status queries
CREATE INDEX IF NOT EXISTS idx_mission_agreements_payment_status
ON mission_agreements(payment_status)
WHERE payment_status IS NOT NULL;

-- Create index for scheduled_transfer_at (for cron jobs)
CREATE INDEX IF NOT EXISTS idx_mission_agreements_scheduled_transfer
ON mission_agreements(scheduled_transfer_at)
WHERE scheduled_transfer_at IS NOT NULL AND transfer_executed_at IS NULL;

COMMENT ON COLUMN mission_agreements.payment_confirmed_at IS 'Timestamp when company confirmed the payment ON-SESSION';
COMMENT ON COLUMN mission_agreements.payment_status IS 'Current payment status (pending_confirmation, processing, succeeded, payment_failed, canceled, requires_payment_method)';
COMMENT ON COLUMN mission_agreements.scheduled_transfer_at IS 'Scheduled date/time for deposit transfer to detailer (J+1)';
COMMENT ON COLUMN mission_agreements.transfer_executed_at IS 'Timestamp when deposit was actually transferred to detailer';
COMMENT ON COLUMN mission_agreements.transfer_id IS 'Stripe Transfer ID for the deposit';
COMMENT ON COLUMN mission_agreements.cancellation_reason IS 'Reason for mission cancellation';
COMMENT ON COLUMN mission_agreements.cancellation_requested_at IS 'Timestamp when cancellation was requested';
COMMENT ON COLUMN mission_agreements.cancellation_requested_by IS 'Who requested the cancellation (company, detailer, system)';
COMMENT ON COLUMN mission_agreements.refund_amount IS 'Amount refunded to company (if applicable)';
COMMENT ON COLUMN mission_agreements.refund_executed_at IS 'Timestamp when refund was executed';
COMMENT ON COLUMN mission_agreements.refund_id IS 'Stripe Refund ID';
