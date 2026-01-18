-- Migration: Système Dopamine NIOS - 4 piliers
-- Date: 2026-01-XX
-- Description: Tracking vues, intérêts (favoris), messages encadrés, et analytics pour provider engagement

-- ============================================================
-- 1️⃣ VUES (provider_profiles)
-- ============================================================

-- Ajouter colonnes de vues dans provider_profiles
ALTER TABLE provider_profiles
ADD COLUMN IF NOT EXISTS profile_views_total INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS profile_views_this_week INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS profile_views_last_week INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS profile_views_updated_at TIMESTAMPTZ DEFAULT NOW();

-- Index pour analytics
CREATE INDEX IF NOT EXISTS idx_provider_profiles_views_total ON provider_profiles(profile_views_total DESC);
CREATE INDEX IF NOT EXISTS idx_provider_profiles_views_this_week ON provider_profiles(profile_views_this_week DESC);

-- ============================================================
-- 2️⃣ INTÉRÊTS (table provider_favorites)
-- ============================================================

CREATE TABLE IF NOT EXISTS provider_favorites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id UUID NOT NULL REFERENCES provider_profiles(user_id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(provider_id, customer_id) -- 1 user = 1 vote
);

CREATE INDEX IF NOT EXISTS idx_provider_favorites_provider_id ON provider_favorites(provider_id);
CREATE INDEX IF NOT EXISTS idx_provider_favorites_customer_id ON provider_favorites(customer_id);
CREATE INDEX IF NOT EXISTS idx_provider_favorites_created_at ON provider_favorites(created_at DESC);

-- Commentaires
COMMENT ON TABLE provider_favorites IS 'Intérêts des customers pour les providers (1 user = 1 vote, non public)';
COMMENT ON COLUMN provider_favorites.provider_id IS 'ID du provider (via user_id de provider_profiles)';
COMMENT ON COLUMN provider_favorites.customer_id IS 'ID du customer qui a ajouté en favori';

-- ============================================================
-- 3️⃣ MESSAGES (table provider_messages)
-- ============================================================

CREATE TABLE IF NOT EXISTS provider_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id UUID NOT NULL REFERENCES provider_profiles(user_id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  
  -- Message encadré (formulaire structuré)
  vehicle_type VARCHAR(50), -- Type de véhicule
  address_zone VARCHAR(255), -- Zone (pas adresse exacte)
  preferred_date DATE, -- Date souhaitée
  message_text TEXT, -- Question courte (max 300 caractères)
  
  -- État du message
  status VARCHAR(50) DEFAULT 'pending', -- 'pending' | 'replied' | 'closed' | 'converted_to_booking'
  
  -- Réponse provider (1 seule réponse gratuite)
  provider_reply TEXT,
  provider_replied_at TIMESTAMPTZ,
  
  -- Tracking
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_provider_messages_provider_id ON provider_messages(provider_id);
CREATE INDEX IF NOT EXISTS idx_provider_messages_customer_id ON provider_messages(customer_id);
CREATE INDEX IF NOT EXISTS idx_provider_messages_status ON provider_messages(status);
CREATE INDEX IF NOT EXISTS idx_provider_messages_created_at ON provider_messages(created_at DESC);

-- Commentaires
COMMENT ON TABLE provider_messages IS 'Messages encadrés entre customers et providers (1 message gratuit par customer, puis booking requis)';
COMMENT ON COLUMN provider_messages.vehicle_type IS 'Type de véhicule (pour contexte)';
COMMENT ON COLUMN provider_messages.address_zone IS 'Zone approximative (pas adresse exacte avant booking)';
COMMENT ON COLUMN provider_messages.message_text IS 'Question courte du customer (max 300 caractères)';
COMMENT ON COLUMN provider_messages.status IS 'Statut: pending (pas de réponse), replied (provider a répondu), closed (fermé), converted_to_booking (converti en booking)';

-- ============================================================
-- 4️⃣ TRACKING VUES DÉTAILLÉ (table provider_profile_views - optionnel pour analytics avancés)
-- ============================================================

CREATE TABLE IF NOT EXISTS provider_profile_views (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id UUID NOT NULL REFERENCES provider_profiles(user_id) ON DELETE CASCADE,
  customer_id UUID REFERENCES users(id) ON DELETE SET NULL, -- Peut être anonyme
  view_type VARCHAR(50) DEFAULT 'profile', -- 'profile' | 'card' | 'map'
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_provider_profile_views_provider_id ON provider_profile_views(provider_id);
CREATE INDEX IF NOT EXISTS idx_provider_profile_views_created_at ON provider_profile_views(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_provider_profile_views_customer_id ON provider_profile_views(customer_id) WHERE customer_id IS NOT NULL;

-- Commentaires
COMMENT ON TABLE provider_profile_views IS 'Log détaillé des vues (pour analytics avancés, peut être nettoyé périodiquement)';
COMMENT ON COLUMN provider_profile_views.view_type IS 'Type de vue: profile (ouverture profil), card (clic card), map (apparition carte)';
