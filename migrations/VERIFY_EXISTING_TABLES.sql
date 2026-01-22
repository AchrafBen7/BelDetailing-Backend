-- ============================================================
-- SCRIPT DE VÉRIFICATION DES TABLES EXISTANTES
-- ============================================================
-- Date: 2025-01-15
-- Description: Script pour vérifier quelles tables existent déjà
-- ============================================================
-- Exécuter ce script dans Supabase SQL Editor pour voir quelles tables existent
-- ============================================================

-- Vérifier les tables de Priorité 1 (CRITIQUE)
SELECT 
  'notifications' as table_name,
  CASE WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'notifications') THEN '✅ EXISTS' ELSE '❌ MISSING' END as status
UNION ALL
SELECT 
  'device_tokens',
  CASE WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'device_tokens') THEN '✅ EXISTS' ELSE '❌ MISSING' END
UNION ALL
SELECT 
  'orders',
  CASE WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'orders') THEN '✅ EXISTS' ELSE '❌ MISSING' END
UNION ALL
SELECT 
  'bookings.progress (column)',
  CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'bookings' AND column_name = 'progress'
  ) THEN '✅ EXISTS' ELSE '❌ MISSING' END
UNION ALL
-- Vérifier les tables de Priorité 2 (IMPORTANT)
SELECT 
  'provider_portfolio_photos',
  CASE WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'provider_portfolio_photos') THEN '✅ EXISTS' ELSE '❌ MISSING' END
UNION ALL
SELECT 
  'service_photos',
  CASE WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'service_photos') THEN '✅ EXISTS' ELSE '❌ MISSING' END
UNION ALL
-- Vérifier les tables de Priorité 3 (MOYEN)
SELECT 
  'provider_profile_views',
  CASE WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'provider_profile_views') THEN '✅ EXISTS' ELSE '❌ MISSING' END
UNION ALL
SELECT 
  'provider_favorites',
  CASE WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'provider_favorites') THEN '✅ EXISTS' ELSE '❌ MISSING' END
UNION ALL
SELECT 
  'provider_messages',
  CASE WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'provider_messages') THEN '✅ EXISTS' ELSE '❌ MISSING' END
UNION ALL
SELECT 
  'product_favorites',
  CASE WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'product_favorites') THEN '✅ EXISTS' ELSE '❌ MISSING' END
UNION ALL
SELECT 
  'review_prompts',
  CASE WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'review_prompts') THEN '✅ EXISTS' ELSE '❌ MISSING' END
ORDER BY table_name;

-- ============================================================
-- MIGRATIONS À APPLIQUER (selon les résultats ci-dessus)
-- ============================================================
-- Si une table est ❌ MISSING, appliquer la migration correspondante :
--
-- 1. notifications / device_tokens
--    → Backend/BelDetailing-Backend/migrations/create_notifications_tables.sql
--
-- 2. orders
--    → Backend/BelDetailing-Backend/migrations/create_orders_table.sql
--
-- 3. bookings.progress (column)
--    → Backend/BelDetailing-Backend/migrations/add_booking_progress_column.sql
--
-- 4. provider_portfolio_photos
--    → Backend/BelDetailing-Backend/migrations/create_provider_portfolio_photos_table.sql
--
-- 5. service_photos
--    → Backend/BelDetailing-Backend/migrations/create_service_photos_table.sql
--
-- 6. provider_profile_views, provider_favorites, provider_messages, product_favorites, review_prompts
--    → Vérifier si ces tables existent déjà ou créer les migrations si nécessaire
--    Note: provider_profile_views est créée par add_dopamine_system_fields.sql
--    Note: provider_favorites est créée par add_dopamine_system_fields.sql
--    Note: provider_messages est créée par add_dopamine_system_fields.sql
