import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders, handleCorsPreflightIfNeeded } from "../_shared/cors.ts";

const adminClient = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
);

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

/** Minimum hours between engagement pushes for the same user.
 *  Set to 24h — broad enough to also suppress after organic wave/match
 *  pushes without needing a separate tracking table. */
const ENGAGEMENT_COOLDOWN_HOURS = 24;

/** Only target users active within this many days */
const ACTIVE_WITHIN_DAYS = 7;

/** Auto-pause after N consecutive sends with no app open */
const MAX_IGNORED_SENDS = 5;

/** Target local hours (inclusive) — 6 PM to 8 PM (sends at 6, 7, 8 PM local) */
const TARGET_HOUR_START = 18;
const TARGET_HOUR_END = 20;

/** Max users per cron run to prevent edge function timeout */
const MAX_ELIGIBLE_USERS = 500;

/** Batch size for Expo Push API */
const EXPO_BATCH_SIZE = 100;

// ─── Notification content variants ─────────────────────────────────
//
// Daily engagement is a re-engagement nudge, NOT a duplicate of organic
// notifications. Waves, matches, and proximity alerts already have their
// own real-time pushes. Daily engagement content is unique and generic —
// designed to remind users to open the app during peak social hours.

interface NotificationContent {
  title: string;
  body: string;
  campaign: string;
}

/** Localized engagement messages — keyed by language code */
const WEEKDAY_VARIANTS: Record<string, NotificationContent[]> = {
  en: [
    { title: "Evening plans? ✨", body: "Wave users are most active right now", campaign: "weekday_0" },
    { title: "Who's nearby? 👋", body: "Open Wave and find out", campaign: "weekday_1" },
    { title: "Your evening check-in", body: "See who's around you on Wave", campaign: "weekday_2" },
    { title: "Peak hour on Wave 🔥", body: "More people are nearby right now than usual", campaign: "weekday_3" },
    { title: "Don't miss a connection", body: "Wave users near you are active right now", campaign: "weekday_4" },
  ],
  de: [
    { title: "Abendpläne? ✨", body: "Wave-Nutzer sind jetzt am aktivsten", campaign: "weekday_0" },
    { title: "Wer ist in der Nähe? 👋", body: "Öffne Wave und finde es heraus", campaign: "weekday_1" },
    { title: "Dein Abend-Check-in", body: "Schau wer gerade um dich herum ist", campaign: "weekday_2" },
    { title: "Stoßzeit auf Wave 🔥", body: "Mehr Leute sind gerade in der Nähe als sonst", campaign: "weekday_3" },
    { title: "Verpasse keine Verbindung", body: "Wave-Nutzer in deiner Nähe sind gerade aktiv", campaign: "weekday_4" },
  ],
  fr: [
    { title: "Des plans ce soir ? ✨", body: "Les utilisateurs Wave sont les plus actifs en ce moment", campaign: "weekday_0" },
    { title: "Qui est à proximité ? 👋", body: "Ouvre Wave pour le découvrir", campaign: "weekday_1" },
    { title: "Ton check-in du soir", body: "Regarde qui est autour de toi sur Wave", campaign: "weekday_2" },
    { title: "Heure de pointe sur Wave 🔥", body: "Plus de personnes sont à proximité en ce moment", campaign: "weekday_3" },
    { title: "Ne manque pas une connexion", body: "Des utilisateurs Wave près de toi sont actifs", campaign: "weekday_4" },
  ],
  es: [
    { title: "¿Planes para esta noche? ✨", body: "Los usuarios de Wave están más activos ahora", campaign: "weekday_0" },
    { title: "¿Quién está cerca? 👋", body: "Abre Wave y descúbrelo", campaign: "weekday_1" },
    { title: "Tu check-in de la noche", body: "Mira quién está a tu alrededor en Wave", campaign: "weekday_2" },
    { title: "Hora punta en Wave 🔥", body: "Hay más personas cerca de ti ahora", campaign: "weekday_3" },
    { title: "No te pierdas una conexión", body: "Usuarios de Wave cerca de ti están activos", campaign: "weekday_4" },
  ],
  it: [
    { title: "Piani per stasera? ✨", body: "Gli utenti Wave sono più attivi in questo momento", campaign: "weekday_0" },
    { title: "Chi c'è nei dintorni? 👋", body: "Apri Wave e scoprilo", campaign: "weekday_1" },
    { title: "Il tuo check-in serale", body: "Guarda chi c'è intorno a te su Wave", campaign: "weekday_2" },
    { title: "Ora di punta su Wave 🔥", body: "Più persone sono vicine a te ora", campaign: "weekday_3" },
    { title: "Non perdere una connessione", body: "Utenti Wave vicino a te sono attivi ora", campaign: "weekday_4" },
  ],
  pt: [
    { title: "Planos para hoje à noite? ✨", body: "Usuários do Wave estão mais ativos agora", campaign: "weekday_0" },
    { title: "Quem está por perto? 👋", body: "Abra o Wave e descubra", campaign: "weekday_1" },
    { title: "Seu check-in da noite", body: "Veja quem está ao seu redor no Wave", campaign: "weekday_2" },
    { title: "Hora de pico no Wave 🔥", body: "Mais pessoas estão por perto agora", campaign: "weekday_3" },
    { title: "Não perca uma conexão", body: "Usuários do Wave perto de você estão ativos", campaign: "weekday_4" },
  ],
  tr: [
    { title: "Akşam planların var mı? ✨", body: "Wave kullanıcıları şu an en aktif", campaign: "weekday_0" },
    { title: "Yakında kim var? 👋", body: "Wave'i aç ve öğren", campaign: "weekday_1" },
    { title: "Akşam check-in'in", body: "Wave'de etrafında kimlerin olduğunu gör", campaign: "weekday_2" },
    { title: "Wave'de yoğun saat 🔥", body: "Şu an yakınında normalden fazla insan var", campaign: "weekday_3" },
    { title: "Bir bağlantıyı kaçırma", body: "Yakınındaki Wave kullanıcıları şu an aktif", campaign: "weekday_4" },
  ],
};

