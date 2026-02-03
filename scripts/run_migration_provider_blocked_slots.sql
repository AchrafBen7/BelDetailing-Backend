-- Provider blocked slots: manual blocks so no one can book in that slot.
-- provider_id = provider_profiles.user_id (or provider_profiles.id if you use it).
-- slot_date = date (YYYY-MM-DD), start_time / end_time = time (HH:MM) or null for full-day block.

CREATE TABLE IF NOT EXISTS provider_blocked_slots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id TEXT NOT NULL,
  slot_date DATE NOT NULL,
  start_time TIME,
  end_time TIME,
  created_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT chk_times CHECK (
    (start_time IS NULL AND end_time IS NULL) OR
    (start_time IS NOT NULL AND end_time IS NOT NULL AND start_time < end_time)
  )
);

CREATE INDEX IF NOT EXISTS idx_provider_blocked_slots_provider_date
  ON provider_blocked_slots(provider_id, slot_date);

COMMENT ON TABLE provider_blocked_slots IS 'Manual blocks: provider blocks a day or time range; no bookings allowed in that slot.';
