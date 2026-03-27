import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Cleanup Edge Function
 *
 * Calls the cleanup_expired_data() SQL function to remove:
 * - Expired ephemeral IDs (>1 hour past expiry)
 * - Consumed waves (>24 hours old)
 * - Expired unconsumed waves (>1 hour past expiry)
 *
 * Schedule this function to run hourly via:
 *   Supabase Dashboard → Edge Functions → cleanup → Schedule → "0 * * * *"
 *
 * Or invoke manually:
 *   curl -X POST https://<project-ref>.supabase.co/functions/v1/cleanup
 */
serve(async (req: Request) => {
  try {
    // Auth check: only accept service_role JWT (cron sends it via vault).
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
        JSON.stringify({ status: "error", message: "Unauthorized" }),
        { status: 401, headers: { "Content-Type": "application/json" } },
      );
    }

    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const { error } = await adminClient.rpc("cleanup_expired_data");

    if (error) {
      console.error("Cleanup failed:", error);
      return new Response(
        JSON.stringify({ status: "error", message: error.message }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }

    // Check pending Expo push receipts (sent 15+ min ago)
    let receiptsChecked = 0;
    let invalidTokensCleaned = 0;
    try {
      const { data: pendingReceipts } = await adminClient
        .from("push_receipts")
        .select("receipt_id, push_token")
        .lt("created_at", new Date(Date.now() - 15 * 60_000).toISOString())
        .limit(1000);

      if (pendingReceipts && pendingReceipts.length > 0) {
        // Expo receipts API accepts up to 1000 IDs per request
        const receiptIds = pendingReceipts.map((r: { receipt_id: string }) => r.receipt_id);
        const receiptRes = await fetch("https://exp.host/--/api/v2/push/getReceipts", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({ ids: receiptIds }),
        });

        if (receiptRes.ok) {
          const receiptData = await receiptRes.json();
          const receipts = receiptData.data ?? {};
          const tokensToDelete: string[] = [];

          for (const pr of pendingReceipts) {
            const receipt = receipts[pr.receipt_id];
            if (
              receipt?.status === "error" &&
              receipt?.details?.error === "DeviceNotRegistered"
            ) {
              tokensToDelete.push(pr.push_token);
            }
          }

          if (tokensToDelete.length > 0) {
            await adminClient
              .from("push_tokens")
              .delete()
              .in("token", tokensToDelete);
            invalidTokensCleaned = tokensToDelete.length;
            console.log(`Receipt check: cleaned ${tokensToDelete.length} invalid tokens`);
          }

          receiptsChecked = pendingReceipts.length;
        }

        // Delete checked receipts regardless of result
        await adminClient
          .from("push_receipts")
          .delete()
          .in("receipt_id", receiptIds);
      }
    } catch (receiptErr) {
      console.warn("Receipt check failed (non-fatal):", receiptErr);
    }

    console.log("Cleanup completed successfully");
    return new Response(
      JSON.stringify({
        status: "ok",
        cleaned_at: new Date().toISOString(),
        receipts_checked: receiptsChecked,
        invalid_tokens_cleaned: invalidTokensCleaned,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("Cleanup unexpected error:", err);
    return new Response(
      JSON.stringify({ status: "error", message: "Internal error" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});
