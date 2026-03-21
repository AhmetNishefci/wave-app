import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders, handleCorsPreflightIfNeeded } from "../_shared/cors.ts";

// Module-level singleton to reuse across warm invocations
const adminClient = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
);

serve(async (req: Request) => {
  // Handle CORS preflight
  const preflightResponse = handleCorsPreflightIfNeeded(req);
  if (preflightResponse) return preflightResponse;

  try {
    // Create Supabase client with the user's JWT
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing Authorization header" }), {
        status: 401,
        headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
      });
    }

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      {
        global: {
          headers: { Authorization: authHeader },
        },
      },
    );

    // Get the authenticated user
    const {
      data: { user },
      error: authError,
    } = await supabaseClient.auth.getUser();

    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
      });
    }

    const userId = user.id;

    // Ensure profile exists (handles case where trigger hasn't fired)
    const { data: profileData, error: profileError } = await adminClient
      .from("profiles")
      .upsert(
        {
          id: userId,
          is_anonymous: user.is_anonymous ?? true,
        },
        { onConflict: "id" },
      )
      .select("gender, note, date_of_birth")
      .single();

    if (profileError) {
      console.error("Failed to ensure profile:", profileError);
      return new Response(
        JSON.stringify({ error: "Failed to ensure profile", details: profileError.message }),
        {
          status: 500,
          headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
        },
      );
    }

    // Deactivate existing active tokens for this user
    await adminClient
      .from("ephemeral_ids")
      .update({ is_active: false })
      .eq("user_id", userId)
      .eq("is_active", true);

    // Generate a new random 8-byte token (16 hex characters)
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    const token = Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    // Token expires in 15 minutes
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

    // Insert new ephemeral ID. If it fails (e.g., unique constraint race
    // when two requests fire simultaneously), deactivate again and retry once.
    let data: any = null;
    const insertPayload = {
      user_id: userId,
      token,
      expires_at: expiresAt,
      is_active: true,
      note: profileData?.note ?? null,
    };

    const { data: firstAttempt, error: firstError } = await adminClient
      .from("ephemeral_ids")
      .insert(insertPayload)
      .select()
      .single();

    if (firstError) {
      // Retry: deactivate any token the concurrent request may have created, then insert again
      console.warn("Ephemeral ID insert conflict, retrying:", firstError.message);
      await adminClient
        .from("ephemeral_ids")
        .update({ is_active: false })
        .eq("user_id", userId)
        .eq("is_active", true);

      const { data: retryAttempt, error: retryError } = await adminClient
        .from("ephemeral_ids")
        .insert(insertPayload)
        .select()
        .single();

      if (retryError) {
        console.error("Failed to insert ephemeral ID after retry:", retryError);
        return new Response(
          JSON.stringify({ error: "Failed to generate token" }),
          {
            status: 500,
            headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
          },
        );
      }
      data = retryAttempt;
    } else {
      data = firstAttempt;
    }

    // Compute age from date_of_birth
    let age: number | null = null;
    if (profileData?.date_of_birth) {
      const dob = new Date(profileData.date_of_birth + "T00:00:00Z");
      const now = new Date();
      age = now.getUTCFullYear() - dob.getUTCFullYear();
      const monthDiff = now.getUTCMonth() - dob.getUTCMonth();
      if (monthDiff < 0 || (monthDiff === 0 && now.getUTCDate() < dob.getUTCDate())) {
        age--;
      }
    }

    return new Response(
      JSON.stringify({
        token: data.token,
        expires_at: data.expires_at,
        gender: profileData?.gender ?? null,
        note: profileData?.note ?? null,
        age,
      }),
      {
        status: 200,
        headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
      },
    );
  } catch (err) {
    console.error("Unexpected error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
    });
  }
});
