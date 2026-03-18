import type { Session } from "@supabase/supabase-js";
import { supabase } from "../supabase";
import { logger } from "@/utils/logger";

/**
 * Get a fresh Supabase session, verifying the JWT with the server first.
 * If the token is invalid or expired, it will be auto-refreshed.
 * If the refresh token is also expired, returns null — the caller should
 * treat this as "unauthenticated" and the app will redirect to login.
 */
export async function getFreshSession(): Promise<Session | null> {
  // Read the current session from the Supabase client's internal state.
  // autoRefreshToken is enabled, so the client keeps the token fresh automatically.
  // We only call getSession() (not refreshSession()) to avoid triggering
  // extra auth state change events that cause token churn on startup.
  const { data: { session } } = await supabase.auth.getSession();

  if (session) {
    return session;
  }

  // No cached session — try an explicit refresh (e.g. after app was idle for a long time)
  logger.wave("No cached session, attempting refresh");
  const { data: refreshed, error } = await supabase.auth.refreshSession();

  if (error || !refreshed.session) {
    logger.warn("Session refresh failed — user must re-authenticate", error);
    return null;
  }

  return refreshed.session;
}
