-- Migration : Créer la table cron_locks pour éviter double exécution en multi-instances
-- Date : 2026-02-06
-- Objectif : Sécurité - Empêcher double capture de paiements B2B en production

-- Créer la table cron_locks
CREATE TABLE IF NOT EXISTS cron_locks (
  job_name TEXT PRIMARY KEY,
  locked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_by TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);

-- Index pour nettoyage automatique des locks expirés
CREATE INDEX IF NOT EXISTS idx_cron_locks_expires_at ON cron_locks(expires_at);

-- Commentaire
COMMENT ON TABLE cron_locks IS 'Verrous pour éviter double exécution des crons en multi-instances (leader election)';
COMMENT ON COLUMN cron_locks.job_name IS 'Nom du job (ex: capture-mission-payments)';
COMMENT ON COLUMN cron_locks.locked_at IS 'Timestamp du verrouillage';
COMMENT ON COLUMN cron_locks.locked_by IS 'Identifiant de l''instance qui a le verrou (ex: dyno.123 ou hostname)';
COMMENT ON COLUMN cron_locks.expires_at IS 'Expiration du verrou (auto-release si instance crash)';

-- Fonction helper : Acquérir un verrou (atomique)
-- Retourne true si succès, false si déjà verrouillé
CREATE OR REPLACE FUNCTION acquire_cron_lock(
  p_job_name TEXT,
  p_locked_by TEXT,
  p_ttl_seconds INTEGER DEFAULT 300
) RETURNS BOOLEAN AS $$
DECLARE
  v_acquired BOOLEAN;
BEGIN
  -- Nettoyer les locks expirés (auto-release)
  DELETE FROM cron_locks
  WHERE expires_at < NOW();
  
  -- Essayer d'acquérir le verrou (INSERT atomique)
  INSERT INTO cron_locks (job_name, locked_by, expires_at)
  VALUES (p_job_name, p_locked_by, NOW() + (p_ttl_seconds || ' seconds')::INTERVAL)
  ON CONFLICT (job_name) DO NOTHING
  RETURNING true INTO v_acquired;
  
  -- Si v_acquired est NULL, c'est qu'un autre a le verrou
  RETURN COALESCE(v_acquired, false);
END;
$$ LANGUAGE plpgsql;

-- Fonction helper : Libérer un verrou
CREATE OR REPLACE FUNCTION release_cron_lock(
  p_job_name TEXT,
  p_locked_by TEXT
) RETURNS BOOLEAN AS $$
DECLARE
  v_released BOOLEAN;
BEGIN
  -- Supprimer seulement si on est le propriétaire
  DELETE FROM cron_locks
  WHERE job_name = p_job_name
    AND locked_by = p_locked_by
  RETURNING true INTO v_released;
  
  RETURN COALESCE(v_released, false);
END;
$$ LANGUAGE plpgsql;

-- Fonction helper : Vérifier si un verrou existe
CREATE OR REPLACE FUNCTION is_cron_locked(p_job_name TEXT) RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM cron_locks
    WHERE job_name = p_job_name
      AND expires_at > NOW()
  );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION acquire_cron_lock IS 'Acquérir un verrou de cron (leader election). Retourne true si succès, false si déjà verrouillé.';
COMMENT ON FUNCTION release_cron_lock IS 'Libérer un verrou de cron. Retourne true si succès.';
COMMENT ON FUNCTION is_cron_locked IS 'Vérifier si un job est actuellement verrouillé.';
