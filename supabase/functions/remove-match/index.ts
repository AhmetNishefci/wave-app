import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders, handleCorsPreflightIfNeeded } from "../_shared/cors.ts";
import { removeMatchSchema, parseBody } from "../_shared/validation.ts";
import { createLogger } from "../_shared/logger.ts";

const adminClient = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
);

serve(async (req: Request) => {
  const preflightResponse = handleCorsPreflightIfNeeded(req);
  if (preflightResponse) return preflightResponse;

  const log = createLogger("remove-match");
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
      {
        global: {
          headers: { Authorization: authHeader },
        },
      },
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

    log.setUserId(user.id);

    // Parse and validate request body with Zod
    let match_id: string;
    try {
      const rawBody = await req.json();
      const parsed = parseBody(rawBody, removeMatchSchema);
      if (parsed.error) {
        return new Response(
          JSON.stringify({ error: parsed.error }),
          {
            status: 400,
            headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
          },
        );
      }
      match_id = parsed.data.match_id;
    } catch {
      return new Response(
        JSON.stringify({ error: "Invalid JSON body" }),
        {
          status: 400,
          headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
        },
      );
    }

    // Call the SQL function to delete the match
    const { data, error: rpcError } = await adminClient.rpc("remove_match", {
      p_user_id: user.id,
      p_match_id: match_id,
    });

    if (rpcError) {
      log.error("RPC error", { error: rpcError.message });
      return new Response(JSON.stringify({ error: "Failed to remove match" }), {
        status: 500,
        headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
      });
    }

    const result = data as { status: string; other_user_id?: string; reason?: string };

    if (result.status === "error") {
      return new Response(JSON.stringify(result), {
        status: 404,
        headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
      });
    }

    // Broadcast match_removed to the other user so their client cleans up
    if (result.other_user_id) {
      try {
        const ch = adminClient.channel(`user:${result.other_user_id}`);
        await ch.send({
          type: "broadcast",
          event: "match_removed",
          payload: { match_id },
        });
        adminClient.removeChannel(ch);
      } catch (err) {
        log.warn("match_removed broadcast failed", { error: String(err) });
        // Non-fatal — their local store will just have a stale entry
      }
    }

    return new Response(JSON.stringify({ status: "removed" }), {
      status: 200,
      headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
    });
  } catch (err) {
    log.error("Unexpected error", { error: String(err) });
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
    });
  }
});
