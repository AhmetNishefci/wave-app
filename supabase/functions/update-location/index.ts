import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders, handleCorsPreflightIfNeeded } from "../_shared/cors.ts";
import { updateLocationSchema, parseBody } from "../_shared/validation.ts";

const adminClient = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
);

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

// ─── Localized push notification strings ─────────────────────────────
const PUSH_STRINGS: Record<string, Record<string, string>> = {
  en: { proximityTitle: "Wave 👋", proximityBody: "Wave users are in your area — open the app to discover them!" },
  de: { proximityTitle: "Wave 👋", proximityBody: "Wave-Nutzer sind in deiner Nähe — öffne die App und entdecke sie!" },
  fr: { proximityTitle: "Wave 👋", proximityBody: "Des utilisateurs Wave sont dans ton quartier — ouvre l'app pour les découvrir !" },
  es: { proximityTitle: "Wave 👋", proximityBody: "Hay usuarios de Wave en tu zona — ¡abre la app para descubrirlos!" },
  it: { proximityTitle: "Wave 👋", proximityBody: "Utenti Wave sono nella tua zona — apri l'app per scoprirli!" },
  pt: { proximityTitle: "Wave 👋", proximityBody: "Usuários Wave estão na sua área — abra o app para descobri-los!" },
  tr: { proximityTitle: "Wave 👋", proximityBody: "Bölgendeki Wave kullanıcıları var — keşfetmek için uygulamayı aç!" },
};

function getPushString(locale: string | null, key: string): string {
  const lang = locale?.substring(0, 2) ?? "en";
  return PUSH_STRINGS[lang]?.[key] ?? PUSH_STRINGS.en[key];
}

/**
 * Update Location Edge Function
 *
 * Called when a user starts BLE discovery. Updates their location
 * and sends proximity notifications to nearby Wave users.
 *
 * Body: { latitude: number, longitude: number }
 */
