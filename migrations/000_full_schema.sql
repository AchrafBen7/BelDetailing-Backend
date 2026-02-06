
-- ============================================================
-- BelDetailing — Full Database Schema
-- Generated from backend service code analysis
-- 37 tables + 1 view + RPC functions + RLS policies + indexes
-- ============================================================

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- 1. USERS (core)
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
  id                              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email                           TEXT UNIQUE NOT NULL,
  phone                           TEXT DEFAULT '',
  role                            TEXT NOT NULL DEFAULT 'customer'
                                    CHECK (role IN ('customer', 'provider', 'provider_passionate', 'company', 'admin')),
  vat_number                      TEXT,
  is_vat_valid                    BOOLEAN,
  stripe_customer_id              TEXT,
  referral_code                   TEXT UNIQUE,
  referred_by                     UUID REFERENCES users(id),
  customer_credits_eur            NUMERIC DEFAULT 0,
  welcoming_offer_used            BOOLEAN DEFAULT FALSE,
  dismissed_first_booking_offer   BOOLEAN DEFAULT FALSE,
  email_verified                  BOOLEAN DEFAULT FALSE,
  email_verification_code         TEXT,
  email_verification_code_expires_at TIMESTAMPTZ,
  email_verification_attempts     INTEGER DEFAULT 0,
  created_at                      TIMESTAMPTZ DEFAULT NOW(),
  updated_at                      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_referral_code ON users(referral_code);

-- ============================================================
-- 2. CUSTOMER PROFILES
-- ============================================================
CREATE TABLE IF NOT EXISTS customer_profiles (
  user_id             UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  first_name          TEXT DEFAULT '',
  last_name           TEXT DEFAULT '',
  default_address     TEXT DEFAULT '',
  preferred_city_id   UUID
);

-- ============================================================
-- 3. COMPANY PROFILES
-- ============================================================
CREATE TABLE IF NOT EXISTS company_profiles (
  user_id             UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  legal_name          TEXT NOT NULL DEFAULT '',
  company_type_id     TEXT DEFAULT 'default',
  city                TEXT DEFAULT '',
  postal_code         TEXT DEFAULT '',
  contact_name        TEXT DEFAULT '',
  logo_url            TEXT
);

-- ============================================================
-- 4. PROVIDER PROFILES
-- ============================================================
CREATE TABLE IF NOT EXISTS provider_profiles (
  id                          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id                     UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  display_name                TEXT DEFAULT '',
  company_name                TEXT,
  bio                         TEXT DEFAULT '',
  base_city                   TEXT DEFAULT '',
  postal_code                 TEXT DEFAULT '',
  lat                         NUMERIC DEFAULT 0,
  lng                         NUMERIC DEFAULT 0,
  has_mobile_service          BOOLEAN DEFAULT FALSE,
  has_garage                  BOOLEAN DEFAULT FALSE,
  min_price                   NUMERIC DEFAULT 0,
  rating                      NUMERIC DEFAULT 0,
  review_count                INTEGER DEFAULT 0,
  services                    TEXT[] DEFAULT '{}',
  team_size                   INTEGER DEFAULT 1,
  years_of_experience         INTEGER DEFAULT 0,
  logo_url                    TEXT,
  banner_url                  TEXT,
  phone                       TEXT,
  email                       TEXT,
  opening_hours               JSONB,
  stripe_account_id           TEXT,
  max_radius_km               NUMERIC,
  service_area                JSONB,
  welcoming_offer_enabled     BOOLEAN DEFAULT FALSE,
  available_today             BOOLEAN DEFAULT FALSE,
  curated_badge               TEXT,
  profile_views_total         INTEGER DEFAULT 0,
  profile_views_this_week     INTEGER DEFAULT 0,
  profile_views_last_week     INTEGER DEFAULT 0,
  profile_views_updated_at    TIMESTAMPTZ,
  annual_revenue_limit        NUMERIC,
  annual_revenue_current      NUMERIC DEFAULT 0,
  annual_revenue_year         INTEGER
);

