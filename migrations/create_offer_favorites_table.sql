-- Migration: Créer la table offer_favorites
-- Description: Permet aux providers et companies de sauvegarder des offres

CREATE TABLE IF NOT EXISTS offer_favorites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    offer_id UUID NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Une offre ne peut être en favori qu'une seule fois par utilisateur
    UNIQUE(offer_id, user_id)
);

-- Index pour améliorer les performances des requêtes
CREATE INDEX IF NOT EXISTS idx_offer_favorites_user_id ON offer_favorites(user_id);
CREATE INDEX IF NOT EXISTS idx_offer_favorites_offer_id ON offer_favorites(offer_id);
CREATE INDEX IF NOT EXISTS idx_offer_favorites_created_at ON offer_favorites(created_at DESC);

-- RLS (Row Level Security) - les utilisateurs ne peuvent voir que leurs propres favoris
ALTER TABLE offer_favorites ENABLE ROW LEVEL SECURITY;

-- Policy pour permettre aux utilisateurs de voir uniquement leurs propres favoris
CREATE POLICY "Users can view their own offer favorites"
    ON offer_favorites FOR SELECT
    USING (auth.uid() = user_id);

-- Policy pour permettre aux utilisateurs d'ajouter leurs propres favoris
CREATE POLICY "Users can insert their own offer favorites"
    ON offer_favorites FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- Policy pour permettre aux utilisateurs de supprimer leurs propres favoris
CREATE POLICY "Users can delete their own offer favorites"
    ON offer_favorites FOR DELETE
    USING (auth.uid() = user_id);
