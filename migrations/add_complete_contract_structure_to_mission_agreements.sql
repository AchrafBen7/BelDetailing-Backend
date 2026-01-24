-- ============================================================
-- MIGRATION : Structure complète du contrat Mission Agreement
-- ============================================================
-- Cette migration ajoute tous les champs nécessaires pour la
-- structure complète du contrat B2B numérique opposable juridiquement
-- ============================================================

-- 1️⃣ MÉTADONNÉES DU CONTRAT (NON MODIFIABLES)
ALTER TABLE mission_agreements
ADD COLUMN IF NOT EXISTS contract_version INTEGER DEFAULT 1,
ADD COLUMN IF NOT EXISTS contract_created_at TIMESTAMPTZ DEFAULT NOW(),
ADD COLUMN IF NOT EXISTS categories JSONB, -- Catégories de l'offre (array)
ADD COLUMN IF NOT EXISTS mission_type VARCHAR(50) DEFAULT 'one-time', -- 'one-time', 'recurring', 'long-term'
ADD COLUMN IF NOT EXISTS country VARCHAR(100) DEFAULT 'Belgium',
ADD COLUMN IF NOT EXISTS currency VARCHAR(10) DEFAULT 'eur',
ADD COLUMN IF NOT EXISTS commission_rate DECIMAL(5,4) DEFAULT 0.07; -- 7% par défaut

-- 2️⃣ PARTIES AU CONTRAT (OBLIGATOIRE)
-- Company
ALTER TABLE mission_agreements
ADD COLUMN IF NOT EXISTS company_legal_name VARCHAR(255),
ADD COLUMN IF NOT EXISTS company_vat_number VARCHAR(50),
ADD COLUMN IF NOT EXISTS company_legal_address TEXT,
ADD COLUMN IF NOT EXISTS company_legal_representative VARCHAR(255),
ADD COLUMN IF NOT EXISTS company_email VARCHAR(255);

-- Detailer
ALTER TABLE mission_agreements
ADD COLUMN IF NOT EXISTS detailer_legal_name VARCHAR(255),
ADD COLUMN IF NOT EXISTS detailer_vat_number VARCHAR(50),
ADD COLUMN IF NOT EXISTS detailer_address TEXT,
ADD COLUMN IF NOT EXISTS detailer_iban VARCHAR(50), -- Pour payout
ADD COLUMN IF NOT EXISTS detailer_email VARCHAR(255);

-- 3️⃣ OBJET DE LA MISSION
ALTER TABLE mission_agreements
ADD COLUMN IF NOT EXISTS exact_address TEXT, -- Adresse exacte d'intervention (modifiable par company)
ADD COLUMN IF NOT EXISTS specific_constraints TEXT, -- Contraintes spécifiques
ADD COLUMN IF NOT EXISTS required_products JSONB; -- Produits/matériel requis (optionnel)

-- 4️⃣ PARAMÈTRES MODIFIABLES PAR LA COMPANY
ALTER TABLE mission_agreements
ADD COLUMN IF NOT EXISTS invoice_required BOOLEAN DEFAULT true, -- Facturation requise (oui/non)
ADD COLUMN IF NOT EXISTS payment_type VARCHAR(50) DEFAULT 'fractionated'; -- 'fractionated' (obligatoire)

-- 5️⃣ ACCEPTATION DU CONTRAT
ALTER TABLE mission_agreements
ADD COLUMN IF NOT EXISTS company_accepted_at TIMESTAMPTZ, -- Horodatage acceptation company
ADD COLUMN IF NOT EXISTS detailer_accepted_at TIMESTAMPTZ, -- Horodatage acceptation detailer
ADD COLUMN IF NOT EXISTS contract_version_at_acceptance INTEGER; -- Version du contrat au moment de l'acceptation

