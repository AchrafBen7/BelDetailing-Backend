-- Migration: Ajouter service_area à provider_profiles
-- Date: 2025-01-01
-- Description: Permet de stocker la zone d'intervention des providers (radius, polygon, country)

-- Ajouter colonne service_area (JSONB) pour stocker la zone d'intervention
ALTER TABLE provider_profiles
ADD COLUMN IF NOT EXISTS service_area JSONB;

-- Index pour recherche (optionnel, utile si on veut chercher par zone)
CREATE INDEX IF NOT EXISTS idx_provider_profiles_service_area 
ON provider_profiles USING GIN (service_area);

-- Commentaire pour documentation
COMMENT ON COLUMN provider_profiles.service_area IS 'Zone d''intervention du provider: {type: "radius"|"polygon"|"country", ...}';
