-- =====================================================
-- Tables pour conformité Apple Guidelines
-- =====================================================
-- À exécuter dans Supabase SQL Editor

-- =====================================================
-- Table: content_reports
-- Signalements de contenu
-- =====================================================
CREATE TABLE IF NOT EXISTS content_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reported_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  content_type TEXT NOT NULL CHECK (content_type IN ('review', 'message', 'profile', 'offer', 'application')),
  content_id UUID NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('inappropriate', 'harassment', 'spam', 'false_info', 'other')),
  description TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'reviewed', 'actioned', 'dismissed')),
  reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  action_taken TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Un user ne peut signaler qu'une fois le même contenu
  UNIQUE(reporter_id, content_id)
);

-- Index pour performance
CREATE INDEX IF NOT EXISTS idx_content_reports_status ON content_reports(status);
CREATE INDEX IF NOT EXISTS idx_content_reports_reporter ON content_reports(reporter_id);
CREATE INDEX IF NOT EXISTS idx_content_reports_reported_user ON content_reports(reported_user_id);
CREATE INDEX IF NOT EXISTS idx_content_reports_created_at ON content_reports(created_at DESC);

-- Commentaires
COMMENT ON TABLE content_reports IS 'Signalements de contenu inapproprié par les utilisateurs (Apple Guideline 1.2)';
COMMENT ON COLUMN content_reports.content_type IS 'Type de contenu signalé: review, message, profile, offer, application';
COMMENT ON COLUMN content_reports.reason IS 'Raison du signalement: inappropriate, harassment, spam, false_info, other';
COMMENT ON COLUMN content_reports.status IS 'Statut du signalement: pending, reviewed, actioned, dismissed';

-- =====================================================
-- Table: blocked_users
-- Blocage d'utilisateurs
-- =====================================================
CREATE TABLE IF NOT EXISTS blocked_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  blocker_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Contraintes
  UNIQUE(blocker_id, blocked_id),
  CHECK(blocker_id != blocked_id) -- On ne peut pas se bloquer soi-même
);

-- Index pour performance
CREATE INDEX IF NOT EXISTS idx_blocked_users_blocker ON blocked_users(blocker_id);
CREATE INDEX IF NOT EXISTS idx_blocked_users_blocked ON blocked_users(blocked_id);
CREATE INDEX IF NOT EXISTS idx_blocked_users_created_at ON blocked_users(created_at DESC);

-- Commentaires
COMMENT ON TABLE blocked_users IS 'Liste des utilisateurs bloqués (Apple Guideline 1.2)';
COMMENT ON COLUMN blocked_users.blocker_id IS 'Utilisateur qui bloque';
COMMENT ON COLUMN blocked_users.blocked_id IS 'Utilisateur bloqué';
COMMENT ON COLUMN blocked_users.reason IS 'Raison du blocage (optionnel)';

-- =====================================================
-- RLS (Row Level Security) Policies
-- =====================================================

-- Enable RLS
ALTER TABLE content_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE blocked_users ENABLE ROW LEVEL SECURITY;

-- content_reports: Les users peuvent voir leurs propres signalements
CREATE POLICY "Users can view their own reports"
  ON content_reports
  FOR SELECT
  USING (auth.uid() = reporter_id);

-- content_reports: Les users peuvent créer des signalements
CREATE POLICY "Users can create reports"
  ON content_reports
  FOR INSERT
  WITH CHECK (auth.uid() = reporter_id);

-- blocked_users: Les users peuvent voir qui ils ont bloqué
CREATE POLICY "Users can view their blocked users"
  ON blocked_users
  FOR SELECT
  USING (auth.uid() = blocker_id);

-- blocked_users: Les users peuvent bloquer d'autres users
CREATE POLICY "Users can block other users"
  ON blocked_users
  FOR INSERT
  WITH CHECK (auth.uid() = blocker_id AND blocker_id != blocked_id);

-- blocked_users: Les users peuvent débloquer
CREATE POLICY "Users can unblock users"
  ON blocked_users
  FOR DELETE
  USING (auth.uid() = blocker_id);

-- =====================================================
-- Fonctions utilitaires (optionnel)
-- =====================================================

-- Fonction pour nettoyer les anciens signalements (après 1 an)
CREATE OR REPLACE FUNCTION cleanup_old_reports()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM content_reports
  WHERE created_at < NOW() - INTERVAL '1 year'
  AND status IN ('dismissed', 'actioned');
END;
$$;

COMMENT ON FUNCTION cleanup_old_reports IS 'Nettoie les signalements de plus d''un an déjà traités';

-- =====================================================
-- Vérification finale
-- =====================================================

-- Vérifier que les tables sont créées
SELECT 
  table_name,
  (SELECT count(*) FROM information_schema.columns WHERE table_name = t.table_name) as column_count
FROM information_schema.tables t
WHERE table_schema = 'public'
AND table_name IN ('content_reports', 'blocked_users');
