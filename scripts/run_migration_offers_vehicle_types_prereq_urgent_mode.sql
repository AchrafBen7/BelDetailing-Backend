-- Migration: add vehicle_types, prerequisites, is_urgent, intervention_mode to offers
-- Run in Supabase SQL Editor when you want to enable these fields for the offer creation/detail UI.

ALTER TABLE offers
  ADD COLUMN IF NOT EXISTS vehicle_types text[] DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS prerequisites text[] DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS is_urgent boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS intervention_mode text DEFAULT NULL;

-- If you use a view "offers_with_counts", update it to include the new columns, e.g.:
-- DROP VIEW IF EXISTS offers_with_counts;
-- CREATE VIEW offers_with_counts AS
--   SELECT o.*, count(a.id) as applications_count, bool_or(a.status = 'accepted') as has_accepted_application
--   FROM offers o
--   LEFT JOIN applications a ON a.offer_id = o.id
--   GROUP BY o.id;
-- (Adjust according to your actual view definition.)

COMMENT ON COLUMN offers.vehicle_types IS 'e.g. ["berline","suv","utilitaire"]';
COMMENT ON COLUMN offers.prerequisites IS 'e.g. ["Expérience min 2 ans","Équipement pro"]';
COMMENT ON COLUMN offers.intervention_mode IS 'onSite | mobile | hybrid';
