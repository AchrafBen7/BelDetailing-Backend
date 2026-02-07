-- ============================================================
-- Migration 004: Allow 'admin' in users.role check constraint
-- Si ta base a été créée avec une contrainte sans 'admin', cette
-- migration corrige l'erreur "users_role_check".
-- ============================================================

-- Supprimer l'ancienne contrainte (le nom peut varier selon les versions)
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_role_check;

-- Réajouter avec 'admin' inclus
ALTER TABLE public.users ADD CONSTRAINT users_role_check
  CHECK (role IN ('customer', 'provider', 'provider_passionate', 'company', 'admin'));
