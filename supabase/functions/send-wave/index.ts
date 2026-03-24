import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders, handleCorsPreflightIfNeeded } from "../_shared/cors.ts";
import { sendWaveSchema, parseBody } from "../_shared/validation.ts";

// Module-level singleton to reuse across warm invocations
const adminClient = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
);

// ─── Localized push notification strings ─────────────────────────────
const PUSH_STRINGS: Record<string, Record<string, string>> = {
  en: {
    matchTitle: "It's a Match! 🎉",
    matchBody: "Someone waved back! Open Wave to see who.",
    waveTitle: "Someone waved at you! 👋",
    waveBody: "Open Wave to wave back",
    waveBodyWithNote: "\"{{note}}\" waved at you — open Wave to wave back",
  },
  de: {
    matchTitle: "Es ist ein Match! 🎉",
    matchBody: "Jemand hat zurückgewaved! Öffne Wave um zu sehen wer.",
    waveTitle: "Jemand hat dir zugewaved! 👋",
    waveBody: "Öffne Wave und wave zurück",
    waveBodyWithNote: "\"{{note}}\" hat dir gewaved — öffne Wave und wave zurück",
  },
  fr: {
    matchTitle: "C'est un Match ! 🎉",
    matchBody: "Quelqu'un t'a wavé en retour ! Ouvre Wave pour voir qui.",
    waveTitle: "Quelqu'un t'a wavé ! 👋",
    waveBody: "Ouvre Wave pour waver en retour",
    waveBodyWithNote: "\"{{note}}\" t'a wavé — ouvre Wave pour waver en retour",
  },
  es: {
    matchTitle: "¡Es un Match! 🎉",
    matchBody: "¡Alguien te devolvió el wave! Abre Wave para ver quién.",
    waveTitle: "¡Alguien te hizo wave! 👋",
    waveBody: "Abre Wave para devolver el wave",
    waveBodyWithNote: "\"{{note}}\" te hizo wave — abre Wave para responder",
  },
  it: {
    matchTitle: "È un Match! 🎉",
    matchBody: "Qualcuno ha ricambiato il wave! Apri Wave per scoprire chi.",
    waveTitle: "Qualcuno ti ha wavato! 👋",
    waveBody: "Apri Wave per ricambiare",
    waveBodyWithNote: "\"{{note}}\" ti ha wavato — apri Wave per ricambiare",
  },
  pt: {
    matchTitle: "É um Match! 🎉",
    matchBody: "Alguém retribuiu seu wave! Abra o Wave pra ver quem.",
    waveTitle: "Alguém te mandou um wave! 👋",
    waveBody: "Abra o Wave pra retribuir",
    waveBodyWithNote: "\"{{note}}\" te mandou um wave — abra o Wave pra retribuir",
  },
  tr: {
    matchTitle: "Eşleşme! 🎉",
    matchBody: "Biri sana wave yaptı! Kimin olduğunu görmek için Wave'i aç.",
    waveTitle: "Biri sana wave yaptı! 👋",
    waveBody: "Wave'i aç ve karşılık ver",
    waveBodyWithNote: "\"{{note}}\" sana wave yaptı — Wave'i aç ve karşılık ver",
  },
};

function getPushString(locale: string | null, key: string): string {
  const lang = locale?.substring(0, 2) ?? "en";
  return PUSH_STRINGS[lang]?.[key] ?? PUSH_STRINGS.en[key];
}

