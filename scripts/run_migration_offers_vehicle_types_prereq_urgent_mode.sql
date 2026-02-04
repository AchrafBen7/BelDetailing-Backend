-- Migration: add vehicle_types, prerequisites, is_urgent, intervention_mode, start_date, end_date to offers
-- Run in Supabase SQL Editor when you want to enable these fields for the offer creation/detail UI.

ALTER TABLE offers
  ADD COLUMN IF NOT EXISTS vehicle_types text[] DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS prerequisites text[] DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS is_urgent boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS intervention_mode text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS start_date timestamptz DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS end_date timestamptz DEFAULT NULL;

-- Recreate view so it exposes all offer columns (including vehicle_types, prerequisites, etc.)
DROP VIEW IF EXISTS offers_with_counts;
CREATE VIEW offers_with_counts AS
  SELECT
    o.*,
    count(a.id)::int AS applications_count,
    bool_or(a.status = 'accepted') AS has_accepted_application
  FROM offers o
  LEFT JOIN applications a ON a.offer_id = o.id
  GROUP BY o.id;

COMMENT ON COLUMN offers.vehicle_types IS 'e.g. ["berline","suv","utilitaire"]';
COMMENT ON COLUMN offers.prerequisites IS 'e.g. ["Expérience min 2 ans","Équipement pro"]';
COMMENT ON COLUMN offers.intervention_mode IS 'onSite | mobile | hybrid';
COMMENT ON COLUMN offers.start_date IS 'Date de début de la mission (optionnel)';
COMMENT ON COLUMN offers.end_date IS 'Date de fin / deadline candidatures (optionnel)';
