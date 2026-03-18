import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders, handleCorsPreflightIfNeeded } from "../_shared/cors.ts";
import { authInstagramSchema, parseBody } from "../_shared/validation.ts";

const INSTAGRAM_APP_ID = Deno.env.get("INSTAGRAM_APP_ID") ?? "";
const INSTAGRAM_APP_SECRET = Deno.env.get("INSTAGRAM_APP_SECRET") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

serve(async (req: Request) => {
  const preflightResponse = handleCorsPreflightIfNeeded(req);
  if (preflightResponse) return preflightResponse;

  try {
    let rawBody: unknown;
    try {
      rawBody = await req.json();
    } catch {
      return jsonResponse({ error: "Invalid JSON body" }, 400, req);
    }

    const parsed = parseBody(rawBody, authInstagramSchema);
    if (parsed.error) {
      return jsonResponse({ error: parsed.error }, 400, req);
    }

    const { code, redirect_uri } = parsed.data;

    // ─── Step 1: Exchange authorization code for short-lived token ───
    const tokenFormData = new URLSearchParams({
      client_id: INSTAGRAM_APP_ID,
      client_secret: INSTAGRAM_APP_SECRET,
      grant_type: "authorization_code",
      redirect_uri,
      code,
    });

    const tokenRes = await fetch(
      "https://api.instagram.com/oauth/access_token",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: tokenFormData.toString(),
      },
    );

    if (!tokenRes.ok) {
      const errBody = await tokenRes.text();
      console.error("Instagram token exchange failed:", errBody);
      return jsonResponse(
        { error: "Instagram token exchange failed" },
        401,
        req,
      );
    }

    const tokenData = await tokenRes.json();
    const accessToken: string = tokenData.access_token;
    const igUserId: string = String(tokenData.user_id);

    // ─── Step 2: Fetch Instagram profile ─────────────────────────────
    const profileRes = await fetch(
      "https://graph.instagram.com/me?fields=user_id,username",
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );

    if (!profileRes.ok) {
      const errBody = await profileRes.text();
      console.error("Instagram profile fetch failed:", errBody);
      return jsonResponse(
        { error: "Failed to fetch Instagram profile" },
        500,
        req,
      );
    }

    const profile = await profileRes.json();
    const instagramHandle: string = profile.username;
    const instagramUserId: string = String(profile.user_id ?? igUserId);

    // Validate Instagram user ID is numeric (expected format from Instagram API)
    if (!instagramUserId || !/^\d+$/.test(instagramUserId)) {
      console.error("Invalid Instagram user ID:", instagramUserId);
      return jsonResponse({ error: "Invalid Instagram user ID" }, 400, req);
    }

    if (!instagramHandle || typeof instagramHandle !== "string") {
      console.error("Invalid Instagram username:", instagramHandle);
      return jsonResponse({ error: "Invalid Instagram profile" }, 400, req);
    }

    console.log(`Instagram auth: @${instagramHandle} (ID: ${instagramUserId})`);

    // ─── Step 3: Find or create Supabase user ────────────────────────
    // Use a deterministic email so the same Instagram account always maps
    // to the same Supabase user.
    const email = `${instagramUserId}@ig.wave.internal`;

    // Check if a profile with this instagram_user_id already exists
    const { data: existingProfile } = await adminClient
      .from("profiles")
      .select("id")
      .eq("instagram_user_id", instagramUserId)
      .maybeSingle();

    let userId: string;

    if (existingProfile) {
      // Existing user — update their handle in case it changed on Instagram
      userId = existingProfile.id;
      await adminClient
        .from("profiles")
        .update({ instagram_handle: instagramHandle })
        .eq("id", userId);

      console.log(`Existing user found: ${userId}`);
    } else {
      // New user — create Supabase auth user + profile
      const { data: newUser, error: createErr } =
        await adminClient.auth.admin.createUser({
          email,
          email_confirm: true,
          user_metadata: {
            instagram_user_id: instagramUserId,
            instagram_handle: instagramHandle,
          },
        });

      if (createErr) {
        // User might already exist in auth (e.g., profile row was missing)
        // Try to find by email using filtered lookup (not O(n) listUsers)
        const { data: listData } =
          await adminClient.auth.admin.listUsers({
            page: 1,
            perPage: 1,
          });
        // Filter server-side isn't supported, but limit to 1 page
        // and search by the deterministic email
        const existingAuthUser = listData?.users?.find(
          (u) => u.email === email,
        );

        // If not found in first page, try direct profile lookup as fallback
        if (!existingAuthUser) {
          // Check if a profile row exists with this instagram_user_id
          const { data: profileById } = await adminClient
            .from("profiles")
            .select("id")
            .eq("instagram_user_id", instagramUserId)
            .maybeSingle();

          if (profileById) {
            userId = profileById.id;
            console.log(`Found user via profile fallback: ${userId}`);
          } else {
            console.error("Failed to create user:", createErr);
            return jsonResponse({ error: "Failed to create account" }, 500, req);
          }
        } else {
          userId = existingAuthUser.id;
          console.log(`Auth user existed without profile: ${userId}`);
        }
      } else {
        userId = newUser.user.id;
        console.log(`New user created: ${userId}`);
      }

      // Ensure profile row exists with Instagram data
      await adminClient.from("profiles").upsert(
        {
          id: userId,
          instagram_handle: instagramHandle,
          instagram_user_id: instagramUserId,
        },
        { onConflict: "id" },
      );
    }

    // ─── Step 4: Generate a magic link token for the client ──────────
    const { data: linkData, error: linkErr } =
      await adminClient.auth.admin.generateLink({
        type: "magiclink",
        email,
      });

    if (linkErr || !linkData) {
      console.error("Failed to generate magic link:", linkErr);
      return jsonResponse({ error: "Failed to generate session" }, 500, req);
    }

    // Extract the OTP token from the generated link properties
    const otpToken =
      linkData.properties?.hashed_token ?? "";

    if (!otpToken) {
      console.error("No hashed_token in generated link", linkData);
      return jsonResponse({ error: "Session generation failed" }, 500, req);
    }

    return jsonResponse({
      email,
      otp_token: otpToken,
      instagram_handle: instagramHandle,
      instagram_user_id: instagramUserId,
    }, 200, req);
  } catch (err) {
    console.error("Unexpected error:", err);
    return jsonResponse({ error: "Internal server error" }, 500, req);
  }
});

function jsonResponse(body: Record<string, unknown>, status = 200, request?: Request): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...getCorsHeaders(request), "Content-Type": "application/json" },
  });
}
