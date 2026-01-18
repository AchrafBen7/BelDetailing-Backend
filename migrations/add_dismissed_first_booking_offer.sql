-- Migration rapide : Ajouter dismissed_first_booking_offer dans users
-- Pour corriger l'erreur 500 sur GET /api/v1/profile

-- Ajouter dismissed_first_booking_offer dans users
ALTER TABLE users
ADD COLUMN IF NOT EXISTS dismissed_first_booking_offer BOOLEAN DEFAULT FALSE;

-- Index pour optimiser les requêtes
CREATE INDEX IF NOT EXISTS idx_users_dismissed_first_booking_offer ON users(dismissed_first_booking_offer);

-- Commentaire
COMMENT ON COLUMN users.dismissed_first_booking_offer IS 'Indique si l''utilisateur a fermé la bannière de l''offre de bienvenue sur le Home';