-- 6️⃣ COMMENTAIRES POUR DOCUMENTATION
COMMENT ON COLUMN mission_agreements.contract_version IS 'Version du contrat (incrémentée à chaque modification majeure)';
COMMENT ON COLUMN mission_agreements.contract_created_at IS 'Horodatage de création du contrat';
COMMENT ON COLUMN mission_agreements.categories IS 'Catégories de l''offre (array JSON)';
COMMENT ON COLUMN mission_agreements.mission_type IS 'Type de mission: one-time, recurring, long-term';
COMMENT ON COLUMN mission_agreements.country IS 'Pays / juridiction (Belgique par défaut)';
COMMENT ON COLUMN mission_agreements.currency IS 'Devise du contrat (eur par défaut)';
COMMENT ON COLUMN mission_agreements.commission_rate IS 'Taux de commission NIOS (7% = 0.07 par défaut)';
COMMENT ON COLUMN mission_agreements.company_legal_name IS 'Nom légal de la company (non modifiable après création)';
COMMENT ON COLUMN mission_agreements.company_vat_number IS 'Numéro de TVA de la company (non modifiable après création)';
COMMENT ON COLUMN mission_agreements.company_legal_address IS 'Adresse légale de la company (non modifiable après création)';
COMMENT ON COLUMN mission_agreements.company_legal_representative IS 'Représentant légal de la company (non modifiable après création)';
COMMENT ON COLUMN mission_agreements.company_email IS 'Email professionnel de la company (non modifiable après création)';
COMMENT ON COLUMN mission_agreements.detailer_legal_name IS 'Nom légal / entreprise du detailer (non modifiable après création)';
COMMENT ON COLUMN mission_agreements.detailer_vat_number IS 'Numéro de TVA du detailer (ou statut) (non modifiable après création)';
COMMENT ON COLUMN mission_agreements.detailer_address IS 'Adresse du detailer (non modifiable après création)';
COMMENT ON COLUMN mission_agreements.detailer_iban IS 'IBAN du detailer pour payout (non modifiable après création)';
COMMENT ON COLUMN mission_agreements.detailer_email IS 'Email du detailer (non modifiable après création)';
COMMENT ON COLUMN mission_agreements.exact_address IS 'Adresse exacte d''intervention (modifiable par company avant acceptation)';
COMMENT ON COLUMN mission_agreements.specific_constraints IS 'Contraintes spécifiques de la mission';
COMMENT ON COLUMN mission_agreements.required_products IS 'Produits / matériel requis (JSON array)';
COMMENT ON COLUMN mission_agreements.invoice_required IS 'Facturation requise (oui/non)';
COMMENT ON COLUMN mission_agreements.payment_type IS 'Type de paiement (fractionated = obligatoire)';
COMMENT ON COLUMN mission_agreements.company_accepted_at IS 'Horodatage de l''acceptation du contrat par la company';
COMMENT ON COLUMN mission_agreements.detailer_accepted_at IS 'Horodatage de l''acceptation du contrat par le detailer';
COMMENT ON COLUMN mission_agreements.contract_version_at_acceptance IS 'Version du contrat au moment de l''acceptation (pour traçabilité juridique)';

-- 7️⃣ INDEX POUR PERFORMANCE
CREATE INDEX IF NOT EXISTS idx_mission_agreements_contract_version ON mission_agreements(contract_version);
CREATE INDEX IF NOT EXISTS idx_mission_agreements_company_accepted_at ON mission_agreements(company_accepted_at);
CREATE INDEX IF NOT EXISTS idx_mission_agreements_detailer_accepted_at ON mission_agreements(detailer_accepted_at);

-- 8️⃣ VÉRIFICATION
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'mission_agreements' 
    AND column_name = 'contract_version'
  ) THEN
    RAISE NOTICE '✅ Migration réussie : Structure complète du contrat ajoutée à mission_agreements';
  ELSE
    RAISE EXCEPTION '❌ Migration échouée : Colonnes non créées';
  END IF;
END $$;
