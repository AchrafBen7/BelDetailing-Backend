-- Migration: Make start_time and end_time nullable in bookings table
-- Reason: For missions (offers), dates and times are managed in Mission Agreement, not in bookings
-- Date: 2026-01-23

-- Make start_time nullable
ALTER TABLE bookings
ALTER COLUMN start_time DROP NOT NULL;

-- Make end_time nullable
ALTER TABLE bookings
ALTER COLUMN end_time DROP NOT NULL;

-- Add comment to document the change
COMMENT ON COLUMN bookings.start_time IS 'Nullable for missions (offers). Times are managed in Mission Agreement.';
COMMENT ON COLUMN bookings.end_time IS 'Nullable for missions (offers). Times are managed in Mission Agreement.';
