// Set dummy env variables BEFORE any module loads
// This prevents crashes in supabase.js, stripeConnect.service.js, etc.
process.env.SUPABASE_URL = process.env.SUPABASE_URL || "http://localhost:54321";
process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test";
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test-service";
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "sk_test_dummy_key_for_tests_only";
process.env.STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "whsec_test_dummy";
process.env.FRONTEND_BASE_URL = process.env.FRONTEND_BASE_URL || "http://localhost:3000";
process.env.APPLE_BUNDLE_ID = process.env.APPLE_BUNDLE_ID || "com.test.app";
process.env.RESEND_API_KEY = process.env.RESEND_API_KEY || "re_test_dummy_key";
process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
process.env.ONESIGNAL_APP_ID = process.env.ONESIGNAL_APP_ID || "test-app-id";
process.env.ONESIGNAL_REST_API_KEY = process.env.ONESIGNAL_REST_API_KEY || "test-rest-key";
process.env.NODE_ENV = "test";
