// Cloudflare Worker entry point.
// Serves the static form (from /public) and handles:
//   POST /api/submit        - receives the ticket form, emails the SEO team via Resend,
//                              and saves a record of the ticket to KV storage.
//   GET  /api/tickets        - (password protected) returns all saved tickets as JSON.
//   POST /api/tickets/update - (password protected) updates status/hours spent on a ticket.
//   GET  /api/export         - (password protected) returns all tickets as a CSV file.
//
// Required environment variables/secrets (set in the Cloudflare dashboard):
//   RESEND_API_KEY, NOTIFY_EMAIL, FROM_EMAIL (optional), ADMIN_PASSWORD
// Required binding:
//   TICKETS_KV (KV namespace, configured in wrangler.jsonc)

const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024; // 8 MB, matches the client-side check
const ADMIN_HEADER = "X-Admin-Password";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/submit") {
      if (request.method !== "POST") {
        return jsonResponse({ ok: false, error: "Method not allowed." }, 405);
      }
      return handleSubmit(request, env);
    }

    if (url.pathname === "/api/tickets") {
      if (request.method !== "GET") {
        return jsonResponse({ ok: false, error: "Method not allowed." }, 405);
      }
      return handleListTickets(request, env);
    }

    if (url.pathname === "/api/tickets/update") {
      if (request.method !== "POST") {
        return jsonResponse({ ok: false, error: "Method not allowed." }, 405);
      }
      return handleUpdateTicket(request, env);
    }

    if (url.pathname === "/api/export") {
      if (request.method !== "GET") {
        return jsonResponse({ ok: false, error: "Method not allowed." }, 405);
      }
      return handleExport(request, env);
    }

    // Everything else falls through to the static site files in /public.
    return env.ASSETS.fetch(request);
  }
};

function checkAdminAuth(request, env) {
  const provided = request.headers.get(ADMIN_HEADER) || "";
  return !!env.ADMIN_PASSWORD && provided === env.ADMIN_PASSWORD;
}

function makeTicketId() {
  const stamp = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).slice(2, 5).toUpperCase();
  return `SEO-${stamp}-${rand}`;
}

async function handleSubmit(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ ok: false, error: "Invalid request body." }, 400);
  }

  const { name, email, team, requestType, priority, url, description, attachment } = body || {};

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

  // Rough size check on the base64 payload (base64 is ~1.37x the original file size).
  if (attachment && attachment.content) {
    const approxBytes = Math.floor(attachment.content.length * 0.75);
    if (approxBytes > MAX_ATTACHMENT_BYTES) {
      return jsonResponse({ ok: false, error: "Attachment is too large. Please keep it under 8 MB." }, 400);
    }
    if (!attachment.filename || typeof attachment.filename !== "string") {
      return jsonResponse({ ok: false, error: "Attachment is missing a filename." }, 400);
    }
  }

  if (!env.RESEND_API_KEY || !env.NOTIFY_EMAIL) {
    return jsonResponse(
      { ok: false, error: "Server is not configured to send email. Contact the site admin." },
      500
    );
  }

  const ticketId = makeTicketId();
  const createdAt = new Date().toISOString();

  const fromEmail = env.FROM_EMAIL || "onboarding@resend.dev";
  const safe = (v) => escapeHtml(String(v ?? "").trim());
  const subject = `[SEO Request] ${ticketId} — ${safe(requestType)} — ${priorityTag(priority)}${safe(team)}`;

  const htmlBody = `
    <h2 style="margin:0 0 12px;">New SEO team request</h2>
    <table style="border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;font-size:14px;">
      <tr><td style="padding:4px 12px;font-weight:bold;">Ticket ID</td><td style="padding:4px 12px;">${safe(ticketId)}</td></tr>
      <tr><td style="padding:4px 12px;font-weight:bold;">Requester</td><td style="padding:4px 12px;">${safe(name)} (${safe(email)})</td></tr>
      <tr><td style="padding:4px 12px;font-weight:bold;">Team</td><td style="padding:4px 12px;">${safe(team)}</td></tr>
      <tr><td style="padding:4px 12px;font-weight:bold;">Request type</td><td style="padding:4px 12px;">${safe(requestType)}</td></tr>
      <tr><td style="padding:4px 12px;font-weight:bold;">Priority</td><td style="padding:4px 12px;">${safe(priority)}</td></tr>
      <tr><td style="padding:4px 12px;font-weight:bold;">Related URL</td><td style="padding:4px 12px;">${url ? safe(url) : "—"}</td></tr>
      <tr><td style="padding:4px 12px;font-weight:bold;">Attachment</td><td style="padding:4px 12px;">${attachment && attachment.filename ? safe(attachment.filename) + " (attached)" : "—"}</td></tr>
    </table>
    <h3 style="margin:20px 0 6px;">Description</h3>
    <p style="white-space:pre-wrap;font-family:Arial,Helvetica,sans-serif;font-size:14px;">${safe(description)}</p>
  `;

  const emailPayload = {
    from: `SEO Request Form <${fromEmail}>`,
    to: [env.NOTIFY_EMAIL],
    reply_to: email,
    subject,
    html: htmlBody
  };

  if (attachment && attachment.content && attachment.filename) {
    emailPayload.attachments = [
      {
        filename: attachment.filename,
        content: attachment.content // base64 string, no data: prefix
      }
    ];
  }

  try {
    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(emailPayload)
    });

    if (!resendRes.ok) {
      const errText = await resendRes.text();
      console.error("Resend API error:", resendRes.status, errText);
      return jsonResponse(
        { ok: false, error: "Failed to send notification email. Please try again shortly." },
        502
      );
    }
  } catch (err) {
    console.error("Unexpected error sending email:", err);
    return jsonResponse({ ok: false, error: "Unexpected server error. Please try again." }, 500);
  }

  // Save a record of the ticket to KV so it shows up on the admin dashboard/export.
  // If this fails, we don't fail the whole request — the email already went out.
  if (env.TICKETS_KV) {
    try {
      const record = {
        id: ticketId,
        createdAt,
        name,
        email,
        team,
        requestType,
        priority,
        url: url || "",
        description,
        attachmentFilename: attachment && attachment.filename ? attachment.filename : "",
        status: "New",
        hoursSpent: null
      };
      await env.TICKETS_KV.put(`ticket:${ticketId}`, JSON.stringify(record));
    } catch (err) {
      console.error("Failed to save ticket to KV:", err);
    }
  }

  return jsonResponse({ ok: true, ticketId });
}