serve(async (req: Request) => {
  const preflightResponse = handleCorsPreflightIfNeeded(req);
  if (preflightResponse) return preflightResponse;

  try {
    // Authenticate the user
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

    // Parse and validate request body with Zod (O7)
    let target_ephemeral_token: string;
    let action: "undo" | null | undefined;
    try {
      const rawBody = await req.json();
      const parsed = parseBody<{ target_ephemeral_token: string; action?: "undo" | null }>(rawBody, sendWaveSchema);
      if (parsed.error) {
        return new Response(
          JSON.stringify({ error: parsed.error }),
          {
            status: 400,
            headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
          },
        );
      }
      target_ephemeral_token = parsed.data!.target_ephemeral_token;
      action = parsed.data!.action;
    } catch {
      return new Response(
        JSON.stringify({ error: "Invalid JSON body" }),
        {
          status: 400,
          headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
        },
      );
    }

    // ─── UNDO WAVE ───────────────────────────────────────────────
    if (action === "undo") {
      // Resolve target token → user_id
      const { data: tokenRow } = await adminClient
        .from("ephemeral_ids")
        .select("user_id")
        .eq("token", target_ephemeral_token)
        .or("is_active.eq.true,expires_at.gt.now()")
        .limit(1)
        .maybeSingle();

      // Delete the wave record (only if it hasn't been consumed/matched
      // and was created within the wave lifetime — 15 minutes)
      const { data: deleted, error: delError } = await adminClient
        .from("waves")
        .delete()
        .eq("waver_user_id", user.id)
        .eq("target_ephemeral_token", target_ephemeral_token)
        .eq("is_consumed", false)
        .gte("created_at", new Date(Date.now() - 15 * 60_000).toISOString())
        .select();

      if (delError) {
        console.error("Undo wave delete error:", delError);
        return new Response(JSON.stringify({ status: "error" }), {
          status: 500,
          headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
        });
      }

      if (!deleted || deleted.length === 0) {
        return new Response(JSON.stringify({ status: "error", reason: "undo_expired" }), {
          status: 400,
          headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
        });
      }

      // Broadcast wave_undo to the target user so they remove the waver token
      if (tokenRow?.user_id) {
        // Look up the waver's active ephemeral token
        let waverToken: string | null = null;
        try {
          const { data: waverRow } = await adminClient
            .from("ephemeral_ids")
            .select("token")
            .eq("user_id", user.id)
            .eq("is_active", true)
            .limit(1)
            .maybeSingle();
          waverToken = waverRow?.token ?? null;
        } catch (err) {
          console.error("Failed to look up waver token for undo:", err);
        }

        try {
          const ch = adminClient.channel(`user:${tokenRow.user_id}`);
          await ch.send({
            type: "broadcast",
            event: "wave_undo",
            payload: { waver_token: waverToken },
          });
          adminClient.removeChannel(ch);
        } catch (err) {
          console.error("wave_undo broadcast failed:", err);
        }
      }

      return new Response(JSON.stringify({ status: "undone" }), {
        status: 200,
        headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
      });
    }

    // ─── SEND WAVE ───────────────────────────────────────────────
    // Call the matching function
    const { data, error: rpcError } = await adminClient.rpc(
      "check_and_create_match",
      {
        p_waver_id: user.id,
        p_target_token: target_ephemeral_token,
      },
    );

    if (rpcError) {
      console.error("RPC error:", rpcError);
      return new Response(JSON.stringify({ error: "Match check failed" }), {
        status: 500,
        headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
      });
    }

    const result = data as {
      status: string;
      match_id?: string;
      matched_user_id?: string;
      target_user_id?: string;
      reason?: string;
    };

    // ─── PENDING WAVE → notify target anonymously ────────────────
    if (result.status === "pending") {
      // Resolve target token → user_id so we can broadcast
      let targetUserId = result.target_user_id;
      if (!targetUserId) {
        const { data: tokenRow } = await adminClient
          .from("ephemeral_ids")
          .select("user_id")
          .eq("token", target_ephemeral_token)
          .or("is_active.eq.true,expires_at.gt.now()")
          .limit(1)
          .maybeSingle();
        targetUserId = tokenRow?.user_id;
      }

      if (targetUserId) {
        // Look up the waver's active ephemeral token + note so the target
        // knows which radar peer waved at them and sees context in the push
        let waverToken: string | null = null;
        let waverNote: string | null = null;
        try {
          const { data: waverRow } = await adminClient
            .from("ephemeral_ids")
            .select("token, note")
            .eq("user_id", user.id)
            .eq("is_active", true)
            .limit(1)
            .maybeSingle();
          waverToken = waverRow?.token ?? null;
          waverNote = waverRow?.note ?? null;
        } catch (err) {
          console.error("Failed to look up waver token:", err);
        }

        // Check mutual preferences before notifying — suppress notification if
        // the target user's preferences would exclude the waver from their radar.
        // The wave record still exists (for future matching if preferences change).
        const [waverProfileRes, targetProfileRes] = await Promise.all([
          adminClient
            .from("profiles")
            .select("gender, date_of_birth, gender_preference, age_preference_min, age_preference_max")
            .eq("id", user.id)
            .maybeSingle(),
          adminClient
            .from("profiles")
            .select("gender, date_of_birth, gender_preference, age_preference_min, age_preference_max, locale")
            .eq("id", targetUserId)
            .maybeSingle(),
        ]);

        const waverProfile = waverProfileRes.data;
        const targetProfile = targetProfileRes.data;
        const shouldNotify = checkMutualPreferences(waverProfile, targetProfile);

        if (!shouldNotify) {
          console.log(`Wave notification suppressed (preference mismatch): ${user.id} → ${targetUserId}`);
        }

        if (shouldNotify) {
          try {
            const ch = adminClient.channel(`user:${targetUserId}`);
            await ch.send({
              type: "broadcast",
              event: "wave",
              payload: { t: Date.now(), waver_token: waverToken },
            });
            adminClient.removeChannel(ch);
          } catch (err) {
            console.error("Wave broadcast to target failed:", err);
          }

          const targetLocale = targetProfile?.locale ?? null;

          // Send push notification to target user — include waver's note for context
          const pushBody = waverNote
            ? getPushString(targetLocale, "waveBodyWithNote").replace("{{note}}", waverNote)
            : getPushString(targetLocale, "waveBody");

          await sendExpoPush(adminClient, targetUserId, {
            title: getPushString(targetLocale, "waveTitle"),
            body: pushBody,
            data: { type: "wave" },
          });
        }
      }
    }

    // ─── MATCH → broadcast + push ───────────────────────────────
    let matchedInstagramHandle: string | null = null;
    let matchedSnapchatHandle: string | null = null;

    if (result.status === "match" && result.matched_user_id) {
      // Look up contact handles and locales for both users
      const { data: profiles } = await adminClient
        .from("profiles")
        .select("id, instagram_handle, snapchat_handle, locale")
        .in("id", [user.id, result.matched_user_id]);

      const waverHandle =
        profiles?.find((p: any) => p.id === user.id)?.instagram_handle ?? null;
      matchedInstagramHandle =
        profiles?.find((p: any) => p.id === result.matched_user_id)
          ?.instagram_handle ?? null;
      matchedSnapchatHandle =
        profiles?.find((p: any) => p.id === result.matched_user_id)
          ?.snapchat_handle ?? null;

      const matchPayload = {
        match_id: result.match_id,
        created_at: new Date().toISOString(),
      };

      // Broadcast match event to the OTHER user only
      // (the waver already gets the match from the HTTP response)
      // NOTE: instagram_handle is intentionally excluded from broadcast payload
      // to prevent channel eavesdropping. Clients fetch handles via authenticated RPC.
      const matchCh = adminClient.channel(`user:${result.matched_user_id}`);
      await matchCh.send({
        type: "broadcast",
        event: "match",
        payload: {
          ...matchPayload,
          matched_user_id: user.id,
        },
      });
      adminClient.removeChannel(matchCh);

      // Send push notification to the OTHER user
      // (the waver already gets the match from the HTTP response)
      // NOTE: instagram_handle is intentionally excluded from push payloads
      // for the same reason it's excluded from broadcast payloads (line 271) —
      // push data is stored on-device and accessible to notification extensions.
      // Clients fetch handles via authenticated RPC after opening the match.
      const matchedUserLocale =
        profiles?.find((p: any) => p.id === result.matched_user_id)?.locale ?? null;
      const waverLocale =
        profiles?.find((p: any) => p.id === user.id)?.locale ?? null;

      await sendExpoPush(adminClient, result.matched_user_id, {
        title: getPushString(matchedUserLocale, "matchTitle"),
        body: getPushString(matchedUserLocale, "matchBody"),
        data: {
          type: "match",
          match_id: result.match_id,
          matched_user_id: user.id,
          created_at: matchPayload.created_at,
        },
      });

      // Also push the waver (in case they backgrounded the app)
      await sendExpoPush(adminClient, user.id, {
        title: getPushString(waverLocale, "matchTitle"),
        body: getPushString(waverLocale, "matchBody"),
        data: {
          type: "match",
          match_id: result.match_id,
          matched_user_id: result.matched_user_id,
          created_at: matchPayload.created_at,
        },
      });
    }

    // ─── ALREADY MATCHED → return handles so client can re-populate ──
    if (result.status === "already_matched" && result.matched_user_id) {
      const { data: profile } = await adminClient
        .from("profiles")
        .select("instagram_handle, snapchat_handle")
        .eq("id", result.matched_user_id)
        .single();

      matchedInstagramHandle = profile?.instagram_handle ?? null;
      matchedSnapchatHandle = profile?.snapchat_handle ?? null;
    }

    return new Response(JSON.stringify({
      ...result,
      ...((result.status === "match" || result.status === "already_matched")
        ? { instagram_handle: matchedInstagramHandle, snapchat_handle: matchedSnapchatHandle } : {}),
    }), {
      status: 200,
      headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Unexpected error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
    });
  }
});