const WEEKEND_VARIANTS: Record<string, NotificationContent[]> = {
  en: [
    { title: "Out and about? 👋", body: "More people are on Wave during weekends", campaign: "weekend_0" },
    { title: "Weekend vibes ☀️", body: "See who's nearby — open Wave", campaign: "weekend_1" },
    { title: "Perfect time to connect 💫", body: "People near you are on Wave right now", campaign: "weekend_2" },
  ],
  de: [
    { title: "Unterwegs? 👋", body: "Am Wochenende sind mehr Leute auf Wave", campaign: "weekend_0" },
    { title: "Wochenend-Vibes ☀️", body: "Schau wer in der Nähe ist — öffne Wave", campaign: "weekend_1" },
    { title: "Perfekte Zeit zum Verbinden 💫", body: "Leute in deiner Nähe sind gerade auf Wave", campaign: "weekend_2" },
  ],
  fr: [
    { title: "En balade ? 👋", body: "Plus de monde est sur Wave le week-end", campaign: "weekend_0" },
    { title: "Vibes du week-end ☀️", body: "Regarde qui est à proximité — ouvre Wave", campaign: "weekend_1" },
    { title: "Le moment idéal pour connecter 💫", body: "Des gens près de toi sont sur Wave maintenant", campaign: "weekend_2" },
  ],
  es: [
    { title: "¿De paseo? 👋", body: "Más personas usan Wave los fines de semana", campaign: "weekend_0" },
    { title: "Vibras de fin de semana ☀️", body: "Mira quién está cerca — abre Wave", campaign: "weekend_1" },
    { title: "Momento perfecto para conectar 💫", body: "Personas cerca de ti están en Wave ahora", campaign: "weekend_2" },
  ],
  it: [
    { title: "In giro? 👋", body: "Più persone usano Wave nel weekend", campaign: "weekend_0" },
    { title: "Vibes del weekend ☀️", body: "Guarda chi c'è vicino — apri Wave", campaign: "weekend_1" },
    { title: "Il momento perfetto per connettersi 💫", body: "Persone vicino a te sono su Wave ora", campaign: "weekend_2" },
  ],
  pt: [
    { title: "Passeando? 👋", body: "Mais pessoas usam o Wave nos fins de semana", campaign: "weekend_0" },
    { title: "Vibes de fim de semana ☀️", body: "Veja quem está por perto — abra o Wave", campaign: "weekend_1" },
    { title: "Momento perfeito para conectar 💫", body: "Pessoas perto de você estão no Wave agora", campaign: "weekend_2" },
  ],
  tr: [
    { title: "Dışarıda mısın? 👋", body: "Hafta sonları Wave'de daha fazla kişi var", campaign: "weekend_0" },
    { title: "Hafta sonu havası ☀️", body: "Yakında kim var bak — Wave'i aç", campaign: "weekend_1" },
    { title: "Bağlantı kurmak için harika zaman 💫", body: "Yakınındaki insanlar şu an Wave'de", campaign: "weekend_2" },
  ],
};

