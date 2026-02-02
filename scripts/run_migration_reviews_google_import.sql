-- Support import des avis Google pour les detailers (ne pas repartir de 0)
-- À exécuter dans Supabase SQL Editor

-- source : 'app' = avis in-app, 'google_import' = importés depuis Google
ALTER TABLE reviews
ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'app';

-- Nom de l'auteur pour les avis importés (quand pas de client lié)
ALTER TABLE reviews
ADD COLUMN IF NOT EXISTS author_name TEXT;

-- Rendre nullable la colonne client si elle existe (noms possibles: customer_id, user_id, etc.)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'reviews' AND column_name = 'customer_id'
  ) THEN
    ALTER TABLE reviews ALTER COLUMN customer_id DROP NOT NULL;
  END IF;
END $$;

COMMENT ON COLUMN reviews.source IS 'app = avis in-app, google_import = import Google';
COMMENT ON COLUMN reviews.author_name IS 'Nom affiché pour avis importés (ex. Google) quand pas de client lié';
