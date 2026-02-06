-- Migration : Créer la table media_uploads pour tracker les uploads et vérifier ownership
-- Date : 2026-02-06
-- Objectif : Sécurité - Empêcher suppression de fichiers d'autres users

-- Créer la table media_uploads
CREATE TABLE IF NOT EXISTS media_uploads (
  id TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  public_url TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index pour recherche rapide par user
CREATE INDEX IF NOT EXISTS idx_media_uploads_user_id ON media_uploads(user_id);

-- Index pour recherche rapide par storage_path
CREATE INDEX IF NOT EXISTS idx_media_uploads_storage_path ON media_uploads(storage_path);

-- Commentaire
COMMENT ON TABLE media_uploads IS 'Tracking des uploads média pour vérifier ownership et sécurité';
COMMENT ON COLUMN media_uploads.id IS 'ID nanoid du média (ex: abcd1234)';
COMMENT ON COLUMN media_uploads.user_id IS 'Propriétaire du média';
COMMENT ON COLUMN media_uploads.storage_path IS 'Chemin dans Supabase Storage (ex: user123/abcd1234.jpeg)';
COMMENT ON COLUMN media_uploads.file_name IS 'Nom original du fichier';
COMMENT ON COLUMN media_uploads.mime_type IS 'Type MIME (ex: image/jpeg)';
COMMENT ON COLUMN media_uploads.file_size IS 'Taille du fichier en octets';
COMMENT ON COLUMN media_uploads.public_url IS 'URL publique Supabase';

-- RLS : Activer Row Level Security
ALTER TABLE media_uploads ENABLE ROW LEVEL SECURITY;

-- Politique : Users peuvent voir uniquement leurs propres uploads
CREATE POLICY "Users can view own uploads" ON media_uploads
  FOR SELECT
  USING (auth.uid() = user_id);

-- Politique : Users peuvent créer leurs propres uploads
CREATE POLICY "Users can create own uploads" ON media_uploads
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Politique : Users peuvent supprimer uniquement leurs propres uploads
CREATE POLICY "Users can delete own uploads" ON media_uploads
  FOR DELETE
  USING (auth.uid() = user_id);

-- Note : Pas de UPDATE policy car les uploads sont immutables (create/delete only)
