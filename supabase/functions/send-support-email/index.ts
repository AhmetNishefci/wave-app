import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders, handleCorsPreflightIfNeeded } from "../_shared/cors.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const SUPPORT_EMAIL = Deno.env.get("SUPPORT_EMAIL") ?? "support@wavenearby.com";

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
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
      });
    }

    // Parse body
    let category: string;
    let details: string | null;
    let device: { appVersion?: string; platform?: string; osVersion?: string | number; deviceName?: string } | null;
    try {
      const body = await req.json();
      category = body.category;
      details = body.details ?? null;
      device = body.device ?? null;
      if (!category || typeof category !== "string") {
        return new Response(JSON.stringify({ error: "Category required" }), {
          status: 400,
          headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
        });
      }
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
        status: 400,
        headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
      });
    }

    // Get user's email and profile info for context
    const userEmail = user.email ?? user.phone ?? "unknown";
    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const { data: profile } = await adminClient
      .from("profiles")
      .select("instagram_handle, snapchat_handle, gender, date_of_birth")
      .eq("id", user.id)
      .maybeSingle();

    const igHandle = profile?.instagram_handle ?? "—";
    const scHandle = profile?.snapchat_handle ?? "—";

    // Format the email
    const categoryLabels: Record<string, string> = {
      bug: "Bug Report",
      account: "Account Issue",
      feature: "Feature Request",
      other: "Other",
    };

    const subject = `[Wave Support] ${categoryLabels[category] ?? category} — ${igHandle !== "—" ? `@${igHandle}` : userEmail}`;

    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #6c63ff; margin-bottom: 24px;">New Support Ticket</h2>

        <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
          <tr>
            <td style="padding: 8px 12px; background: #f5f5f5; font-weight: 600; width: 140px;">Category</td>
            <td style="padding: 8px 12px;">${categoryLabels[category] ?? category}</td>
          </tr>
          <tr>
            <td style="padding: 8px 12px; background: #f5f5f5; font-weight: 600;">User ID</td>
            <td style="padding: 8px 12px; font-family: monospace; font-size: 13px;">${user.id}</td>
          </tr>
          <tr>
            <td style="padding: 8px 12px; background: #f5f5f5; font-weight: 600;">Auth</td>
            <td style="padding: 8px 12px;">${userEmail}</td>
          </tr>
          <tr>
            <td style="padding: 8px 12px; background: #f5f5f5; font-weight: 600;">Instagram</td>
            <td style="padding: 8px 12px;">${igHandle !== "—" ? `@${igHandle}` : "—"}</td>
          </tr>
          <tr>
            <td style="padding: 8px 12px; background: #f5f5f5; font-weight: 600;">Snapchat</td>
            <td style="padding: 8px 12px;">${scHandle !== "—" ? scHandle : "—"}</td>
          </tr>
          <tr>
            <td style="padding: 8px 12px; background: #f5f5f5; font-weight: 600;">Gender</td>
            <td style="padding: 8px 12px;">${profile?.gender ?? "—"}</td>
          </tr>
          ${device ? `
          <tr>
            <td style="padding: 8px 12px; background: #f5f5f5; font-weight: 600;">Device</td>
            <td style="padding: 8px 12px;">${escapeHtml(device.deviceName ?? "—")}</td>
          </tr>
          <tr>
            <td style="padding: 8px 12px; background: #f5f5f5; font-weight: 600;">Platform</td>
            <td style="padding: 8px 12px;">${escapeHtml(String(device.platform ?? "—"))} ${escapeHtml(String(device.osVersion ?? ""))}</td>
          </tr>
          <tr>
            <td style="padding: 8px 12px; background: #f5f5f5; font-weight: 600;">App Version</td>
            <td style="padding: 8px 12px;">${escapeHtml(device.appVersion ?? "—")}</td>
          </tr>
          ` : ""}
        </table>

        ${details ? `
          <h3 style="margin-bottom: 8px;">Details</h3>
          <div style="background: #f9f9f9; border-left: 3px solid #6c63ff; padding: 16px; border-radius: 4px; white-space: pre-wrap;">${escapeHtml(details)}</div>
        ` : `<p style="color: #888;">No additional details provided.</p>`}

        <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;" />
        <p style="color: #999; font-size: 12px;">
          Sent from Wave app · ${new Date().toISOString()}
        </p>
      </div>
    `;

    // Send via Resend
    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Wave Support <support@wavenearby.com>",
        to: [SUPPORT_EMAIL],
        reply_to: user.email ? [user.email] : undefined,
        subject,
        html,
      }),
    });

    if (!resendRes.ok) {
      const errBody = await resendRes.text();
      console.error("Resend API error:", resendRes.status, errBody);
      return new Response(JSON.stringify({ error: "Failed to send email" }), {
        status: 502,
        headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ status: "sent" }), {
      headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("send-support-email error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
    });
  }
});

/** Escape HTML special characters to prevent XSS in email body */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
