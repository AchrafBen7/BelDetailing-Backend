-- Script pour exécuter la migration fix_messages_sender_role_check.sql
-- 
-- INSTRUCTIONS :
-- 1. Connectez-vous à votre base de données Supabase
-- 2. Allez dans SQL Editor
-- 3. Copiez-collez ce script
-- 4. Exécutez-le

-- Migration pour corriger la contrainte CHECK sur sender_role dans la table messages
-- La contrainte doit accepter 'provider', 'customer', et 'company'

-- 1) Supprimer l'ancienne contrainte si elle existe