function pickContent(user: EligibleUser): NotificationContent {
  const lang = user.locale?.substring(0, 2) ?? "en";

  if (user.is_local_weekend) {
    const variants = WEEKEND_VARIANTS[lang] ?? WEEKEND_VARIANTS.en;
    const weekendIndex = user.local_dow === 0 ? 0 : 1;
    return variants[weekendIndex % variants.length];
  }

  const variants = WEEKDAY_VARIANTS[lang] ?? WEEKDAY_VARIANTS.en;
  const dayIndex = user.local_dow >= 1 && user.local_dow <= 5 ? user.local_dow - 1 : 0;
  return variants[dayIndex];
}

// ─── Types ─────────────────────────────────────────────────────────

interface EligibleUser {
  user_id: string;
  push_token: string;
  is_local_weekend: boolean;
  local_dow: number; // 0=Sun, 1=Mon, ..., 6=Sat
  locale?: string | null;
}

/**
 * Daily Engagement Edge Function
 *
 * Called hourly by pg_cron. For each invocation:
 * 1. Find users whose local time is in the target window (6-9 PM)
 * 2. Filter by activity, cooldowns, and preferences
 * 3. Pick contextual notification content per user
 * 4. Batch send via Expo Push API
 * 5. Record sends for cooldown tracking
 */