// --- Expo Push Notification helper ---

/**
 * Send a push notification via Expo Push API.
 * Tokens are stored as Expo Push Tokens (ExponentPushToken[xxx]).
 */
async function sendExpoPush(
  adminClient: ReturnType<typeof createClient>,
  targetUserId: string,
  notification: {
    title: string;
    body: string;
    data?: Record<string, unknown>;
  },
): Promise<void> {
  try {
    const { data: tokenRows } = await adminClient
      .from("push_tokens")
      .select("token")
      .eq("user_id", targetUserId);

    if (!tokenRows || tokenRows.length === 0) {
      console.log(`No push token for user ${targetUserId}, skipping push`);
      return;
    }

    const messages = tokenRows.map((row: { token: string }) => ({
      to: row.token,
      title: notification.title,
      body: notification.body,
      sound: "default" as const,
      data: notification.data ?? {},
      // Set app icon badge for match notifications so the badge
      // appears even when the app is fully suspended. The client
      // corrects this to the exact unseen count when foregrounded.
      ...(notification.data?.type === "match" ? { badge: 1 } : {}),
    }));

    const response = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(messages),
    });

    if (!response.ok) {
      const body = await response.text();
      console.error(`Expo push error (${response.status}):`, body);
    } else {
      const result = await response.json();
      console.log(`Push sent to user ${targetUserId}:`, JSON.stringify(result));

      // Clean up invalid push tokens (H15 fix)
      // Expo returns per-ticket errors for invalid/uninstalled devices
      const tickets = result?.data ?? (Array.isArray(result) ? result : []);
      const tokensToDelete: string[] = [];
      for (let i = 0; i < tickets.length; i++) {
        const ticket = tickets[i];
        if (
          ticket?.status === "error" &&
          ticket?.details?.error === "DeviceNotRegistered"
        ) {
          tokensToDelete.push(messages[i].to);
        }
      }
      if (tokensToDelete.length > 0) {
        console.log(`Cleaning up ${tokensToDelete.length} invalid push tokens`);
        await adminClient
          .from("push_tokens")
          .delete()
          .in("token", tokensToDelete);
      }
    }
  } catch (err) {
    console.error(`Push notification failed for ${targetUserId}:`, err);
  }
}

