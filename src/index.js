// Cloudflare Worker entry point.
// Serves the static form (from /public) and handles POST /api/submit
// by emailing the SEO team via Resend.
//
// Required environment variables/secrets (set in the Cloudflare dashboard):
//   RESEND_API_KEY, NOTIFY_EMAIL, FROM_EMAIL (optional)

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/submit") {
      if (request.method !== "POST") {
        return jsonResponse({ ok: false, error: "Method not allowed." }, 405);
      }
      return handleSubmit(request, env);
    }

    // Everything else falls through to the static site files in /public.
    return env.ASSETS.fetch(request);
  }
};

async function handleSubmit(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ ok: false, error: "Invalid request body." }, 400);
  }

  const { name, email, team, requestType, priority, url, dueDate, description } = body || {};

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
        from: `SEO Request Form <${fromEmail}>`,
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
