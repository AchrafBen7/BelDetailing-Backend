-- Add Stripe receipt URL to bookings (hosted receipt page)
-- Run in Supabase SQL Editor or via psql

ALTER TABLE bookings
ADD COLUMN IF NOT EXISTS receipt_url TEXT;

COMMENT ON COLUMN bookings.receipt_url IS 'Stripe hosted receipt URL (from Charge.receipt_url) after payment capture.';
