-- Migration: has_garage (provider) + service_at_provider (booking)
-- 1) Provider peut proposer: garage uniquement, mobile uniquement, ou les deux
-- 2) Booking enregistre si la prestation a lieu chez le détaileur (garage) ou chez le client (mobile)

-- provider_profiles: "J'ai un garage/atelier"
ALTER TABLE provider_profiles
ADD COLUMN IF NOT EXISTS has_garage boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN provider_profiles.has_garage IS 'Provider has a fixed workshop/garage. If true + has_mobile_service => customer can choose garage or mobile.';

-- bookings: prestation au garage du détaileur (true) ou à l''adresse du client (false)
ALTER TABLE bookings
ADD COLUMN IF NOT EXISTS service_at_provider boolean DEFAULT null;

COMMENT ON COLUMN bookings.service_at_provider IS 'true = at provider garage, false = at customer (mobile). null = legacy.';
