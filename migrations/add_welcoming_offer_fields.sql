-- Migration: Offre de bienvenue NIOS
-- Ajoute les champs nécessaires pour gérer l'offre de bienvenue

-- 1) Ajouter is_first_booking dans bookings
ALTER TABLE bookings
ADD COLUMN IF NOT EXISTS is_first_booking BOOLEAN DEFAULT FALSE;

-- 2) Ajouter welcoming_offer_enabled dans provider_profiles
ALTER TABLE provider_profiles
ADD COLUMN IF NOT EXISTS welcoming_offer_enabled BOOLEAN DEFAULT FALSE;

-- 3) Ajouter welcoming_offer_used dans users (tracker si l'utilisateur a déjà utilisé l'offre)
ALTER TABLE users
ADD COLUMN IF NOT EXISTS welcoming_offer_used BOOLEAN DEFAULT FALSE;

-- 3.1) Ajouter dismissed_first_booking_offer dans users (tracker si l'utilisateur a fermé l'offre définitivement)
ALTER TABLE users
ADD COLUMN IF NOT EXISTS dismissed_first_booking_offer BOOLEAN DEFAULT FALSE;

-- 4) Ajouter welcoming_offer_applied et welcoming_offer_amount dans bookings (pour tracking)
ALTER TABLE bookings
ADD COLUMN IF NOT EXISTS welcoming_offer_applied BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS welcoming_offer_amount DECIMAL(10, 2) DEFAULT 0.00;

-- Index pour optimiser les requêtes
CREATE INDEX IF NOT EXISTS idx_bookings_is_first_booking ON bookings(is_first_booking);
CREATE INDEX IF NOT EXISTS idx_bookings_welcoming_offer_applied ON bookings(welcoming_offer_applied);
CREATE INDEX IF NOT EXISTS idx_users_welcoming_offer_used ON users(welcoming_offer_used);
CREATE INDEX IF NOT EXISTS idx_users_dismissed_first_booking_offer ON users(dismissed_first_booking_offer);

-- Commentaires
COMMENT ON COLUMN bookings.is_first_booking IS 'Indique si ce booking est le premier booking confirmé du customer';
COMMENT ON COLUMN provider_profiles.welcoming_offer_enabled IS 'Indique si le provider participe à l''offre de bienvenue NIOS';
COMMENT ON COLUMN users.welcoming_offer_used IS 'Indique si l''utilisateur a déjà utilisé son offre de bienvenue';
COMMENT ON COLUMN users.dismissed_first_booking_offer IS 'Indique si l''utilisateur a fermé la bannière de l''offre de bienvenue sur le Home';
COMMENT ON COLUMN bookings.welcoming_offer_applied IS 'Indique si l''offre de bienvenue a été appliquée à ce booking';
COMMENT ON COLUMN bookings.welcoming_offer_amount IS 'Montant de l''offre de bienvenue appliquée (en €)';
