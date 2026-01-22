-- Migration: Create failed_transfers table
-- Description: Table pour tracker les échecs de transfert Stripe vers les detailers
-- Date: 2026-01-21

CREATE TABLE IF NOT EXISTS failed_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_agreement_id UUID NOT NULL REFERENCES mission_agreements(id) ON DELETE CASCADE,
  mission_payment_id UUID NOT NULL REFERENCES mission_payments(id) ON DELETE CASCADE,
  detailer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stripe_connected_account_id VARCHAR(255) NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  commission_rate DECIMAL(5,4) NOT NULL,
  commission_amount DECIMAL(10,2) NOT NULL,
  net_amount DECIMAL(10,2) NOT NULL,
  error_message TEXT,
  error_code VARCHAR(100),
  retry_count INTEGER DEFAULT 0,
  max_retries INTEGER DEFAULT 3,
  last_retry_at TIMESTAMPTZ,
  status VARCHAR(50) NOT NULL DEFAULT 'pending', -- pending, retrying, succeeded, failed_permanently
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index pour les requêtes fréquentes
CREATE INDEX IF NOT EXISTS idx_failed_transfers_status ON failed_transfers(status);
CREATE INDEX IF NOT EXISTS idx_failed_transfers_mission_payment_id ON failed_transfers(mission_payment_id);
CREATE INDEX IF NOT EXISTS idx_failed_transfers_detailer_id ON failed_transfers(detailer_id);
CREATE INDEX IF NOT EXISTS idx_failed_transfers_retry_count ON failed_transfers(retry_count);

-- Index composite pour les requêtes de retry
CREATE INDEX IF NOT EXISTS idx_failed_transfers_pending_retry ON failed_transfers(status, retry_count) 
  WHERE status IN ('pending', 'retrying') AND retry_count < max_retries;

COMMENT ON TABLE failed_transfers IS 'Table pour tracker les échecs de transfert Stripe vers les detailers et permettre les retry automatiques';
COMMENT ON COLUMN failed_transfers.status IS 'pending: en attente de retry, retrying: retry en cours, succeeded: retry réussi, failed_permanently: échec définitif après max_retries';
