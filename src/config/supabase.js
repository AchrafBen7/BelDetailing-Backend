import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

// S'assurer que .env est chargé
dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// ⚠️ on ne crée le client que si l'URL est définie
if (!SUPABASE_URL) {
  console.error("❌ [SUPABASE] SUPABASE_URL missing from environment variables");
  console.error("❌ [SUPABASE] Check that .env file exists and contains SUPABASE_URL");
  throw new Error("SUPABASE_URL missing – check .env file exists and contains SUPABASE_URL");
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
});

export const supabaseAdmin = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY,
  {
    auth: { persistSession: false },
  }
);