serve(async (req: Request) => {
  const preflightResponse = handleCorsPreflightIfNeeded(req);
  if (preflightResponse) return preflightResponse;

  try {
    // Auth check: only accept service_role JWT (cron sends it via vault).
    // Decodes the JWT payload to check the role claim instead of comparing
    // raw key strings — immune to mismatches between vault and runtime env.
    const authHeader = req.headers.get("Authorization");
    const jwt = authHeader?.replace("Bearer ", "") ?? "";
    let role = "";
    try {
      const payload = JSON.parse(atob(jwt.split(".")[1]));
      role = payload.role ?? "";
    } catch {
      // malformed JWT
    }
    if (role !== "service_role") {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        {
          status: 401,
          headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
        },
      );
    }

    const startTime = Date.now();

    // Step 1: Find eligible users
    const { data: eligible, error: queryError } = await adminClient.rpc(
      "get_engagement_eligible_users",
      {
        p_target_hour_start: TARGET_HOUR_START,
        p_target_hour_end: TARGET_HOUR_END,
        p_active_within_days: ACTIVE_WITHIN_DAYS,
        p_engagement_cooldown_hours: ENGAGEMENT_COOLDOWN_HOURS,
        p_max_ignored_sends: MAX_IGNORED_SENDS,
        p_max_results: MAX_ELIGIBLE_USERS,
      },
    );

    if (queryError) {
      console.error("Failed to query eligible users:", queryError);
      return new Response(
        JSON.stringify({ error: "Query failed", detail: queryError.message }),
        {
          status: 500,
          headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
        },
      );
    }

    const users: EligibleUser[] = eligible ?? [];

    // Fetch locale for each eligible user to send localized notifications
    if (users.length > 0) {
      const userIds = users.map((u) => u.user_id);
      const { data: localeRows } = await adminClient
        .from("profiles")
        .select("id, locale")
        .in("id", userIds);
      if (localeRows) {
        const localeMap = new Map(localeRows.map((r: any) => [r.id, r.locale]));
        for (const user of users) {
          user.locale = localeMap.get(user.user_id) ?? null;
        }
      }
    }

    if (users.length === 0) {
      console.log("No eligible users for engagement push this hour");
      return new Response(
        JSON.stringify({ status: "ok", eligible: 0, sent: 0 }),
        {
          status: 200,
          headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
        },
      );
    }

    console.log(`Found ${users.length} eligible users for engagement push`);

    // Step 2: Build messages with contextual content
    const messages: {
      to: string;
      title: string;
      body: string;
      sound: "default";
      data: Record<string, unknown>;
      priority: "high";
      _userId: string;
      _campaign: string;
    }[] = [];

    for (const user of users) {
      const content = pickContent(user);
      messages.push({
        to: user.push_token,
        title: content.title,
        body: content.body,
        sound: "default",
        data: { type: "engagement" },
        priority: "high",
        _userId: user.user_id,
        _campaign: content.campaign,
      });
    }

    // Step 3: Batch send via Expo Push API
    const sentRecords: { user_id: string; campaign: string }[] = [];
    const invalidTokens: string[] = [];
    const receiptRecords: { receipt_id: string; push_token: string }[] = [];

    for (let i = 0; i < messages.length; i += EXPO_BATCH_SIZE) {
      const batch = messages.slice(i, i + EXPO_BATCH_SIZE);
      const expoBatch = batch.map(
        ({ _userId, _campaign, ...msg }) => msg,
      );

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

          if (pushData.data && Array.isArray(pushData.data)) {
            for (let j = 0; j < pushData.data.length; j++) {
              const ticket = pushData.data[j];
              if (
                ticket.status === "error" &&
                ticket.details?.error === "DeviceNotRegistered"
              ) {
                invalidTokens.push(batch[j].to);
              } else if (ticket.status === "ok") {
                sentRecords.push({
                  user_id: batch[j]._userId,
                  campaign: batch[j]._campaign,
                });
                if (ticket.id) {
                  receiptRecords.push({
                    receipt_id: ticket.id,
                    push_token: batch[j].to,
                  });
                }
              }
            }
          }
        } else {
          console.error(
            `Expo Push API error (${pushResponse.status}):`,
            await pushResponse.text(),
          );
        }
      } catch (pushErr) {
        console.error("Push send error:", pushErr);
      }
    }

    // Step 4: Record successful sends for cooldown tracking
    if (sentRecords.length > 0) {
      const { error: insertError } = await adminClient
        .from("engagement_notifications")
        .insert(sentRecords);

      if (insertError) {
        console.warn("Failed to record engagement sends (non-fatal):", insertError);
      }
    }

    // Step 5: Clean up invalid push tokens
    if (invalidTokens.length > 0) {
      await adminClient
        .from("push_tokens")
        .delete()
        .in("token", invalidTokens);

      console.log(`Cleaned up ${invalidTokens.length} invalid push tokens`);
    }

    // Store receipt IDs for deferred checking (cleanup cron verifies ~1 hour later)
    if (receiptRecords.length > 0) {
      const { error: receiptError } = await adminClient
        .from("push_receipts")
        .insert(receiptRecords);

      if (receiptError) {
        console.error("Failed to store push receipts:", receiptError);
      } else {
        console.log(`Stored ${receiptRecords.length} push receipt IDs for deferred checking`);
      }
    }

    const elapsed = Date.now() - startTime;
    console.log(
      `Engagement push complete: ${sentRecords.length}/${users.length} sent in ${elapsed}ms`,
    );

    return new Response(
      JSON.stringify({
        status: "ok",
        eligible: users.length,
        sent: sentRecords.length,
        invalid_tokens: invalidTokens.length,
        elapsed_ms: elapsed,
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