async function getAllTickets(env) {
  const tickets = [];
  let cursor;
  do {
    const list = await env.TICKETS_KV.list({ prefix: "ticket:", cursor });
    const values = await Promise.all(list.keys.map((k) => env.TICKETS_KV.get(k.name)));
    for (const v of values) {
      if (v) {
        try {
          tickets.push(JSON.parse(v));
        } catch {
          // skip malformed entries
        }
      }
    }
    cursor = list.list_complete ? undefined : list.cursor;
  } while (cursor);

  tickets.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)); // newest first
  return tickets;
}

async function handleListTickets(request, env) {
  if (!checkAdminAuth(request, env)) {
    return jsonResponse({ ok: false, error: "Unauthorized." }, 401);
  }
  if (!env.TICKETS_KV) {
    return jsonResponse({ ok: false, error: "Ticket storage is not configured." }, 500);
  }

  const tickets = await getAllTickets(env);
  return jsonResponse({ ok: true, tickets });
}

async function handleUpdateTicket(request, env) {
  if (!checkAdminAuth(request, env)) {
    return jsonResponse({ ok: false, error: "Unauthorized." }, 401);
  }
  if (!env.TICKETS_KV) {
    return jsonResponse({ ok: false, error: "Ticket storage is not configured." }, 500);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ ok: false, error: "Invalid request body." }, 400);
  }

  const { id, status, hoursSpent } = body || {};
  if (!id) {
    return jsonResponse({ ok: false, error: "Missing ticket id." }, 400);
  }

  const key = `ticket:${id}`;
  const existingRaw = await env.TICKETS_KV.get(key);
  if (!existingRaw) {
    return jsonResponse({ ok: false, error: "Ticket not found." }, 404);
  }

  const existing = JSON.parse(existingRaw);
  if (typeof status === "string" && status.trim() !== "") {
    existing.status = status;
  }
  if (hoursSpent !== undefined && hoursSpent !== null && hoursSpent !== "") {
    const parsed = Number(hoursSpent);
    existing.hoursSpent = Number.isFinite(parsed) ? parsed : existing.hoursSpent;
  }

  await env.TICKETS_KV.put(key, JSON.stringify(existing));
  return jsonResponse({ ok: true, ticket: existing });
}

async function handleExport(request, env) {
  if (!checkAdminAuth(request, env)) {
    return jsonResponse({ ok: false, error: "Unauthorized." }, 401);
  }
  if (!env.TICKETS_KV) {
    return jsonResponse({ ok: false, error: "Ticket storage is not configured." }, 500);
  }

  const tickets = await getAllTickets(env);

  const headers = [
    "Ticket ID",
    "Submitted",
    "Name",
    "Email",
    "Team",
    "Request Type",
    "Priority",
    "Related URL",
    "Description",
    "Attachment",
    "Status",
    "Hours Spent"
  ];

  const rows = tickets.map((t) => [
    t.id,
    t.createdAt,
    t.name,
    t.email,
    t.team,
    t.requestType,
    t.priority,
    t.url,
    t.description,
    t.attachmentFilename,
    t.status,
    t.hoursSpent === null || t.hoursSpent === undefined ? "" : t.hoursSpent
  ]);

  const csv = [headers, ...rows].map((row) => row.map(csvEscape).join(",")).join("\r\n");

  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="seo-tickets.csv"`
    }
  });
}

function csvEscape(value) {
  const str = String(value ?? "");
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function priorityTag(priority) {
  return priority === "Urgent" ? "URGENT — " : "";
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
