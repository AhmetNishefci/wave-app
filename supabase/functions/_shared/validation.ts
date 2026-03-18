/**
 * Shared Zod schemas for Edge Function input validation (O7).
 *
 * Using Zod via esm.sh for Deno compatibility. All schemas are defined
 * here to ensure consistent validation across edge functions.
 */
import { z } from "https://esm.sh/zod@3.23.8";

// ─── Primitive patterns ─────────────────────────────────────────────

/** 16-character lowercase hex token */
export const ephemeralTokenSchema = z
  .string()
  .regex(/^[0-9a-f]{16}$/, "Must be a 16-character hex string");

/** UUID v4 format */
export const uuidSchema = z.string().uuid();

/** Latitude: -90 to 90, finite */
export const latitudeSchema = z.number().min(-90).max(90).finite();

/** Longitude: -180 to 180, finite */
export const longitudeSchema = z.number().min(-180).max(180).finite();

// ─── Edge Function Schemas ──────────────────────────────────────────

/** send-wave: wave or undo */
export const sendWaveSchema = z.object({
  target_ephemeral_token: ephemeralTokenSchema,
  action: z.enum(["undo"]).nullish(),
});

/** assign-ephemeral-id: no body required */
export const assignEphemeralIdSchema = z.object({}).optional();

/** update-location: lat/lng coordinates */
export const updateLocationSchema = z.object({
  latitude: latitudeSchema,
  longitude: longitudeSchema,
});

/** remove-match: match ID */
export const removeMatchSchema = z.object({
  match_id: uuidSchema,
});

/** block-user: blocked user details */
export const blockUserSchema = z.object({
  blocked_id: uuidSchema,
  display_name: z.string().max(100).nullish(),
  match_id: uuidSchema.nullish(),
  reason: z.string().max(100).nullish(),
  details: z.string().max(500).nullish(),
});

/** delete-account: no body required */
export const deleteAccountSchema = z.object({}).optional();

/** auth-instagram: OAuth code exchange */
export const authInstagramSchema = z.object({
  code: z.string().min(1, "Authorization code required"),
  redirect_uri: z.string().min(1, "Redirect URI required"),
});

// ─── Helper ─────────────────────────────────────────────────────────

/**
 * Parse and validate a request body against a Zod schema.
 * Returns { data } on success or { error } with a human-readable message.
 */
export function parseBody<T>(
  body: unknown,
  schema: z.ZodType<T>,
): { data: T; error?: never } | { data?: never; error: string } {
  const result = schema.safeParse(body);
  if (result.success) {
    return { data: result.data };
  }
  // Build a human-readable error. Guard against unexpected error shapes.
  try {
    const messages = result.error.issues.map((i) => {
      const path = i.path.length > 0 ? `${i.path.join(".")}: ` : "";
      return `${path}${i.message}`;
    });
    return { error: messages.join("; ") || "Validation failed" };
  } catch {
    return { error: "Invalid request body" };
  }
}

// Re-export z for one-off schemas in individual functions
export { z };