serve(async (req: Request) => {
  const preflightResponse = handleCorsPreflightIfNeeded(req);
  if (preflightResponse) return preflightResponse;

  try {
    // Authenticate user
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

    // Parse and validate request body with Zod
    let latitude: number;
    let longitude: number;
    try {
      const rawBody = await req.json();
      const parsed = parseBody(rawBody, updateLocationSchema);
      if (parsed.error) {
        return new Response(
          JSON.stringify({ error: parsed.error }),
          {
            status: 400,
            headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
          },
        );
      }
      latitude = parsed.data.latitude;
      longitude = parsed.data.longitude;
    } catch {
      return new Response(
        JSON.stringify({ error: "Invalid JSON body" }),
        {
          status: 400,
          headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
        },
      );
    }

    const userId = user.id;

    // Step 0: Rate limit — max 1 location update per 30 seconds per user
    const { data: lastUpdate } = await adminClient
      .from("profiles")
      .select("last_location_at")
      .eq("id", userId)
      .single();

    if (lastUpdate?.last_location_at) {
      const elapsed = Date.now() - new Date(lastUpdate.last_location_at).getTime();
      if (elapsed < 30_000) {
        return new Response(
          JSON.stringify({ error: "Rate limited", retry_after_ms: 30_000 - elapsed }),
          {
            status: 429,
            headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
          },
        );
      }
    }

    // Step 1: Update user's location
    const { error: updateError } = await adminClient
      .from("profiles")
      .update({
        last_latitude: latitude,
        last_longitude: longitude,
        last_location_at: new Date().toISOString(),
      })
      .eq("id", userId);

    if (updateError) {
      console.error("Failed to update location:", updateError);
      return new Response(
        JSON.stringify({ error: "Failed to update location" }),
        {
          status: 500,
          headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
        },
      );
    }

    // Step 2: Find nearby users to notify
    const { data: nearbyUsers, error: queryError } = await adminClient.rpc(
      "find_nearby_users",
      {
        p_user_id: userId,
        p_latitude: latitude,
        p_longitude: longitude,
        p_radius_meters: 150,
        p_max_results: 50,
      },
    );

    if (queryError) {
      console.warn("find_nearby_users error (non-fatal):", queryError);
      // Non-fatal: location was saved, just can't notify
      return new Response(
        JSON.stringify({ status: "ok", nearby_count: 0, notified_count: 0 }),
        {
          status: 200,
          headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
        },
      );
    }

    const nearbyCount = nearbyUsers?.length ?? 0;

    if (nearbyCount === 0) {
      return new Response(
        JSON.stringify({ status: "ok", nearby_count: 0, notified_count: 0 }),
        {
          status: 200,
          headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
        },
      );
    }

    // Step 3: Fetch locales for nearby users to send localized push messages
    const nearbyUserIds = nearbyUsers!.map((u: any) => u.user_id);
    const localeMap: Record<string, string | null> = {};
    if (nearbyUserIds.length > 0) {
      try {
        const { data: localeRows } = await adminClient
          .from("profiles")
          .select("id, locale")
          .in("id", nearbyUserIds);
        for (const row of localeRows ?? []) {
          localeMap[row.id] = row.locale ?? null;
        }
      } catch {
        // Non-fatal — fall back to English for all
      }
    }

    // Step 4: Send push notifications
    // Build messages with user_id attached for accurate cooldown tracking
    const pushMessages = nearbyUsers!.map(
      (u: { user_id: string; push_token: string; platform: string }) => ({
        to: u.push_token,
        sound: "default",
        title: getPushString(localeMap[u.user_id] ?? null, "proximityTitle"),
        body: getPushString(localeMap[u.user_id] ?? null, "proximityBody"),
        data: { type: "proximity_alert" },
        priority: "high" as const,
        _userId: u.user_id, // internal tracking, stripped before sending
      }),
    );

    // Batch in chunks of 100 (Expo Push API limit)
    const notifiedUserIds: string[] = [];
    const invalidTokens: string[] = [];

    for (let i = 0; i < pushMessages.length; i += 100) {
      const batch = pushMessages.slice(i, i + 100);
      // Strip internal _userId before sending to Expo
      const expoBatch = batch.map(({ _userId, ...msg }) => msg);

      try {
        const pushResponse = await fetch(EXPO_PUSH_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify(expoBatch),
        });

        if (pushResponse.ok) {
          const pushData = await pushResponse.json();

          // Check each ticket against the corresponding user
          if (pushData.data && Array.isArray(pushData.data)) {
            for (let j = 0; j < pushData.data.length; j++) {
              const ticket = pushData.data[j];
              if (
                ticket.status === "error" &&
                ticket.details?.error === "DeviceNotRegistered"
              ) {
                invalidTokens.push(batch[j].to);
              } else if (ticket.status === "ok") {
                notifiedUserIds.push(batch[j]._userId);
              }
            }
          }
        } else {
          console.error("Expo Push API error:", pushResponse.status);
        }
      } catch (pushErr) {
        console.error("Push send error:", pushErr);
      }
    }

    // Step 5: Record notifications for cooldown tracking
    // Only record for users whose push actually succeeded
    if (notifiedUserIds.length > 0) {
      const notifRecords = notifiedUserIds.map((uid) => ({
        user_id: uid,
        triggered_by: userId,
      }));

      const { error: insertError } = await adminClient
        .from("proximity_notifications")
        .insert(notifRecords);

      if (insertError) {
        console.warn("Failed to record notifications (non-fatal):", insertError);
        // Non-fatal
      }
    }

    // Step 6: Clean up invalid push tokens
    if (invalidTokens.length > 0) {
      await adminClient
        .from("push_tokens")
        .delete()
        .in("token", invalidTokens);

      console.log(`Cleaned up ${invalidTokens.length} invalid push tokens`);
    }

    const notifiedCount = notifiedUserIds.length;

    console.log(
      `Location updated for ${userId}. Nearby: ${nearbyCount}, Notified: ${notifiedCount}`,
    );

    return new Response(
      JSON.stringify({
        status: "ok",
        nearby_count: nearbyCount,
        notified_count: notifiedCount,
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
