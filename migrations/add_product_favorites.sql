-- Migration: Product Favorites System
-- Table pour stocker les favoris produits des utilisateurs

CREATE TABLE IF NOT EXISTS product_favorites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    product_id UUID NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Un utilisateur ne peut pas avoir le même produit en favoris deux fois
    UNIQUE(user_id, product_id)
);

-- Index pour les requêtes fréquentes
CREATE INDEX IF NOT EXISTS idx_product_favorites_user_id ON product_favorites(user_id);
CREATE INDEX IF NOT EXISTS idx_product_favorites_product_id ON product_favorites(product_id);

-- RLS (Row Level Security) - les utilisateurs ne peuvent voir que leurs propres favoris
ALTER TABLE product_favorites ENABLE ROW LEVEL SECURITY;

-- Policy: les utilisateurs peuvent voir leurs propres favoris
CREATE POLICY "Users can view their own favorites"
    ON product_favorites FOR SELECT
    USING (auth.uid() = user_id);

-- Policy: les utilisateurs peuvent ajouter leurs propres favoris
CREATE POLICY "Users can insert their own favorites"
    ON product_favorites FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- Policy: les utilisateurs peuvent supprimer leurs propres favoris
CREATE POLICY "Users can delete their own favorites"
    ON product_favorites FOR DELETE
    USING (auth.uid() = user_id);
