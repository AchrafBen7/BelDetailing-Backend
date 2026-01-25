-- Migration: Add annual revenue tracking to provider_profiles
-- Date: 2026-01-25
-- Description: Track annual revenue for provider_passionate to enforce 2000€ limit

-- 1) Ajouter les colonnes pour le tracking du revenu annuel
ALTER TABLE provider_profiles
ADD COLUMN IF NOT EXISTS annual_revenue_limit DECIMAL(10,2) DEFAULT 2000.00,
ADD COLUMN IF NOT EXISTS annual_revenue_current DECIMAL(10,2) DEFAULT 0.00,
ADD COLUMN IF NOT EXISTS annual_revenue_year INTEGER DEFAULT EXTRACT(YEAR FROM NOW());

-- 2) Index pour les requêtes de plafond
CREATE INDEX IF NOT EXISTS idx_provider_profiles_annual_revenue
ON provider_profiles(annual_revenue_year, annual_revenue_current)
WHERE annual_revenue_limit IS NOT NULL;

-- 3) Commentaires pour documentation
COMMENT ON COLUMN provider_profiles.annual_revenue_limit IS 'Plafond annuel de revenu pour provider_passionate (2000€ par défaut). NULL pour les providers pro.';
COMMENT ON COLUMN provider_profiles.annual_revenue_current IS 'Revenu actuel de l''année en cours pour provider_passionate. Réinitialisé au 1er janvier.';
COMMENT ON COLUMN provider_profiles.annual_revenue_year IS 'Année de référence pour le tracking du revenu (EXTRACT(YEAR FROM NOW())).';
