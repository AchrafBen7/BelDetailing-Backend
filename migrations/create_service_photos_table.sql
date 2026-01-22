-- ============================================================
-- MIGRATION: Service Photos Table
-- ============================================================
-- Date: 2025-01-15
-- Description: Création de la table pour les photos des services
-- ============================================================

CREATE TABLE IF NOT EXISTS service_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  provider_id UUID NOT NULL, -- Référence au provider pour les permissions RLS
  image_url TEXT NOT NULL,
  thumbnail_url TEXT, -- URL de la miniature (optionnel)
  caption TEXT, -- Légende de la photo (optionnel)
  display_order INTEGER NOT NULL DEFAULT 0, -- Ordre d'affichage
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_service_photos_service_id ON service_photos(service_id);
CREATE INDEX IF NOT EXISTS idx_service_photos_provider_id ON service_photos(provider_id);
CREATE INDEX IF NOT EXISTS idx_service_photos_display_order ON service_photos(service_id, display_order);

-- RLS Policies
ALTER TABLE service_photos ENABLE ROW LEVEL SECURITY;

-- Tout le monde peut voir les photos des services (public)
CREATE POLICY "Anyone can view service photos"
  ON service_photos FOR SELECT
  USING (true);

-- Seul le provider propriétaire du service peut gérer les photos
CREATE POLICY "Service owners can manage service photos"
  ON service_photos FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM services
      JOIN provider_profiles ON services.provider_id = provider_profiles.user_id
      WHERE services.id = service_photos.service_id
      AND service_photos.provider_id = services.provider_id
      AND provider_profiles.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM services
      JOIN provider_profiles ON services.provider_id = provider_profiles.user_id
      WHERE services.id = service_photos.service_id
      AND service_photos.provider_id = services.provider_id
      AND provider_profiles.user_id = auth.uid()
    )
  );
