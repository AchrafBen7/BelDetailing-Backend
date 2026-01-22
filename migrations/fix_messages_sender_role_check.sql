-- Migration pour corriger la contrainte CHECK sur sender_role dans la table messages
-- La contrainte doit accepter 'provider', 'customer', et 'company'

-- 1) Supprimer l'ancienne contrainte si elle existe
ALTER TABLE messages 
DROP CONSTRAINT IF EXISTS messages_sender_role_check;

-- 2) Créer la nouvelle contrainte qui accepte provider, customer, et company
ALTER TABLE messages 
ADD CONSTRAINT messages_sender_role_check 
CHECK (sender_role IN ('provider', 'customer', 'company'));

-- 3) Vérifier que la contrainte est bien appliquée
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM pg_constraint 
        WHERE conname = 'messages_sender_role_check'
        AND contype = 'c'
    ) THEN
        RAISE EXCEPTION 'La contrainte messages_sender_role_check n''a pas été créée correctement';
    END IF;
END $$;
