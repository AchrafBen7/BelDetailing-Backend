import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

console.log("SUPABASE_URL (config) =", SUPABASE_URL);
console.log("ANON =", SUPABASE_ANON_KEY ? "OK" : "❌ MISSING");
console.log("SERVICE =", SUPABASE_SERVICE_ROLE_KEY ? "OK" : "❌ MISSING");

// ⚠️ on ne crée le client que si l'URL est définie
if (!SUPABASE_URL) {
  throw new Error("SUPABASE_URL missing – check .env or docker-compose env_file");
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
