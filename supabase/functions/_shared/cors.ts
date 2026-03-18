/**
 * Shared CORS headers for all Edge Functions.
 *
 * For mobile-only APIs, we restrict the origin to the Supabase project URL.
 * The Authorization header requirement provides the primary security layer;
 * CORS adds defense-in-depth against browser-based abuse.
 */

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";

// Allow the Supabase project origin + mobile apps (which don't send Origin headers).
// Filter out empty strings to prevent accidental wildcard-like behavior.
const ALLOWED_ORIGINS = [
  SUPABASE_URL,
  // Add additional origins here if a web client is added in the future
].filter(Boolean);

export function getCorsHeaders(request?: Request): Record<string, string> {
  const origin = request?.headers.get("Origin") ?? "";

  // Mobile clients (React Native) don't send an Origin header — always allow.
  // Browsers always send one — only allow known origins.
  let allowedOrigin: string;
  if (!origin) {
    // No Origin header = mobile client or server-to-server call. Allow.
    allowedOrigin = SUPABASE_URL || "*";
  } else if (ALLOWED_ORIGINS.includes(origin)) {
    // Known browser origin. Reflect it back.
    allowedOrigin = origin;
  } else {
    // Unknown browser origin. Deny by returning empty (browser will block).
    allowedOrigin = "";
  }

  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

/**
 * Handle preflight OPTIONS requests.
 * Returns a Response if this is an OPTIONS request, null otherwise.
 */
export function handleCorsPreflightIfNeeded(
  req: Request,
): Response | null {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: getCorsHeaders(req) });
  }
  return null;
}