CREATE INDEX IF NOT EXISTS idx_provider_profiles_user_id ON provider_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_provider_profiles_lat_lng ON provider_profiles(lat, lng);
CREATE INDEX IF NOT EXISTS idx_provider_profiles_rating ON provider_profiles(rating DESC);

-- ============================================================
-- 5. CITIES
-- ============================================================
CREATE TABLE IF NOT EXISTS cities (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        TEXT NOT NULL,
  postal_code TEXT,
  lat         NUMERIC,
  lng         NUMERIC
);

CREATE INDEX IF NOT EXISTS idx_cities_name ON cities(name);
CREATE INDEX IF NOT EXISTS idx_cities_lat_lng ON cities(lat, lng);

-- ============================================================
-- 6. SERVICE CATEGORIES
-- ============================================================
CREATE TABLE IF NOT EXISTS service_categories (
  id            TEXT PRIMARY KEY,
  display_name  TEXT NOT NULL
);

-- ============================================================
-- 7. SERVICES
-- ============================================================
CREATE TABLE IF NOT EXISTS services (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  provider_id       UUID NOT NULL REFERENCES provider_profiles(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  category          TEXT,
  categories        TEXT[] DEFAULT '{}',
  price             NUMERIC NOT NULL DEFAULT 0,
  duration_minutes  INTEGER,
  description       TEXT,
  is_available      BOOLEAN DEFAULT TRUE,
  image_url         TEXT,
  currency          TEXT DEFAULT 'eur',
  stripe_product_id TEXT,
  stripe_price_id   TEXT,
  steps_template    JSONB
);

CREATE INDEX IF NOT EXISTS idx_services_provider_id ON services(provider_id);
CREATE INDEX IF NOT EXISTS idx_services_category ON services(category);
CREATE INDEX IF NOT EXISTS idx_services_price ON services(price);

-- ============================================================
-- 8. BOOKINGS
-- ============================================================
CREATE TABLE IF NOT EXISTS bookings (
  id                          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  provider_id                 UUID NOT NULL,
  customer_id                 UUID NOT NULL REFERENCES users(id),
  service_id                  UUID REFERENCES services(id),
  provider_name               TEXT,
  service_name                TEXT,
  price                       NUMERIC NOT NULL DEFAULT 0,
  currency                    TEXT DEFAULT 'eur',
  date                        DATE NOT NULL,
  start_time                  TEXT,
  end_time                    TEXT,
  address                     TEXT,
  status                      TEXT NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('pending','confirmed','ready_soon','started','in_progress','completed','cancelled','declined','refunded','no_show')),
  payment_status              TEXT DEFAULT 'pending'
                                CHECK (payment_status IN ('pending','preauthorized','paid','failed','refunded','cancelled')),
  payment_intent_id           TEXT,
  payment_method              TEXT DEFAULT 'card',
  deposit_amount              NUMERIC,
  deposit_payment_intent_id   TEXT,
  commission_rate             NUMERIC DEFAULT 0.10,
  invoice_sent                BOOLEAN DEFAULT FALSE,
  provider_banner_url         TEXT,
  transport_distance_km       NUMERIC,
  transport_fee               NUMERIC DEFAULT 0,
  customer_address_lat        NUMERIC,
  customer_address_lng        NUMERIC,
  service_at_provider         BOOLEAN DEFAULT FALSE,
  at_provider                 BOOLEAN DEFAULT FALSE,
  notes                       TEXT,
  acceptance_deadline          TIMESTAMPTZ,
  progress                    JSONB,
  stripe_charge_id            TEXT,
  provider_transfer_id        TEXT,
  -- Counter proposal
  counter_proposal_date       DATE,
  counter_proposal_start_time TEXT,
  counter_proposal_end_time   TEXT,
  counter_proposal_message    TEXT,
  counter_proposal_status     TEXT,
  -- Modification request
  modification_request_date       DATE,
  modification_request_start_time TEXT,
  modification_request_end_time   TEXT,
  modification_request_message    TEXT,
  modification_request_status     TEXT,
  -- Peppol (e-invoicing)
  peppol_requested            BOOLEAN DEFAULT FALSE,
  peppol_status               TEXT,
  peppol_invoice_id           TEXT,
  peppol_sent_at              TIMESTAMPTZ,
  -- Company info (for B2B invoicing)
  company_name                TEXT,
  company_vat                 TEXT,
  company_address             TEXT,
  company_peppol_id           TEXT,
  -- Welcoming offer
  is_first_booking            BOOLEAN DEFAULT FALSE,
  welcoming_offer_applied     BOOLEAN DEFAULT FALSE,
  welcoming_offer_amount      NUMERIC,
  created_at                  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bookings_provider_id ON bookings(provider_id);
CREATE INDEX IF NOT EXISTS idx_bookings_customer_id ON bookings(customer_id);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);
CREATE INDEX IF NOT EXISTS idx_bookings_payment_status ON bookings(payment_status);
CREATE INDEX IF NOT EXISTS idx_bookings_date ON bookings(date);
CREATE INDEX IF NOT EXISTS idx_bookings_created_at ON bookings(created_at);
CREATE INDEX IF NOT EXISTS idx_bookings_payment_intent_id ON bookings(payment_intent_id);

