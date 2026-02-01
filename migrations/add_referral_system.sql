-- Système de parrainage NIOS (Phase 1: Customer→Customer, Detailer→Detailer)
-- Récompense = crédits / visibilité, pas de cash direct.
-- Validation: Customer = 1ère résa payée, Detailer = X missions terminées.

-- ============================================================
-- 1) Colonnes sur users
-- ============================================================
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS referral_code VARCHAR(12) UNIQUE,
  ADD COLUMN IF NOT EXISTS referred_by UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_referral_code ON users(referral_code) WHERE referral_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_referred_by ON users(referred_by) WHERE referred_by IS NOT NULL;

COMMENT ON COLUMN users.referral_code IS 'Code unique pour le lien d''invitation (ex: https://nios.app/invite/ABC123)';
COMMENT ON COLUMN users.referred_by IS 'ID du parrain (user qui a partagé le lien utilisé à l''inscription)';

-- ============================================================
-- 2) Table referrals (un enregistrement par filleul)
-- ============================================================
CREATE TABLE IF NOT EXISTS referrals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  referred_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_type VARCHAR(20) NOT NULL, -- 'customer' | 'provider' | 'provider_passionate'
  status VARCHAR(20) NOT NULL DEFAULT 'pending', -- 'pending' | 'validated' | 'rejected'
  validated_at TIMESTAMPTZ,
  reward_type VARCHAR(50), -- 'credit' | 'commission_reduction' | 'visibility'
  reward_value NUMERIC(10,2), -- ex: 10 (€ crédit), 0.5 (% commission)
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(referred_id) -- Un seul parrain par utilisateur
);

CREATE INDEX IF NOT EXISTS idx_referrals_referrer_id ON referrals(referrer_id);
CREATE INDEX IF NOT EXISTS idx_referrals_referred_id ON referrals(referred_id);
CREATE INDEX IF NOT EXISTS idx_referrals_status ON referrals(status);
CREATE INDEX IF NOT EXISTS idx_referrals_created_at ON referrals(created_at DESC);

COMMENT ON TABLE referrals IS 'Parrainages: un enregistrement par filleul, validé après action réelle (1ère résa / X missions)';
COMMENT ON COLUMN referrals.role_type IS 'Rôle du filleul (Phase 1: même rôle que parrain)';
COMMENT ON COLUMN referrals.status IS 'pending = pas encore validé, validated = récompense attribuée';
COMMENT ON COLUMN referrals.reward_type IS 'Type de récompense: credit (customer), commission_reduction ou visibility (provider)';
