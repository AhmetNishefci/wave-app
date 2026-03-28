import { invokeWithTimeout } from "../supabase";
import { getFreshSession } from "./session";
import { logger } from "@/utils/logger";
import type { Gender } from "@/types";

export interface TokenResponse {
  token: string;
  expires_at: string;
  gender: Gender | null;
  note: string | null;
  age: number | null;
}

const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY_MS = 2_000;

/**
 * Fetch a new ephemeral token from the server.
 * Retries up to 3 times with exponential backoff on failure.
 * Returns pure data — callers are responsible for store updates.
 */
export async function fetchNewToken(): Promise<TokenResponse | null> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const result = await attemptFetchToken();
      if (result) {
        return result;
      }
    } catch (error) {
      logger.warn(
        `Token fetch attempt ${attempt + 1}/${MAX_RETRIES + 1} failed`,
        error,
      );
    }

    // Don't delay after the last attempt
    if (attempt < MAX_RETRIES) {
      const delay = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt);
      logger.wave(`Retrying token fetch in ${delay}ms...`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  logger.error("All token fetch attempts failed");
  return null;
}

async function attemptFetchToken(): Promise<TokenResponse | null> {
  const session = await getFreshSession();

  if (!session) {
    logger.warn("Cannot fetch token: no valid session");
    return null;
  }

  const { data, error } = await invokeWithTimeout("assign-ephemeral-id");

  if (error) {
    let details = "";
    try {
      if ("context" in error && (error as any).context?.json) {
        details = JSON.stringify(await (error as any).context.json());
      } else if ("context" in error && (error as any).context?.text) {
        details = await (error as any).context.text();
      }
    } catch {
      details = (error as any)?.message ?? "";
    }

    logger.warn(
      "Failed to fetch ephemeral token: " + (details || "no details"),
      error,
    );
    throw error;
  }

  const result = data as TokenResponse;

  logger.wave("New ephemeral token assigned", {
    token: result.token.substring(0, 8),
    expiresAt: result.expires_at,
  });

  return result;
}
