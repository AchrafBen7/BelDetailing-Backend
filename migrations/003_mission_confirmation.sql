-- ============================================================
-- Migration 003: Mission Mutual Confirmation System
-- Date: 2026-02-05
-- 
-- Adds:
-- 1. New statuses for mission_agreements (payment_scheduled, awaiting_start, awaiting_end)
-- 2. Confirmation columns (company/detailer start/end timestamps)
-- 3. Suspension columns
-- 4. Fix CHECK constraints for mission_payments
-- ============================================================

-- ============================================================
-- 1. FIX mission_agreements status CHECK
-- The existing CHECK is too restrictive: ('pending','active','completed','cancelled','disputed')
-- The app already uses: draft, waiting_for_detailer_confirmation, agreement_fully_confirmed, etc.
-- ============================================================
ALTER TABLE mission_agreements DROP CONSTRAINT IF EXISTS mission_agreements_status_check;
ALTER TABLE mission_agreements ADD CONSTRAINT mission_agreements_status_check
  CHECK (status IN (
    'pending',
    'draft',
    'waiting_for_detailer_confirmation',
    'agreement_fully_confirmed',
    'payment_scheduled',        -- NEW: payment plan created, waiting for mutual start confirmation
    'awaiting_start',           -- NEW: at least one party confirmed start, waiting for the other
    'active',                   -- Both confirmed start, mission in progress
    'awaiting_end',             -- NEW: at least one party confirmed end, waiting for the other
    'completed',
    'cancelled',
    'suspended',                -- NEW: mission paused (payments on hold)
    'disputed',
    'on_hold'
  ));

-- ============================================================
-- 2. ADD confirmation columns to mission_agreements
-- ============================================================
ALTER TABLE mission_agreements ADD COLUMN IF NOT EXISTS company_confirmed_start_at  TIMESTAMPTZ;
ALTER TABLE mission_agreements ADD COLUMN IF NOT EXISTS detailer_confirmed_start_at TIMESTAMPTZ;
ALTER TABLE mission_agreements ADD COLUMN IF NOT EXISTS company_confirmed_end_at    TIMESTAMPTZ;
ALTER TABLE mission_agreements ADD COLUMN IF NOT EXISTS detailer_confirmed_end_at   TIMESTAMPTZ;

-- ============================================================
-- 3. ADD suspension columns
-- ============================================================
ALTER TABLE mission_agreements ADD COLUMN IF NOT EXISTS suspended_at       TIMESTAMPTZ;
ALTER TABLE mission_agreements ADD COLUMN IF NOT EXISTS resumed_at         TIMESTAMPTZ;
ALTER TABLE mission_agreements ADD COLUMN IF NOT EXISTS suspension_reason  TEXT;
ALTER TABLE mission_agreements ADD COLUMN IF NOT EXISTS suspended_by      TEXT; -- 'company' | 'detailer' | 'system'

-- ============================================================
-- 4. FIX mission_payments type CHECK
-- Current: ('deposit', 'monthly', 'final', 'one_time')
-- Code uses: 'commission', 'installment' too
-- ============================================================
ALTER TABLE mission_payments DROP CONSTRAINT IF EXISTS mission_payments_type_check;
ALTER TABLE mission_payments ADD CONSTRAINT mission_payments_type_check
  CHECK (type IN ('deposit', 'monthly', 'final', 'one_time', 'commission', 'installment'));

-- ============================================================
-- 5. FIX mission_payments status CHECK
-- Current: ('pending','authorized','captured','failed','refunded','cancelled')
-- Code uses: 'processing', 'succeeded', 'captured_held', 'transferred'
-- ============================================================
ALTER TABLE mission_payments DROP CONSTRAINT IF EXISTS mission_payments_status_check;
ALTER TABLE mission_payments ADD CONSTRAINT mission_payments_status_check
  CHECK (status IN (
    'pending',
    'authorized',
    'processing',      -- SEPA async (2-5 days)
    'captured',
    'captured_held',   -- Captured but held (e.g., deposit before J+1)
    'succeeded',
    'transferred',     -- Successfully transferred to detailer
    'failed',
    'refunded',
    'cancelled',
    'on_hold'          -- NEW: suspended mission → payments on hold
  ));

-- ============================================================
-- 6. ADD indexes for new queries
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_mission_agreements_awaiting_start
  ON mission_agreements(status) WHERE status = 'awaiting_start';
CREATE INDEX IF NOT EXISTS idx_mission_agreements_awaiting_end
  ON mission_agreements(status) WHERE status = 'awaiting_end';
CREATE INDEX IF NOT EXISTS idx_mission_agreements_payment_scheduled
  ON mission_agreements(status) WHERE status = 'payment_scheduled';
CREATE INDEX IF NOT EXISTS idx_mission_payments_on_hold
  ON mission_payments(status) WHERE status = 'on_hold';

-- ============================================================
-- 7. Audit log for mission confirmations
-- ============================================================
CREATE TABLE IF NOT EXISTS mission_confirmation_logs (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  mission_agreement_id  UUID NOT NULL REFERENCES mission_agreements(id) ON DELETE CASCADE,
  action                TEXT NOT NULL, -- 'confirm_start', 'confirm_end', 'suspend', 'resume', 'cancel'
  actor_id              UUID NOT NULL REFERENCES users(id),
  actor_role            TEXT NOT NULL, -- 'company', 'detailer', 'system'
  previous_status       TEXT,
  new_status            TEXT,
  metadata              JSONB,        -- Additional context (reason, etc.)
  ip_address            TEXT,
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mission_confirmation_logs_agreement
  ON mission_confirmation_logs(mission_agreement_id);
CREATE INDEX IF NOT EXISTS idx_mission_confirmation_logs_actor
  ON mission_confirmation_logs(actor_id);
