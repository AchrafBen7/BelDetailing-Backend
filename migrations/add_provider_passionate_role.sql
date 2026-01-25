-- Migration: Add 'provider_passionate' role to users table
-- Date: 2026-01-25
-- Description: Add new role for passionate detailers (no VAT, B2C only, annual revenue limit)

-- 1) Supprimer l'ancienne contrainte si elle existe
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'users_role_check'
  ) THEN
    ALTER TABLE users DROP CONSTRAINT users_role_check;
  END IF;
END $$;

-- 2) Ajouter la nouvelle contrainte avec le rôle provider_passionate
ALTER TABLE users
ADD CONSTRAINT users_role_check
CHECK (role IN ('customer', 'company', 'provider', 'provider_passionate'));

COMMENT ON CONSTRAINT users_role_check ON users IS 'Assure que le rôle est l''un des rôles valides. provider_passionate = detailer sans TVA, B2C uniquement, plafond annuel.';
