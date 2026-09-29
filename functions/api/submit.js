// Cloudflare Pages Function
// Handles POST /api/submit — receives the ticket form and emails the SEO team via Resend.
//
// Required environment variables (set as encrypted secrets in the Cloudflare Pages dashboard):
//   RESEND_API_KEY  - your Resend API key
//   NOTIFY_EMAIL    - the Outlook inbox/address that should receive ticket notifications
//   FROM_EMAIL      - the "from" address Resend sends as (must be on a domain verified in Resend,
//                     or use "onboarding@resend.dev" for initial testing)

export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ ok: false, error: "Invalid request body." }, 400);
  }

  const {
    name,
    email,
    team,
    requestType,
    priority,
    url,
    dueDate,
    description
  } = body || {};

  // Basic server-side validation — never trust the client alone.
  const required = { name, email, team, requestType, priority, description };
  const missing = Object.entries(required)
    .filter(([, v]) => !v || String(v).trim() === "")
    .map(([k]) => k);

  if (missing.length > 0) {
    return jsonResponse(
      { ok: false, error: `Missing required field(s): ${missing.join(", ")}` },
      400
    );
  }

  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailPattern.test(email)) {
    return jsonResponse({ ok: false, error: "Please enter a valid email address." }, 400);
  }

  if (!env.RESEND_API_KEY || !env.NOTIFY_EMAIL) {
    return jsonResponse(
      { ok: false, error: "Server is not configured to send email. Contact the site admin." },
      500
    );
  }

  const fromEmail = env.FROM_EMAIL || "onboarding@resend.dev";

  const safe = (v) => escapeHtml(String(v ?? "").trim());

  const subject = `[SEO Request] ${safe(requestType)} — ${priorityTag(priority)}${safe(team)}`;

  const htmlBody = `
    <h2 style="margin:0 0 12px;">New SEO team request</h2>
    <table style="border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;font-size:14px;">
      <tr><td style="padding:4px 12px;font-weight:bold;">Requester</td><td style="padding:4px 12px;">${safe(name)} (${safe(email)})</td></tr>
      <tr><td style="padding:4px 12px;font-weight:bold;">Team</td><td style="padding:4px 12px;">${safe(team)}</td></tr>
      <tr><td style="padding:4px 12px;font-weight:bold;">Request type</td><td style="padding:4px 12px;">${safe(requestType)}</td></tr>
      <tr><td style="padding:4px 12px;font-weight:bold;">Priority</td><td style="padding:4px 12px;">${safe(priority)}</td></tr>
      <tr><td style="padding:4px 12px;font-weight:bold;">Related URL</td><td style="padding:4px 12px;">${url ? safe(url) : "—"}</td></tr>
      <tr><td style="padding:4px 12px;font-weight:bold;">Needed by</td><td style="padding:4px 12px;">${dueDate ? safe(dueDate) : "—"}</td></tr>
    </table>
    <h3 style="margin:20px 0 6px;">Description</h3>
    <p style="white-space:pre-wrap;font-family:Arial,Helvetica,sans-serif;font-size:14px;">${safe(description)}</p>
  `;

  try {
    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: `NCL SEO Request Form <${fromEmail}>`,
        to: [env.NOTIFY_EMAIL],
        reply_to: email,
        subject,
        html: htmlBody
      })
    });

    if (!resendRes.ok) {
      const errText = await resendRes.text();
      console.error("Resend API error:", resendRes.status, errText);
      return jsonResponse(
        { ok: false, error: "Failed to send notification email. Please try again shortly." },
        502
      );
    }

    return jsonResponse({ ok: true });
  } catch (err) {
    console.error("Unexpected error sending email:", err);
    return jsonResponse({ ok: false, error: "Unexpected server error. Please try again." }, 500);
  }
}

// Reject non-POST methods explicitly instead of falling through.
export async function onRequestGet() {
  return jsonResponse({ ok: false, error: "Method not allowed." }, 405);
}

function priorityTag(priority) {
  return priority === "Urgent" || priority === "High" ? `${priority.toUpperCase()} — ` : "";
}

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
