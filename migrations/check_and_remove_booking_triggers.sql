-- ============================================================
-- VÉRIFICATION ET SUPPRESSION DES TRIGGERS DE BOOKING
-- ============================================================
-- Date: 2025-01-23
-- Description: Vérifier et supprimer les triggers qui créent automatiquement
--              des bookings lors de l'acceptation d'une application
-- ============================================================

-- 1. VÉRIFIER LES TRIGGERS EXISTANTS SUR LA TABLE applications
-- Exécuter cette requête pour voir tous les triggers liés aux applications
SELECT 
  trigger_name,
  event_manipulation,
  event_object_table,
  action_statement,
  action_timing
FROM information_schema.triggers
WHERE event_object_table = 'applications'
ORDER BY trigger_name;

-- 2. VÉRIFIER LES TRIGGERS EXISTANTS SUR LA TABLE bookings
-- Exécuter cette requête pour voir tous les triggers liés aux bookings
SELECT 
  trigger_name,
  event_manipulation,
  event_object_table,
  action_statement,
  action_timing
FROM information_schema.triggers
WHERE event_object_table = 'bookings'
ORDER BY trigger_name;

-- 3. VÉRIFIER LES FONCTIONS QUI CRÉENT DES BOOKINGS
-- Exécuter cette requête pour voir toutes les fonctions qui pourraient créer des bookings
SELECT 
  routine_name,
  routine_type,
  routine_definition
FROM information_schema.routines
WHERE routine_definition ILIKE '%INSERT INTO bookings%'
   OR routine_definition ILIKE '%bookings%INSERT%'
   OR routine_definition ILIKE '%application_id%bookings%'
ORDER BY routine_name;

-- 4. VÉRIFIER SI LES COLONNES application_id ET offer_id EXISTENT DANS LA TABLE bookings
SELECT 
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_name = 'bookings'
  AND (column_name = 'application_id' OR column_name = 'offer_id')
ORDER BY column_name;

-- 5. SUPPRIMER LES COLONNES application_id ET offer_id DE LA TABLE bookings (si elles existent)
-- ⚠️ ATTENTION : Cette opération est irréversible
-- ⚠️ Exécuter seulement si les colonnes existent et ne sont plus nécessaires
-- ⚠️ Les missions (offers) ne doivent PAS créer de bookings - elles utilisent Mission Agreement
-- DO NOT RUN IF COLUMNS DO NOT EXIST
-- ALTER TABLE bookings DROP COLUMN IF EXISTS application_id;
-- ALTER TABLE bookings DROP COLUMN IF EXISTS offer_id;

-- 6. SUPPRIMER LES TRIGGERS QUI CRÉENT DES BOOKINGS LORS DE L'ACCEPTATION
-- ⚠️ Remplacez 'trigger_name' par le nom réel du trigger trouvé dans les requêtes ci-dessus
-- DROP TRIGGER IF EXISTS trigger_name ON applications;

-- ============================================================
-- INSTRUCTIONS
-- ============================================================
-- 1. Exécuter les requêtes 1, 2, 3 et 4 pour identifier les triggers/fonctions/colonnes
-- 2. Si un trigger est trouvé qui crée des bookings lors de l'acceptation :
--    - Noter son nom exact
--    - Exécuter la commande DROP TRIGGER correspondante (section 6)
-- 3. Si les colonnes application_id ou offer_id existent dans bookings :
--    - Vérifier qu'elles ne sont plus utilisées
--    - Exécuter la commande ALTER TABLE pour les supprimer (section 5)
--    - OU exécuter la migration remove_application_id_from_bookings.sql
-- 4. Après suppression, tester l'acceptation d'une application pour vérifier
--    que l'erreur "null value in column start_time" ne se produit plus
