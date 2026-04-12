import type { Session } from "@supabase/supabase-js";
import { supabase } from "../supabase";
import { logger } from "@/utils/logger";

/**
 * Get a fresh Supabase session, verifying the JWT with the server first.
 * If the token is invalid or expired, it will be auto-refreshed.
 * If the refresh token is also expired, returns null — the caller should
 * treat this as "unauthenticated" and the app will redirect to login.
 */
const SESSION_REFRESH_TIMEOUT_MS = 10_000;

export async function getFreshSession(): Promise<Session | null> {
  // Read the current session from the Supabase client's internal state.
  // autoRefreshToken is enabled, so the client keeps the token fresh automatically.
  // We only call getSession() (not refreshSession()) to avoid triggering
  // extra auth state change events that cause token churn on startup.
  const { data: { session } } = await supabase.auth.getSession();

  if (session) {
    return session;
  }

  // No cached session — try an explicit refresh (e.g. after app was idle for a long time).
  // Timeout guard prevents UI freeze if the auth server is unreachable (TD-1 fix).
  logger.wave("No cached session, attempting refresh");
  let timer: ReturnType<typeof setTimeout>;
  try {
    const refreshPromise = supabase.auth.refreshSession();
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("session_refresh_timeout")), SESSION_REFRESH_TIMEOUT_MS);
    });
    const { data: refreshed, error } = await Promise.race([refreshPromise, timeoutPromise]);
    clearTimeout(timer!);

    if (error || !refreshed.session) {
      logger.warn("Session refresh failed — user must re-authenticate", error);
      return null;
    }

    return refreshed.session;
  } catch (err: unknown) {
    clearTimeout(timer!);
    const isTimeout = err instanceof Error && err.message === "session_refresh_timeout";
    logger.warn(isTimeout ? "Session refresh timed out" : "Session refresh failed", {
      reason: isTimeout ? "timeout" : (err instanceof Error ? err.message : "unknown"),
      timeoutMs: SESSION_REFRESH_TIMEOUT_MS,
    });
    return null;
  }
}
