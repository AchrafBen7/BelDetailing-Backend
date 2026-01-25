-- Migration: Update messages sender_role check to include provider_passionate
-- Date: 2026-01-25
-- Description: Allow provider_passionate to send messages in chat

-- 1) Supprimer l'ancienne contrainte si elle existe
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'messages_sender_role_check'
  ) THEN
    ALTER TABLE messages DROP CONSTRAINT messages_sender_role_check;
  END IF;
END $$;

-- 2) Ajouter la nouvelle contrainte avec provider_passionate
ALTER TABLE messages
ADD CONSTRAINT messages_sender_role_check
CHECK (sender_role IN ('provider', 'provider_passionate', 'customer', 'company'));

COMMENT ON CONSTRAINT messages_sender_role_check ON messages IS 'Assure que le rôle de l''expéditeur est valide. provider_passionate peut envoyer des messages comme provider.';
