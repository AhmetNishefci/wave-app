import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders, handleCorsPreflightIfNeeded } from "../_shared/cors.ts";
import { blockUserSchema, parseBody } from "../_shared/validation.ts";

const adminClient = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
);

/**
 * Block User Edge Function
 *
 * Blocks a user (bidirectional radar hiding + wave rejection).
 * Optionally reports them (with reason + details).
 * Removes any existing match and broadcasts match_removed.
 *
 * Body: {
 *   blocked_id: string (UUID),
 *   display_name?: string (snapshot of handle for unblock list),
 *   match_id?: string (UUID, if blocking from a match context),
 *   reason?: string (if provided, also creates a report),
 *   details?: string (optional report details)
 * }
 */
serve(async (req: Request) => {
  const preflightResponse = handleCorsPreflightIfNeeded(req);
  if (preflightResponse) return preflightResponse;

  try {
    // Authenticate
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
      { global: { headers: { Authorization: authHeader } } },
    );

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

    // Parse and validate request body with Zod
    let blocked_id: string;
    let display_name: string | null | undefined;
    let match_id: string | null | undefined;
    let reason: string | null | undefined;
    let details: string | null | undefined;

    try {
      const rawBody = await req.json();
      const parsed = parseBody(rawBody, blockUserSchema);
      if (parsed.error) {
        return new Response(JSON.stringify({ error: parsed.error }), {
          status: 400,
          headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
        });
      }
      blocked_id = parsed.data.blocked_id;
      display_name = parsed.data.display_name;
      match_id = parsed.data.match_id;
      reason = parsed.data.reason;
      details = parsed.data.details;
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
        status: 400,
        headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
      });
    }

    // Prevent self-block
    if (blocked_id === user.id) {
      return new Response(JSON.stringify({ error: "Cannot block yourself" }), {
        status: 400,
        headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
      });
    }

    // 1. Create block record (upsert to handle duplicate blocks gracefully)
    const { error: blockError } = await adminClient
      .from("blocks")
      .upsert(
        {
          blocker_id: user.id,
          blocked_id,
          blocked_display_name: display_name ?? null,
        },
        { onConflict: "blocker_id,blocked_id" },
      );

    if (blockError) {
      console.error("Failed to create block:", blockError);
      return new Response(JSON.stringify({ error: "Failed to block user" }), {
        status: 500,
        headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
      });
    }

    // 2. If reason provided, create a report record (upsert to prevent duplicates)
    if (reason) {
      const { error: reportError } = await adminClient
        .from("reports")
        .upsert(
          {
            reporter_id: user.id,
            reported_id: blocked_id,
            reason,
            details: details ?? null,
          },
          { onConflict: "reporter_id,reported_id" },
        );

      if (reportError) {
        console.error("Failed to create report:", reportError);
        // Non-fatal — block was created, report failed
      }
    }

    // 3. Remove match if exists (check both directions)
    let removedMatchId: string | null = null;
    let otherUserId: string | null = null;

    if (match_id) {
      // Use specific match ID
      const { data: match } = await adminClient
        .from("matches")
        .select("id, user_a, user_b")
        .eq("id", match_id)
        .single();

      if (match) {
        otherUserId = match.user_a === user.id ? match.user_b : match.user_a;
        await adminClient.from("matches").delete().eq("id", match_id);
        removedMatchId = match_id;
      }
    } else {
      // Find any match between the two users
      const { data: match } = await adminClient
        .from("matches")
        .select("id, user_a, user_b")
        .or(
          `and(user_a.eq.${user.id},user_b.eq.${blocked_id}),and(user_a.eq.${blocked_id},user_b.eq.${user.id})`,
        )
        .maybeSingle();

      if (match) {
        otherUserId = match.user_a === user.id ? match.user_b : match.user_a;
        await adminClient.from("matches").delete().eq("id", match.id);
        removedMatchId = match.id;
      }
    }

    // 4. Broadcast match_removed to the blocked user
    if (removedMatchId && otherUserId) {
      try {
        const ch = adminClient.channel(`user:${otherUserId}`);
        await ch.send({
          type: "broadcast",
          event: "match_removed",
          payload: { match_id: removedMatchId },
        });
        adminClient.removeChannel(ch);
      } catch (err) {
        console.error("match_removed broadcast failed:", err);
      }
    }

    console.log(`User ${user.id} blocked ${blocked_id}${reason ? ` (reported: ${reason})` : ""}`);

    return new Response(
      JSON.stringify({
        status: "blocked",
        match_removed: removedMatchId ?? null,
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