/* ─── Mutual Preference Check ─────────────────────────────────── */

interface ProfilePrefs {
  gender: string | null;
  date_of_birth: string | null;
  gender_preference: string | null;
  age_preference_min: number | null;
  age_preference_max: number | null;
}

/**
 * Check if two users' preferences mutually match.
 * Returns true if both users would see each other on radar.
 * Defaults to true when data is missing (graceful degradation).
 */
function checkMutualPreferences(
  waverProfile: ProfilePrefs | null,
  targetProfile: ProfilePrefs | null,
): boolean {
  if (!waverProfile || !targetProfile) return true; // Missing data → allow

  const waverAge = getAge(waverProfile.date_of_birth);
  const targetAge = getAge(targetProfile.date_of_birth);

  // Does target's gender preference exclude the waver?
  if (
    targetProfile.gender_preference &&
    targetProfile.gender_preference !== "both" &&
    waverProfile.gender &&
    waverProfile.gender !== targetProfile.gender_preference
  ) {
    return false;
  }

  // Does waver's gender preference exclude the target?
  if (
    waverProfile.gender_preference &&
    waverProfile.gender_preference !== "both" &&
    targetProfile.gender &&
    targetProfile.gender !== waverProfile.gender_preference
  ) {
    return false;
  }

  // Does target's age preference exclude the waver?
  if (
    targetProfile.age_preference_min != null &&
    targetProfile.age_preference_max != null &&
    waverAge != null
  ) {
    if (waverAge < targetProfile.age_preference_min || waverAge > targetProfile.age_preference_max) {
      return false;
    }
  }

  // Does waver's age preference exclude the target?
  if (
    waverProfile.age_preference_min != null &&
    waverProfile.age_preference_max != null &&
    targetAge != null
  ) {
    if (targetAge < waverProfile.age_preference_min || targetAge > waverProfile.age_preference_max) {
      return false;
    }
  }

  return true;
}

function getAge(dateOfBirth: string | null): number | null {
  if (!dateOfBirth) return null;
  const dob = new Date(dateOfBirth);
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const monthDiff = now.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < dob.getDate())) {
    age--;
  }
  return age;
}
