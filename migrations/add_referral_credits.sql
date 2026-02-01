-- Crédits parrainage (Customer): réduction sur prochaine résa, pas de cash direct.
-- Phase 1: crédit en € attribué au parrain quand le filleul valide (1ère résa payée).

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS customer_credits_eur NUMERIC(10,2) DEFAULT 0 NOT NULL;

COMMENT ON COLUMN users.customer_credits_eur IS 'Crédit parrainage en € (réduction sur prochaine réservation), Phase 1 Customer→Customer';
