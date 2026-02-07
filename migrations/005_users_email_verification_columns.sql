-- ============================================================
-- Migration 005: Colonnes de vérification email (si absentes)
-- À exécuter si l'erreur "Could not verify email" renvoie
-- un détail du type "column ... does not exist".
-- ============================================================

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT FALSE;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS email_verification_code TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS email_verification_code_expires_at TIMESTAMPTZ;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS email_verification_attempts INTEGER DEFAULT 0;
