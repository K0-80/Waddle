import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://xteplentifcxnlgrmhlm.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_P2Bxtq4ijGmoEWrHy-Yd7Q__-GqjEoZ";

export function createSupabaseClient() {
  return createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: {
      autoRefreshToken: true,
      detectSessionInUrl: false,
      persistSession: true,
    },
  });
}