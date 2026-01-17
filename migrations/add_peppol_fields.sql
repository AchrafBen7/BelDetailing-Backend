-- Migration: Ajout des champs Peppol dans la table bookings
-- Date: 2025-01-XX
-- Description: Permet aux clients PME de recevoir des factures Peppol conformes

-- Ajouter les colonnes Peppol
ALTER TABLE bookings
ADD COLUMN IF NOT EXISTS peppol_requested BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS peppol_status VARCHAR(50) DEFAULT NULL, -- 'pending' | 'sent' | 'failed'
ADD COLUMN IF NOT EXISTS company_name VARCHAR(255) DEFAULT NULL,
ADD COLUMN IF NOT EXISTS company_vat VARCHAR(50) DEFAULT NULL,
ADD COLUMN IF NOT EXISTS company_address TEXT DEFAULT NULL,
ADD COLUMN IF NOT EXISTS company_peppol_id VARCHAR(255) DEFAULT NULL,
ADD COLUMN IF NOT EXISTS peppol_invoice_id VARCHAR(255) DEFAULT NULL, -- ID de la facture Billit
ADD COLUMN IF NOT EXISTS peppol_sent_at TIMESTAMP DEFAULT NULL;

-- Index pour les requêtes fréquentes
CREATE INDEX IF NOT EXISTS idx_bookings_peppol_status ON bookings(peppol_status);
CREATE INDEX IF NOT EXISTS idx_bookings_peppol_requested ON bookings(peppol_requested);

-- Commentaires pour documentation
COMMENT ON COLUMN bookings.peppol_requested IS 'Le client a demandé une facture Peppol pour ce booking';
COMMENT ON COLUMN bookings.peppol_status IS 'Statut de lenvoi Peppol: pending, sent, failed';
COMMENT ON COLUMN bookings.company_name IS 'Nom de lentreprise cliente (pour facture)';
COMMENT ON COLUMN bookings.company_vat IS 'Numéro TVA de lentreprise cliente (validé VIES)';
COMMENT ON COLUMN bookings.company_address IS 'Adresse complète de lentreprise cliente';
COMMENT ON COLUMN bookings.company_peppol_id IS 'Peppol ID de lentreprise cliente (si disponible)';
COMMENT ON COLUMN bookings.peppol_invoice_id IS 'ID de la facture créée dans Billit';
COMMENT ON COLUMN bookings.peppol_sent_at IS 'Date et heure denvoi de la facture Peppol';
