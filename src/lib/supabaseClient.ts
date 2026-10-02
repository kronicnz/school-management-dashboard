import { createClient } from "@supabase/supabase-js"

function isLocalDevSupabaseUrl(url: string) {
  try {
    const parsed = new URL(url)
    return parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname.endsWith(".nip.io")
  } catch {
    return false
  }
}

const configuredSupabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
export const supabaseUrl =
  typeof window !== "undefined" && configuredSupabaseUrl && isLocalDevSupabaseUrl(configuredSupabaseUrl)
    ? window.location.origin
    : configuredSupabaseUrl
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey)

export const supabase = supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null
