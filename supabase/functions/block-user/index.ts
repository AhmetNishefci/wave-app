import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders, handleCorsPreflightIfNeeded } from "../_shared/cors.ts";
import { blockUserSchema, parseBody } from "../_shared/validation.ts";
import { createLogger } from "../_shared/logger.ts";

const adminClient = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
);

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const SUPPORT_EMAIL = Deno.env.get("SUPPORT_EMAIL") ?? "support@wavenearby.com";
const REPORT_THRESHOLD = 3;
const log = createLogger("block-user");

/**
 * Block User Edge Function
 *
 * Blocks a user (bidirectional radar hiding + wave rejection).
 * Optionally reports them (with reason + details).
 * Removes any existing match and broadcasts match_removed.
 * When a report is created, sends notification emails:
 *   - Admin: report details for review
 *   - Admin (urgent): when a user reaches the report threshold
 *   - Reporter: acknowledgment that the report was received
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

    log.setUserId(user.id);

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
      log.error("Failed to create block", { error: blockError.message });
      return new Response(JSON.stringify({ error: "Failed to block user" }), {
        status: 500,
        headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
      });
    }

    // 2. If reason provided, create a report record (upsert to prevent duplicates)
    let reportCreated = false;
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
        log.warn("Failed to create report", { error: reportError.message });
        // Non-fatal — block was created, report failed
      } else {
        reportCreated = true;
      }
    }

    // 2b. Send report notification emails (non-fatal)
    if (reportCreated) {
      try {
        await sendReportEmails(user, blocked_id, reason!, details ?? null);
      } catch (err) {
        log.warn("Report email error", { error: String(err) });
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
        log.warn("match_removed broadcast failed", { error: String(err) });
      }
    }

    log.result(200, { blocked_id, reported: !!reason, match_removed: !!match_id });

    return new Response(
      JSON.stringify({
        status: "blocked",
        match_removed: removedMatchId ?? null,
        report_created: reportCreated,
      }),
      {
        status: 200,
        headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
      },
    );
  } catch (err) {
    log.error("Unexpected error", { error: String(err) });
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
    });
  }
});

/* ─── Report Email Helpers ────────────────────────────────────── */

const REASON_LABELS: Record<string, string> = {
  harassment: "Harassment",
  inappropriate: "Inappropriate Content",
  spam: "Spam",
  other: "Other",
};

interface UserInfo {
  id: string;
  email?: string | null;
  phone?: string | null;
}

interface ProfileInfo {
  instagram_handle: string | null;
  snapchat_handle: string | null;
}

/**
 * Send report notification emails after a report is created.
 * Non-fatal — caller wraps in try/catch.
 *
 * Sends up to 3 emails:
 * 1. Admin notification (always)
 * 2. Threshold alert if reported user hits exactly REPORT_THRESHOLD unique reports
 * 3. Reporter acknowledgment if they have an email address
 */
async function sendReportEmails(
  reporter: UserInfo,
  reportedId: string,
  reason: string,
  details: string | null,
): Promise<void> {
  if (!RESEND_API_KEY) {
    log.warn("RESEND_API_KEY not set, skipping report emails");
    return;
  }

  // Fetch both profiles and report count in parallel
  const [reporterProfileRes, reportedProfileRes, reportCountRes] = await Promise.all([
    adminClient
      .from("profiles")
      .select("instagram_handle, snapchat_handle")
      .eq("id", reporter.id)
      .maybeSingle(),
    adminClient
      .from("profiles")
      .select("instagram_handle, snapchat_handle")
      .eq("id", reportedId)
      .maybeSingle(),
    adminClient
      .from("reports")
      .select("*", { count: "exact", head: true })
      .eq("reported_id", reportedId),
  ]);

  const reporterProfile: ProfileInfo | null = reporterProfileRes.data;
  const reportedProfile: ProfileInfo | null = reportedProfileRes.data;
  const reportCount = reportCountRes.count ?? 1;

  const reporterLabel = getDisplayLabel(reporter, reporterProfile);
  const reportedLabel = getDisplayLabel({ id: reportedId }, reportedProfile);
  const reasonLabel = REASON_LABELS[reason] ?? reason;

  // 1. Admin notification
  await sendEmail(
    SUPPORT_EMAIL,
    `[Wave Report] ${reasonLabel} — ${reporterLabel} reported ${reportedLabel}`,
    buildAdminReportHtml(reporter, reporterProfile, reportedId, reportedProfile, reasonLabel, details, reportCount),
  );

  // 2. Threshold alert (fires exactly once, at the threshold)
  if (reportCount === REPORT_THRESHOLD) {
    await sendEmail(
      SUPPORT_EMAIL,
      `[Wave URGENT] ${reportedLabel} has ${reportCount} reports — action needed`,
      buildThresholdAlertHtml(reportedId, reportedProfile, reportCount),
    );
  }

  // 3. Reporter acknowledgment
  // TODO: Requires verified domain in Resend to send to arbitrary emails.
  // While using onboarding@resend.dev (sandbox), this will only work for the account owner's email.
  if (reporter.email) {
    await sendEmail(
      reporter.email,
      "We received your report — Wave",
      buildReporterAckHtml(reasonLabel),
      SUPPORT_EMAIL, // reply-to support so user can reply
    );
  }
}