-- ============================================================
-- 9. BOOKING SERVICES (multi-service bookings)
-- ============================================================
CREATE TABLE IF NOT EXISTS booking_services (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  booking_id    UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  service_id    UUID REFERENCES services(id),
  service_name  TEXT,
  service_price NUMERIC DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_booking_services_booking_id ON booking_services(booking_id);

-- ============================================================
-- 10. REVIEWS
-- ============================================================
CREATE TABLE IF NOT EXISTS reviews (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  provider_id   UUID NOT NULL,
  customer_id   UUID NOT NULL REFERENCES users(id),
  booking_id    UUID REFERENCES bookings(id),
  rating        NUMERIC NOT NULL CHECK (rating >= 1 AND rating <= 5),
  comment       TEXT,
  source        TEXT DEFAULT 'app',
  author_name   TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reviews_provider_id ON reviews(provider_id);
CREATE INDEX IF NOT EXISTS idx_reviews_booking_id ON reviews(booking_id);

-- ============================================================
-- 11. OFFERS
-- ============================================================
CREATE TABLE IF NOT EXISTS offers (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title             TEXT NOT NULL,
  category          TEXT,
  categories        TEXT[] DEFAULT '{}',
  description       TEXT,
  vehicle_count     INTEGER,
  price_min         NUMERIC,
  price_max         NUMERIC,
  city              TEXT,
  postal_code       TEXT,
  lat               NUMERIC,
  lng               NUMERIC,
  type              TEXT CHECK (type IN ('oneTime', 'recurring', 'longTerm')),
  status            TEXT DEFAULT 'open' CHECK (status IN ('open', 'closed', 'archived')),
  contract_id       UUID,
  created_by        UUID NOT NULL REFERENCES users(id),
  company_name      TEXT,
  company_logo_url  TEXT,
  start_date        DATE,
  end_date          DATE,
  vehicle_types     JSONB,
  prerequisites     JSONB,
  is_urgent         BOOLEAN DEFAULT FALSE,
  intervention_mode TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_offers_status ON offers(status);
CREATE INDEX IF NOT EXISTS idx_offers_created_by ON offers(created_by);
CREATE INDEX IF NOT EXISTS idx_offers_city ON offers(city);

-- View: offers with application counts
CREATE OR REPLACE VIEW offers_with_counts AS
SELECT
  o.*,
  COALESCE(ac.applications_count, 0) AS applications_count,
  COALESCE(ac.has_accepted_application, FALSE) AS has_accepted_application
FROM offers o
LEFT JOIN LATERAL (
  SELECT
    COUNT(*)::INTEGER AS applications_count,
    BOOL_OR(a.status = 'accepted') AS has_accepted_application
  FROM applications a
  WHERE a.offer_id = o.id
) ac ON TRUE;

-- ============================================================
-- 12. APPLICATIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS applications (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  offer_id              UUID NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
  provider_id           UUID NOT NULL REFERENCES users(id),
  message               TEXT,
  proposed_price        NUMERIC,
  final_price           NUMERIC,
  attachments           JSONB,
  status                TEXT DEFAULT 'submitted'
                          CHECK (status IN ('submitted', 'underReview', 'accepted', 'refused', 'withdrawn')),
  provider_name         TEXT,
  rating_after_contract NUMERIC,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_applications_offer_id ON applications(offer_id);
CREATE INDEX IF NOT EXISTS idx_applications_provider_id ON applications(provider_id);
CREATE INDEX IF NOT EXISTS idx_applications_status ON applications(status);

-- ============================================================
-- 13. PAYMENT TRANSACTIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS payment_transactions (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id           UUID REFERENCES users(id),
  stripe_object_id  TEXT,
  amount            NUMERIC NOT NULL,
  currency          TEXT DEFAULT 'eur',
  status            TEXT,
  type              TEXT CHECK (type IN ('payment', 'refund', 'payout', 'transfer')),
  metadata          JSONB,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_transactions_user_id ON payment_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_payment_transactions_created_at ON payment_transactions(created_at);

-- ============================================================
-- 14. MISSION AGREEMENTS (B2B contracts)
-- ============================================================
CREATE TABLE IF NOT EXISTS mission_agreements (
  id                            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  offer_id                      UUID REFERENCES offers(id),
  application_id                UUID REFERENCES applications(id),
  company_id                    UUID NOT NULL REFERENCES users(id),
  detailer_id                   UUID NOT NULL REFERENCES users(id),
  title                         TEXT,
  description                   TEXT,
  location_city                 TEXT,
  location_postal_code          TEXT,
  vehicle_count                 INTEGER,
  final_price                   NUMERIC NOT NULL,
  deposit_percentage            NUMERIC DEFAULT 0,
  deposit_amount                NUMERIC DEFAULT 0,
  remaining_amount              NUMERIC,
  payment_schedule              JSONB,
  operational_rules             JSONB,
  start_date                    DATE,
  end_date                      DATE,
  estimated_duration_days       INTEGER,
  status                        TEXT DEFAULT 'pending'
                                  CHECK (status IN ('pending','active','completed','cancelled','disputed')),
  payment_status                TEXT DEFAULT 'pending',
  stripe_payment_intent_id      TEXT,
  stripe_subscription_id        TEXT,
  stripe_customer_id            TEXT,
  stripe_connected_account_id   TEXT,
  agreement_pdf_url             TEXT,
  contract_version              INTEGER DEFAULT 1,
  contract_created_at           TIMESTAMPTZ,
  categories                    TEXT[] DEFAULT '{}',
  mission_type                  TEXT,
  country                       TEXT DEFAULT 'BE',
  currency                      TEXT DEFAULT 'eur',
  commission_rate               NUMERIC DEFAULT 0.10,
  -- Company legal info
  company_legal_name            TEXT,
  company_vat_number            TEXT,
  company_legal_address         TEXT,
  company_legal_representative  TEXT,
  company_email                 TEXT,
  -- Detailer legal info
  detailer_legal_name           TEXT,
  detailer_vat_number           TEXT,
  detailer_address              TEXT,
  detailer_iban                 TEXT,
  detailer_email                TEXT,
  -- Operational details
  exact_address                 TEXT,
  specific_constraints          TEXT,
  required_products             JSONB,
  invoice_required              BOOLEAN DEFAULT FALSE,
  payment_type                  TEXT,
  -- Acceptance tracking
  company_accepted_at           TIMESTAMPTZ,
  detailer_accepted_at          TIMESTAMPTZ,
  contract_version_at_acceptance INTEGER,
  -- Cancellation
  cancellation_requested_at     TIMESTAMPTZ,
  cancellation_requested_by     TEXT,
  -- Transfer
  transfer_executed_at          TIMESTAMPTZ,
  transfer_id                   TEXT,
  created_at                    TIMESTAMPTZ DEFAULT NOW(),
  updated_at                    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mission_agreements_company_id ON mission_agreements(company_id);
CREATE INDEX IF NOT EXISTS idx_mission_agreements_detailer_id ON mission_agreements(detailer_id);
CREATE INDEX IF NOT EXISTS idx_mission_agreements_status ON mission_agreements(status);

-- ============================================================
-- 15. MISSION PAYMENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS mission_payments (
  id                        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  mission_agreement_id      UUID NOT NULL REFERENCES mission_agreements(id) ON DELETE CASCADE,
  type                      TEXT NOT NULL CHECK (type IN ('deposit', 'monthly', 'final', 'one_time')),
  amount                    NUMERIC NOT NULL,
  status                    TEXT DEFAULT 'pending'
                              CHECK (status IN ('pending','authorized','captured','failed','refunded','cancelled')),
  stripe_payment_intent_id  TEXT,
  stripe_charge_id          TEXT,
  stripe_refund_id          TEXT,
  stripe_transfer_id        TEXT,
  scheduled_date            DATE,
  authorized_at             TIMESTAMPTZ,
  captured_at               TIMESTAMPTZ,
  transferred_at            TIMESTAMPTZ,
  hold_until                TIMESTAMPTZ,
  failed_at                 TIMESTAMPTZ,
  installment_number        INTEGER,
  month_number              INTEGER,
  failure_reason            TEXT,
  invoice_pdf_url           TEXT,
  created_at                TIMESTAMPTZ DEFAULT NOW(),
  updated_at                TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mission_payments_agreement_id ON mission_payments(mission_agreement_id);
CREATE INDEX IF NOT EXISTS idx_mission_payments_status ON mission_payments(status);
CREATE INDEX IF NOT EXISTS idx_mission_payments_scheduled_date ON mission_payments(scheduled_date);

-- ============================================================
-- 16. MISSION INVOICES
-- ============================================================
CREATE TABLE IF NOT EXISTS mission_invoices (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  mission_agreement_id  UUID NOT NULL REFERENCES mission_agreements(id),
  mission_payment_id    UUID REFERENCES mission_payments(id),
  type                  TEXT NOT NULL,
  total_amount          NUMERIC NOT NULL,
  commission_amount     NUMERIC DEFAULT 0,
  net_amount            NUMERIC DEFAULT 0,
  vat_amount            NUMERIC DEFAULT 0,
  vat_rate              NUMERIC DEFAULT 0.21,
  invoice_number        TEXT UNIQUE,
  invoice_pdf_url       TEXT,
  sent_at               TIMESTAMPTZ,
  paid_at               TIMESTAMPTZ,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 17. NOTIFICATIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS notifications (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  message     TEXT,
  type        TEXT,
  data        JSONB,
  is_read     BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at DESC);

-- ============================================================
-- 18. DEVICE TOKENS (push notifications)
-- ============================================================
CREATE TABLE IF NOT EXISTS device_tokens (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_token  TEXT NOT NULL,
  platform      TEXT DEFAULT 'ios',
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, device_token)
);

-- ============================================================
-- 19. CONVERSATIONS (chat)
-- ============================================================
CREATE TABLE IF NOT EXISTS conversations (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  provider_id     UUID NOT NULL,
  customer_id     UUID NOT NULL REFERENCES users(id),
  booking_id      UUID REFERENCES bookings(id),
  application_id  UUID REFERENCES applications(id),
  offer_id        UUID REFERENCES offers(id),
  last_message_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conversations_provider_id ON conversations(provider_id);
CREATE INDEX IF NOT EXISTS idx_conversations_customer_id ON conversations(customer_id);

-- ============================================================
-- 20. MESSAGES
-- ============================================================
CREATE TABLE IF NOT EXISTS messages (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id   UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id         UUID NOT NULL REFERENCES users(id),
  sender_role       TEXT,
  content           TEXT NOT NULL,
  is_read           BOOLEAN DEFAULT FALSE,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);

-- ============================================================
-- 21. REFERRALS
-- ============================================================
CREATE TABLE IF NOT EXISTS referrals (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  referrer_id   UUID NOT NULL REFERENCES users(id),
  referred_id   UUID NOT NULL REFERENCES users(id),
  role_type     TEXT,
  status        TEXT DEFAULT 'pending',
  validated_at  TIMESTAMPTZ,
  reward_type   TEXT,
  reward_value  NUMERIC,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_referrals_referrer_id ON referrals(referrer_id);

-- ============================================================
-- 22. PRODUCTS (shop)
-- ============================================================
CREATE TABLE IF NOT EXISTS products (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name          TEXT NOT NULL,
  description   TEXT,
  category      TEXT,
  level         TEXT,
  price         NUMERIC NOT NULL DEFAULT 0,
  promo_price   NUMERIC,
  image_url     TEXT,
  affiliate_url TEXT,
  partner_name  TEXT,
  rating        NUMERIC DEFAULT 0,
  review_count  INTEGER DEFAULT 0,
  is_active     BOOLEAN DEFAULT TRUE,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 23. PRODUCT CLICKS (analytics)
-- ============================================================
CREATE TABLE IF NOT EXISTS product_clicks (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id  UUID REFERENCES products(id),
  user_id     UUID REFERENCES users(id),
  role        TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 24. PRODUCT FAVORITES
-- ============================================================
CREATE TABLE IF NOT EXISTS product_favorites (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id  UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, product_id)
);

-- ============================================================
-- 25. ORDERS
-- ============================================================
CREATE TABLE IF NOT EXISTS orders (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  customer_id       UUID NOT NULL REFERENCES users(id),
  order_number      TEXT UNIQUE NOT NULL,
  items             JSONB NOT NULL DEFAULT '[]',
  total_amount      NUMERIC NOT NULL DEFAULT 0,
  shipping_address  JSONB,
  status            TEXT DEFAULT 'pending',
  payment_status    TEXT DEFAULT 'pending',
  payment_intent_id TEXT,
  tracking_number   TEXT,
  carrier           TEXT,
  supplier_id       UUID,
  shipped_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orders_customer_id ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_order_number ON orders(order_number);

-- ============================================================
-- 26. PROVIDER PORTFOLIO PHOTOS
-- ============================================================
CREATE TABLE IF NOT EXISTS provider_portfolio_photos (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  provider_id       UUID NOT NULL,
  image_url         TEXT NOT NULL,
  thumbnail_url     TEXT,
  caption           TEXT,
  service_category  TEXT,
  display_order     INTEGER DEFAULT 0,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_portfolio_photos_provider_id ON provider_portfolio_photos(provider_id);

-- ============================================================
-- 27. SERVICE PHOTOS
-- ============================================================
CREATE TABLE IF NOT EXISTS service_photos (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  service_id      UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  provider_id     UUID NOT NULL,
  image_url       TEXT NOT NULL,
  thumbnail_url   TEXT,
  caption         TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 28. CONTENT REPORTS (moderation)
-- ============================================================
CREATE TABLE IF NOT EXISTS content_reports (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  reporter_id       UUID NOT NULL REFERENCES users(id),
  reported_user_id  UUID REFERENCES users(id),
  content_type      TEXT NOT NULL CHECK (content_type IN ('review', 'message', 'profile', 'photo', 'offer')),
  content_id        UUID,
  reason            TEXT NOT NULL,
  description       TEXT,
  status            TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'reviewed', 'resolved', 'dismissed')),
  action_taken      TEXT,
  reviewed_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_content_reports_status ON content_reports(status);

-- ============================================================
-- 29. BLOCKED USERS
-- ============================================================
CREATE TABLE IF NOT EXISTS blocked_users (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  blocker_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason      TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(blocker_id, blocked_id),
  CHECK (blocker_id != blocked_id)
);

-- ============================================================
-- 30. CRON LOCKS (leader election)
-- ============================================================
CREATE TABLE IF NOT EXISTS cron_locks (
  job_name    TEXT PRIMARY KEY,
  locked_by   TEXT NOT NULL,
  locked_at   TIMESTAMPTZ DEFAULT NOW(),
  expires_at  TIMESTAMPTZ NOT NULL
);

-- RPC: acquire_cron_lock
CREATE OR REPLACE FUNCTION acquire_cron_lock(p_job_name TEXT, p_locked_by TEXT, p_ttl_seconds INTEGER DEFAULT 300)
RETURNS BOOLEAN AS $$
DECLARE
  v_now TIMESTAMPTZ := NOW();
BEGIN
  -- Delete expired locks
  DELETE FROM cron_locks WHERE job_name = p_job_name AND expires_at < v_now;
  -- Try to insert
  INSERT INTO cron_locks (job_name, locked_by, locked_at, expires_at)
  VALUES (p_job_name, p_locked_by, v_now, v_now + (p_ttl_seconds || ' seconds')::INTERVAL)
  ON CONFLICT (job_name) DO NOTHING;
  -- Check if we got the lock
  RETURN EXISTS (
    SELECT 1 FROM cron_locks
    WHERE job_name = p_job_name AND locked_by = p_locked_by
  );
END;
$$ LANGUAGE plpgsql;

-- RPC: release_cron_lock
CREATE OR REPLACE FUNCTION release_cron_lock(p_job_name TEXT, p_locked_by TEXT)
RETURNS BOOLEAN AS $$
BEGIN
  DELETE FROM cron_locks WHERE job_name = p_job_name AND locked_by = p_locked_by;
  RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 31. PROVIDER BLOCKED SLOTS (availability)
-- ============================================================
CREATE TABLE IF NOT EXISTS provider_blocked_slots (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  provider_id UUID NOT NULL,
  slot_date   DATE NOT NULL,
  start_time  TEXT,
  end_time    TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_blocked_slots_provider_date ON provider_blocked_slots(provider_id, slot_date);

-- ============================================================
-- 32. OFFER FAVORITES
-- ============================================================
CREATE TABLE IF NOT EXISTS offer_favorites (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  offer_id    UUID NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(offer_id, user_id)
);

-- ============================================================
-- 33. PROVIDER FAVORITES
-- ============================================================
CREATE TABLE IF NOT EXISTS provider_favorites (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  provider_id   UUID NOT NULL,
  customer_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(provider_id, customer_id)
);

-- ============================================================
-- 34. PROVIDER PROFILE VIEWS (analytics)
-- ============================================================
CREATE TABLE IF NOT EXISTS provider_profile_views (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  provider_id UUID NOT NULL,
  customer_id UUID REFERENCES users(id),
  view_type   TEXT DEFAULT 'detail',
  viewed_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_profile_views_provider_id ON provider_profile_views(provider_id);

-- ============================================================
-- 35. REVIEW PROMPTS (Google review flow)
-- ============================================================
CREATE TABLE IF NOT EXISTS review_prompts (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  booking_id            UUID REFERENCES bookings(id),
  customer_id           UUID NOT NULL REFERENCES users(id),
  provider_id           UUID NOT NULL,
  google_place_id       TEXT,
  rating_selected       INTEGER,
  google_redirected_at  TIMESTAMPTZ,
  dismissed_at          TIMESTAMPTZ,
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 36. FAILED TRANSFERS (retry queue)
-- ============================================================
CREATE TABLE IF NOT EXISTS failed_transfers (
  id                          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  mission_agreement_id        UUID REFERENCES mission_agreements(id),
  mission_payment_id          UUID REFERENCES mission_payments(id),
  detailer_id                 UUID NOT NULL REFERENCES users(id),
  stripe_connected_account_id TEXT,
  amount                      NUMERIC NOT NULL,
  commission_rate             NUMERIC,
  commission_amount           NUMERIC,
  net_amount                  NUMERIC,
  error_message               TEXT,
  error_code                  TEXT,
  status                      TEXT DEFAULT 'pending'
                                CHECK (status IN ('pending', 'retrying', 'succeeded', 'failed')),
  retry_count                 INTEGER DEFAULT 0,
  max_retries                 INTEGER DEFAULT 5,
  last_retry_at               TIMESTAMPTZ,
  created_at                  TIMESTAMPTZ DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_failed_transfers_status ON failed_transfers(status);

-- ============================================================
-- 37. COMPANY REVIEWS
-- ============================================================
CREATE TABLE IF NOT EXISTS company_reviews (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  detailer_id           UUID NOT NULL REFERENCES users(id),
  company_id            UUID NOT NULL REFERENCES users(id),
  mission_agreement_id  UUID REFERENCES mission_agreements(id),
  rating                INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  comment               TEXT,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(detailer_id, company_id, mission_agreement_id)
);

-- ============================================================
-- ROW LEVEL SECURITY (RLS) — Base policies
-- ============================================================

-- Enable RLS on all tables
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE booking_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE services ENABLE ROW LEVEL SECURITY;
ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

-- Users: can read own row
DROP POLICY IF EXISTS users_select_own ON users;
CREATE POLICY users_select_own ON users FOR SELECT USING (auth.uid() = id);
DROP POLICY IF EXISTS users_update_own ON users;
CREATE POLICY users_update_own ON users FOR UPDATE USING (auth.uid() = id);

-- Customer profiles: own row
DROP POLICY IF EXISTS customer_profiles_select ON customer_profiles;
CREATE POLICY customer_profiles_select ON customer_profiles FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS customer_profiles_upsert ON customer_profiles;
CREATE POLICY customer_profiles_upsert ON customer_profiles FOR ALL USING (auth.uid() = user_id);

-- Company profiles: own row
DROP POLICY IF EXISTS company_profiles_select ON company_profiles;
CREATE POLICY company_profiles_select ON company_profiles FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS company_profiles_upsert ON company_profiles;
CREATE POLICY company_profiles_upsert ON company_profiles FOR ALL USING (auth.uid() = user_id);

-- Provider profiles: public read, own write
DROP POLICY IF EXISTS provider_profiles_select ON provider_profiles;
CREATE POLICY provider_profiles_select ON provider_profiles FOR SELECT USING (TRUE);
DROP POLICY IF EXISTS provider_profiles_update ON provider_profiles;
CREATE POLICY provider_profiles_update ON provider_profiles FOR UPDATE USING (auth.uid() = user_id);

-- Bookings: customer and provider can see their own
DROP POLICY IF EXISTS bookings_select ON bookings;
CREATE POLICY bookings_select ON bookings FOR SELECT USING (
  auth.uid() = customer_id OR auth.uid() IN (SELECT user_id FROM provider_profiles WHERE id = provider_id)
);

-- Services: public read, provider write
DROP POLICY IF EXISTS services_select ON services;
CREATE POLICY services_select ON services FOR SELECT USING (TRUE);
DROP POLICY IF EXISTS services_insert ON services;
CREATE POLICY services_insert ON services FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM provider_profiles WHERE id = provider_id AND user_id = auth.uid())
);

-- Reviews: public read
DROP POLICY IF EXISTS reviews_select ON reviews;
CREATE POLICY reviews_select ON reviews FOR SELECT USING (TRUE);

-- Offers: public read, company write
DROP POLICY IF EXISTS offers_select ON offers;
CREATE POLICY offers_select ON offers FOR SELECT USING (TRUE);
DROP POLICY IF EXISTS offers_insert ON offers;
CREATE POLICY offers_insert ON offers FOR INSERT WITH CHECK (auth.uid() = created_by);

-- Notifications: own only
DROP POLICY IF EXISTS notifications_select ON notifications;
CREATE POLICY notifications_select ON notifications FOR SELECT USING (auth.uid() = user_id);

-- Messages: participants only
DROP POLICY IF EXISTS messages_select ON messages;
CREATE POLICY messages_select ON messages FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM conversations c
    WHERE c.id = conversation_id
    AND (c.customer_id = auth.uid() OR c.provider_id IN (SELECT user_id FROM provider_profiles WHERE user_id = auth.uid()))
  )
);

-- Payment transactions: own only
DROP POLICY IF EXISTS payment_transactions_select ON payment_transactions;
CREATE POLICY payment_transactions_select ON payment_transactions FOR SELECT USING (auth.uid() = user_id);

-- Orders: own only
DROP POLICY IF EXISTS orders_select ON orders;
CREATE POLICY orders_select ON orders FOR SELECT USING (auth.uid() = customer_id);

-- ============================================================
-- NOTE: The backend uses supabaseAdmin (service_role key) which
-- bypasses RLS. These policies are for direct client access and
-- future Supabase Realtime subscriptions (anon key).
-- ============================================================
