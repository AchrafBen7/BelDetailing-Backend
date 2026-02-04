-- Migration: Add opening_hours to provider_profiles if missing.
-- Used by: reservation flow (available slots), Smart Booking, provider dashboard.
-- Format: JSON/JSONB array of { day (1-7), start_time, end_time, is_closed }.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'provider_profiles'
      AND column_name = 'opening_hours'
  ) THEN
    ALTER TABLE provider_profiles
    ADD COLUMN opening_hours TEXT;
    COMMENT ON COLUMN provider_profiles.opening_hours IS 'JSON array: [{ day, start_time, end_time, is_closed }]. day 1=Mon..7=Sun. Used for available slots.';
  END IF;
END $$;