function getDisplayLabel(
  user: { id: string; email?: string | null; phone?: string | null },
  profile: ProfileInfo | null,
): string {
  if (profile?.instagram_handle) return `@${profile.instagram_handle}`;
  if (profile?.snapchat_handle) return profile.snapchat_handle;
  if (user.email) return user.email;
  if (user.phone) return user.phone;
  return user.id.substring(0, 8);
}

async function sendEmail(
  to: string,
  subject: string,
  html: string,
  replyTo?: string,
): Promise<void> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "Wave <support@wavenearby.com>",
      to: [to],
      reply_to: replyTo ? [replyTo] : undefined,
      subject,
      html,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    log.error("Resend API error", { status: res.status, body });
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* ─── Email Templates ─────────────────────────────────────────── */

function buildAdminReportHtml(
  reporter: UserInfo,
  reporterProfile: ProfileInfo | null,
  reportedId: string,
  reportedProfile: ProfileInfo | null,
  reasonLabel: string,
  details: string | null,
  reportCount: number,
): string {
  const reporterIg = reporterProfile?.instagram_handle ? `@${reporterProfile.instagram_handle}` : "—";
  const reporterSc = reporterProfile?.snapchat_handle ?? "—";
  const reportedIg = reportedProfile?.instagram_handle ? `@${reportedProfile.instagram_handle}` : "—";
  const reportedSc = reportedProfile?.snapchat_handle ?? "—";
  const reporterAuth = reporter.email ?? reporter.phone ?? "—";

  const countBadge = reportCount >= REPORT_THRESHOLD
    ? `<span style="background: #dc2626; color: white; padding: 2px 8px; border-radius: 12px; font-size: 12px; font-weight: 600;">${reportCount} reports</span>`
    : `<span style="background: #e5e7eb; color: #374151; padding: 2px 8px; border-radius: 12px; font-size: 12px;">${reportCount} ${reportCount === 1 ? "report" : "reports"}</span>`;

  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <h2 style="color: #dc2626; margin-bottom: 4px;">User Report</h2>
      <p style="color: #6b7280; margin-top: 0; margin-bottom: 24px;">Reason: <strong>${escapeHtml(reasonLabel)}</strong></p>

      <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
        <tr>
          <td colspan="2" style="padding: 10px 12px; background: #fef2f2; font-weight: 600; color: #991b1b; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px;">Reported User</td>
        </tr>
        <tr>
          <td style="padding: 8px 12px; background: #f5f5f5; font-weight: 600; width: 140px;">User ID</td>
          <td style="padding: 8px 12px; font-family: monospace; font-size: 13px;">${reportedId} ${countBadge}</td>
        </tr>
        <tr>
          <td style="padding: 8px 12px; background: #f5f5f5; font-weight: 600;">Instagram</td>
          <td style="padding: 8px 12px;">${reportedIg}</td>
        </tr>
        <tr>
          <td style="padding: 8px 12px; background: #f5f5f5; font-weight: 600;">Snapchat</td>
          <td style="padding: 8px 12px;">${reportedSc}</td>
        </tr>
        <tr>
          <td colspan="2" style="padding: 10px 12px; background: #f0f9ff; font-weight: 600; color: #1e40af; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px;">Reporter</td>
        </tr>
        <tr>
          <td style="padding: 8px 12px; background: #f5f5f5; font-weight: 600;">User ID</td>
          <td style="padding: 8px 12px; font-family: monospace; font-size: 13px;">${reporter.id}</td>
        </tr>
        <tr>
          <td style="padding: 8px 12px; background: #f5f5f5; font-weight: 600;">Auth</td>
          <td style="padding: 8px 12px;">${escapeHtml(reporterAuth)}</td>
        </tr>
        <tr>
          <td style="padding: 8px 12px; background: #f5f5f5; font-weight: 600;">Instagram</td>
          <td style="padding: 8px 12px;">${reporterIg}</td>
        </tr>
        <tr>
          <td style="padding: 8px 12px; background: #f5f5f5; font-weight: 600;">Snapchat</td>
          <td style="padding: 8px 12px;">${reporterSc}</td>
        </tr>
      </table>

      ${details ? `
        <h3 style="margin-bottom: 8px;">Details</h3>
        <div style="background: #f9f9f9; border-left: 3px solid #dc2626; padding: 16px; border-radius: 4px; white-space: pre-wrap;">${escapeHtml(details)}</div>
      ` : `<p style="color: #888;">No additional details provided.</p>`}

      <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;" />
      <p style="color: #999; font-size: 12px;">
        Wave Report System &middot; ${new Date().toISOString()}
      </p>
    </div>
  `;
}

function buildThresholdAlertHtml(
  reportedId: string,
  reportedProfile: ProfileInfo | null,
  reportCount: number,
): string {
  const reportedIg = reportedProfile?.instagram_handle ? `@${reportedProfile.instagram_handle}` : "—";
  const reportedSc = reportedProfile?.snapchat_handle ?? "—";

  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background: #dc2626; color: white; padding: 16px 20px; border-radius: 8px; margin-bottom: 24px;">
        <h2 style="margin: 0 0 4px 0; font-size: 18px;">Action Needed</h2>
        <p style="margin: 0; opacity: 0.9;">A user has reached ${reportCount} reports from unique users.</p>
      </div>

      <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
        <tr>
          <td style="padding: 8px 12px; background: #f5f5f5; font-weight: 600; width: 140px;">User ID</td>
          <td style="padding: 8px 12px; font-family: monospace; font-size: 13px;">${reportedId}</td>
        </tr>
        <tr>
          <td style="padding: 8px 12px; background: #f5f5f5; font-weight: 600;">Instagram</td>
          <td style="padding: 8px 12px;">${reportedIg}</td>
        </tr>
        <tr>
          <td style="padding: 8px 12px; background: #f5f5f5; font-weight: 600;">Snapchat</td>
          <td style="padding: 8px 12px;">${reportedSc}</td>
        </tr>
        <tr>
          <td style="padding: 8px 12px; background: #f5f5f5; font-weight: 600;">Total Reports</td>
          <td style="padding: 8px 12px;"><strong style="color: #dc2626;">${reportCount}</strong> unique reporters</td>
        </tr>
      </table>

      <p style="color: #374151;">
        Review this user's reports and consider taking action (warn, suspend, or ban).
        Query reports with:
      </p>
      <pre style="background: #1f2937; color: #e5e7eb; padding: 12px 16px; border-radius: 6px; font-size: 13px; overflow-x: auto;">SELECT r.*, p.instagram_handle, p.snapchat_handle
FROM reports r
LEFT JOIN profiles p ON p.id = r.reporter_id
WHERE r.reported_id = '${reportedId}'
ORDER BY r.created_at DESC;</pre>

      <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;" />
      <p style="color: #999; font-size: 12px;">
        Wave Report System &middot; ${new Date().toISOString()}
      </p>
    </div>
  `;
}

function buildReporterAckHtml(reasonLabel: string): string {
  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <h2 style="color: #6c63ff; margin-bottom: 16px;">We received your report</h2>

      <p style="color: #374151; line-height: 1.6;">
        Thank you for helping keep Wave safe. We've received your report
        (<strong>${escapeHtml(reasonLabel)}</strong>) and our team will review it within 24 hours.
      </p>

      <p style="color: #374151; line-height: 1.6;">
        The user has been blocked and will no longer appear on your radar or be able to interact with you.
      </p>

      <p style="color: #374151; line-height: 1.6;">
        If you have any additional information, you can reply to this email or reach out through the app's Settings &gt; Contact Us.
      </p>

      <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;" />
      <p style="color: #999; font-size: 12px;">
        Wave &middot; You're receiving this because you submitted a report in the Wave app.
      </p>
    </div>
  `;
}
