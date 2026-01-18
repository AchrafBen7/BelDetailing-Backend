-- Migration: Ajout des champs pour demande de modification (customer → provider)
-- Date: 2026-01-XX
-- Description: Permet au customer de demander un changement de date/heure, le provider accepte/refuse

-- Ajouter les colonnes pour modification request
ALTER TABLE bookings
ADD COLUMN IF NOT EXISTS modification_request_date DATE DEFAULT NULL,
ADD COLUMN IF NOT EXISTS modification_request_start_time TIME DEFAULT NULL,
ADD COLUMN IF NOT EXISTS modification_request_end_time TIME DEFAULT NULL,
ADD COLUMN IF NOT EXISTS modification_request_message TEXT DEFAULT NULL,
ADD COLUMN IF NOT EXISTS modification_request_status VARCHAR(50) DEFAULT NULL; -- 'pending' | 'accepted' | 'refused'

-- Index pour les requêtes fréquentes
CREATE INDEX IF NOT EXISTS idx_bookings_modification_request_status ON bookings(modification_request_status);

-- Commentaires pour documentation
COMMENT ON COLUMN bookings.modification_request_date IS 'Nouvelle date demandée par le customer';
COMMENT ON COLUMN bookings.modification_request_start_time IS 'Nouvelle heure de début demandée par le customer';
COMMENT ON COLUMN bookings.modification_request_end_time IS 'Nouvelle heure de fin demandée par le customer';
COMMENT ON COLUMN bookings.modification_request_message IS 'Message optionnel du customer expliquant la demande';
COMMENT ON COLUMN bookings.modification_request_status IS 'Statut de la demande: pending, accepted, refused';
