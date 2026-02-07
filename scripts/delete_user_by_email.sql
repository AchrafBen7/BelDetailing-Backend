-- ============================================================
-- Script: supprimer un utilisateur et toutes ses données
-- À exécuter dans Supabase SQL Editor (avec droits suffisants).
--
-- Usage: remplace 'iso.achrafbenali@gmail.com' par l'email à supprimer,
--        puis exécute le script.
-- ============================================================

DO $$
DECLARE
  v_user_id     UUID;
  v_email       TEXT := 'iso.achrafbenali@gmail.com';  -- ← Modifier ici
BEGIN
  -- Récupérer l'id du user
  SELECT id INTO v_user_id FROM public.users WHERE email = v_email;
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'User not found for email: %', v_email;
  END IF;

  -- 1. referred_by: libérer les filleuls
  UPDATE public.users SET referred_by = NULL WHERE referred_by = v_user_id;

  -- 2. Orders (customer)
  DELETE FROM public.orders WHERE customer_id = v_user_id;

  -- 3. Payment transactions
  DELETE FROM public.payment_transactions WHERE user_id = v_user_id;

  -- 4. Messages (sender)
  DELETE FROM public.messages WHERE sender_id = v_user_id;

  -- 5. Content reports (reporter ou reported)
  DELETE FROM public.content_reports WHERE reporter_id = v_user_id OR reported_user_id = v_user_id;

  -- 6. Referrals (referrer ou referred)
  DELETE FROM public.referrals WHERE referrer_id = v_user_id OR referred_id = v_user_id;

  -- 7. Review prompts (customer)
  DELETE FROM public.review_prompts WHERE customer_id = v_user_id;

  -- 8. Provider profile views (customer)
  DELETE FROM public.provider_profile_views WHERE customer_id = v_user_id;

  -- 9. Failed transfers (detailer)
  DELETE FROM public.failed_transfers WHERE detailer_id = v_user_id;

  -- 10. Mission confirmation logs (actor)
  DELETE FROM public.mission_confirmation_logs WHERE actor_id = v_user_id;

  -- 11. Company reviews (detailer ou company)
  DELETE FROM public.company_reviews WHERE detailer_id = v_user_id OR company_id = v_user_id;

  -- 12. Mission invoices (pour les accords de ce user)
  DELETE FROM public.mission_invoices
  WHERE mission_agreement_id IN (
    SELECT id FROM public.mission_agreements
    WHERE company_id = v_user_id OR detailer_id = v_user_id
  );

  -- 13. Mission agreements (company ou detailer) → CASCADE vers mission_payments
  DELETE FROM public.mission_agreements WHERE company_id = v_user_id OR detailer_id = v_user_id;

  -- 14. Conversations (customer ou provider via provider_profiles)
  DELETE FROM public.conversations
  WHERE customer_id = v_user_id
     OR provider_id IN (SELECT id FROM public.provider_profiles WHERE user_id = v_user_id);

  -- 15. Bookings (customer ou provider)
  DELETE FROM public.bookings WHERE customer_id = v_user_id;
  DELETE FROM public.bookings
  WHERE provider_id IN (SELECT id FROM public.provider_profiles WHERE user_id = v_user_id);

  -- 16. Reviews (customer_id si la colonne existe ; puis provider côté detailer)
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'reviews' AND column_name = 'customer_id'
  ) THEN
    DELETE FROM public.reviews WHERE customer_id = v_user_id;
  END IF;
  DELETE FROM public.reviews
  WHERE provider_id IN (SELECT id FROM public.provider_profiles WHERE user_id = v_user_id);

  -- 17. Applications (provider = user_id) — après mission_agreements car ils peuvent être référencés
  DELETE FROM public.applications WHERE provider_id = v_user_id;

  -- 18. Offers (created_by) — après applications
  DELETE FROM public.offers WHERE created_by = v_user_id;

  -- 19. User dans public.users (CASCADE vers customer_profiles, company_profiles, provider_profiles,
  --     notifications, push_tokens, product_favorites, blocked_users, offer_favorites, provider_favorites)
  DELETE FROM public.users WHERE id = v_user_id;

  -- 20. Auth user (Supabase) — nécessite les droits sur auth.users
  DELETE FROM auth.users WHERE id = v_user_id;

  RAISE NOTICE 'User % (id: %) supprimé.', v_email, v_user_id;
END $$;
