import { createClient } from "@supabase/supabase-js";

export function createSupabaseClient() {
  const url = import.meta.env.VITE_SUPABASE_URL?.trim();
  const publishableKey =
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ||
    import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();

  if (!url || !publishableKey) {
    throw new Error(
      "Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY to .env.local.",
    );
  }

  return createClient(url, publishableKey, {
    auth: {
      autoRefreshToken: true,
      detectSessionInUrl: false,
      persistSession: true,
    },
  });
}
