-- Migration : Ajouter retry_count pour les paiements SEPA échoués
-- Date : 2026-02-05
-- Description : Ajoute une colonne retry_count pour tracker les tentatives de retry automatique

-- 1) Ajouter la colonne retry_count (default 0)
ALTER TABLE mission_payments
ADD COLUMN IF NOT EXISTS retry_count INTEGER DEFAULT 0 NOT NULL;

-- 2) Créer un index pour optimiser les requêtes du cron job
CREATE INDEX IF NOT EXISTS idx_mission_payments_failed_retry 
ON mission_payments (status, retry_count) 
WHERE status = 'failed' AND retry_count < 3;

-- 3) Commentaire pour documentation
COMMENT ON COLUMN mission_payments.retry_count IS 'Nombre de tentatives de retry automatique (max 3)';

-- Rollback (si nécessaire) :
-- ALTER TABLE mission_payments DROP COLUMN IF EXISTS retry_count;
-- DROP INDEX IF EXISTS idx_mission_payments_failed_retry;
