-- Migration: Profil Company — identité légale, confiance, fiabilité (NIOS)
-- Ajoute les champs requis pour le profil Company transactionnel (légal, paiement, sérieux).

-- Identité légale & confiance (éditables par la company)
ALTER TABLE company_profiles
ADD COLUMN IF NOT EXISTS commercial_name TEXT,
ADD COLUMN IF NOT EXISTS bce_number TEXT,
ADD COLUMN IF NOT EXISTS country TEXT,
ADD COLUMN IF NOT EXISTS registered_address TEXT,
ADD COLUMN IF NOT EXISTS legal_representative_name TEXT,
ADD COLUMN IF NOT EXISTS languages_spoken TEXT,
ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'EUR',
ADD COLUMN IF NOT EXISTS sector TEXT,
ADD COLUMN IF NOT EXISTS fleet_size TEXT,
ADD COLUMN IF NOT EXISTS main_address TEXT,
ADD COLUMN IF NOT EXISTS mission_zones TEXT,
ADD COLUMN IF NOT EXISTS place_types TEXT,
ADD COLUMN IF NOT EXISTS is_verified BOOLEAN DEFAULT FALSE;

-- Fiabilité / Historique (lecture seule, renseignés côté backend ou calculés)
ALTER TABLE company_profiles
ADD COLUMN IF NOT EXISTS payment_success_rate DECIMAL(5, 4),
ADD COLUMN IF NOT EXISTS late_cancellations_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS open_disputes_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS closed_disputes_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS missions_posted_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS missions_completed_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS detailer_satisfaction_rate DECIMAL(5, 4),
ADD COLUMN IF NOT EXISTS detailer_rating DECIMAL(3, 2);

-- Commentaires
COMMENT ON COLUMN company_profiles.commercial_name IS 'Nom commercial si différent du nom légal';
COMMENT ON COLUMN company_profiles.bce_number IS 'Numéro d''entreprise (BCE)';
COMMENT ON COLUMN company_profiles.registered_address IS 'Adresse du siège social';
COMMENT ON COLUMN company_profiles.legal_representative_name IS 'Nom du représentant légal';
COMMENT ON COLUMN company_profiles.sector IS 'Secteur d''activité: Leasing, Location, Concession auto, Fleet corporate, Livraison';
COMMENT ON COLUMN company_profiles.fleet_size IS 'Taille flotte: 1–10, 10–50, 50–200, 200+';
COMMENT ON COLUMN company_profiles.mission_zones IS 'Zones de mission (ex: Bruxelles-centre, Brabant, Sites multiples)';
COMMENT ON COLUMN company_profiles.place_types IS 'Type de lieux: Parking souterrain, extérieur, Dépôt, Client final';
COMMENT ON COLUMN company_profiles.is_verified IS 'Badge Company vérifiée';
COMMENT ON COLUMN company_profiles.payment_success_rate IS 'Taux de paiement réussi (0–1), calculé côté backend';
COMMENT ON COLUMN company_profiles.detailer_rating IS 'Note moyenne des detailers (1–5), lecture seule';
