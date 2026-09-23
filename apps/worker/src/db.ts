import { createClient } from "@supabase/supabase-js";
import type { Database } from "@gasguard/shared";

// ── Environment validation ───────────────────────────────────

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey) {
  console.error("Missing required environment variables:");
  if (!supabaseUrl) console.error("  SUPABASE_URL");
  if (!supabaseServiceRoleKey) console.error("  SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

// ── Supabase client ─────────────────────────────────────────

export const supabase = createClient<Database>(supabaseUrl, supabaseServiceRoleKey);