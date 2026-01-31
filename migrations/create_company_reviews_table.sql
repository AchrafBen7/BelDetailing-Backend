-- Migration: Avis des detailers sur les companies (profil Company – fiabilité)
-- Permet de calculer detailer_rating et detailer_satisfaction_rate pour le profil Company.

CREATE TABLE IF NOT EXISTS company_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  detailer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mission_agreement_id UUID REFERENCES mission_agreements(id) ON DELETE SET NULL,
  rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  comment TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(detailer_id, company_id)
);

CREATE INDEX IF NOT EXISTS idx_company_reviews_company_id ON company_reviews(company_id);
CREATE INDEX IF NOT EXISTS idx_company_reviews_detailer_id ON company_reviews(detailer_id);
CREATE INDEX IF NOT EXISTS idx_company_reviews_mission_agreement_id ON company_reviews(mission_agreement_id);

COMMENT ON TABLE company_reviews IS 'Avis des detailers sur les companies après une mission (note 1–5, optionnellement lié à un mission_agreement)';
COMMENT ON COLUMN company_reviews.rating IS 'Note de 1 à 5';
COMMENT ON COLUMN company_reviews.mission_agreement_id IS 'Mission concernée (optionnel, une review peut être globale par detailer/company)';
