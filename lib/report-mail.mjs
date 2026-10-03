// ISO 9001:2026 Readiness Check — "email me the report" handler.
// Platform-neutral: the Vercel and Netlify adapters both call handleSendReport().
//
// Environment variables
//   EMAIL_PROVIDER      gmail | resend | sendgrid | log
//                       gmail = send from your own Gmail through the Google Apps Script web app (google-sheets/Code.gs)
//                       log   = send nothing, report success as preview
//                       default: gmail when SHEETS_WEBHOOK_URL is set, else resend/sendgrid when a key is set, else log
//   GMAIL_SCRIPT_URL    optional; Apps Script /exec?key=SECRET URL used for gmail (defaults to SHEETS_WEBHOOK_URL)
//   MAIL_FROM_NAME      sender name shown with gmail, e.g. "Mehmet Onur | Bimser QDMS"
//   RESEND_API_KEY      when EMAIL_PROVIDER=resend
//   SENDGRID_API_KEY    when EMAIL_PROVIDER=sendgrid
//   MAIL_FROM           "Bimser QDMS <qdms@yourdomain.com>"  (domain must be verified with the provider)
//   MAIL_REPLY_TO       optional reply-to address for the visitor email
//   SALES_INBOX         comma-separated internal recipients for the lead notification
//   BOOKING_URL         link used in the email call to action
//   ALLOWED_ORIGINS     optional comma-separated list of page origins allowed to call the endpoint
//   TURNSTILE_SECRET    optional Cloudflare Turnstile secret (pair with CONFIG.turnstileSiteKey in the page)
//   CRM_WEBHOOK_URL     optional URL that receives the lead record as JSON
//   SHEETS_WEBHOOK_URL  optional Google Apps Script web app URL (…/exec?key=SECRET) that appends a row to a Google Sheet
//                       and saves the PDF to Google Drive (see google-sheets/Code.gs)

const MAX_PDF_B64 = 3_000_000;              // ~2.2 MB PDF
const LIMITS = { ip: [6, 3600e3], to: [3, 86400e3] };
const hits = new Map();                     // best-effort per-instance rate limiting

const str = (v, n = 200) => (typeof v === "string" ? v.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, n) : "");
const num = v => (Number.isFinite(Number(v)) ? Math.max(0, Math.min(100, Math.round(Number(v)))) : 0);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const EMAIL_RE = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]{2,}$/;

function limited(kind, key) {
  if (!key) return false;
  const [max, win] = LIMITS[kind], now = Date.now(), k = kind + ":" + key;
  const arr = (hits.get(k) || []).filter(t => now - t < win);
  if (arr.length >= max) { hits.set(k, arr); return true; }
  arr.push(now); hits.set(k, arr);
  if (hits.size > 5000) hits.clear();
  return false;
}
function parseFrom(v) {
  const m = /^\s*(.*?)\s*<\s*([^>]+)\s*>\s*$/.exec(v || "");
  return m ? { name: m[1].replace(/^"|"$/g, ""), email: m[2] } : { name: "", email: (v || "").trim() };
}
const list = v => String(v || "").split(",").map(s => s.trim()).filter(Boolean);

async function verifyTurnstile(env, token, ip, fetchImpl) {
  if (!env.TURNSTILE_SECRET) return true;
  if (!token) return false;
  const body = new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token });
  if (ip) body.set("remoteip", ip);
  try {
    const r = await fetchImpl("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body });
    const j = await r.json();
    return !!j.success;
  } catch { return false; }
}

async function sendMail(env, msg, fetchImpl) {
  const provider = (env.EMAIL_PROVIDER || (env.SHEETS_WEBHOOK_URL || env.GMAIL_SCRIPT_URL ? "gmail" : env.RESEND_API_KEY ? "resend" : env.SENDGRID_API_KEY ? "sendgrid" : "log")).toLowerCase();
  if (provider === "log") { console.log("[mail:log]", msg.to.join(","), "|", msg.subject); return { preview: true }; }
  const from = parseFrom(env.MAIL_FROM || "Bimser QDMS <onboarding@resend.dev>");
  if (provider === "gmail") {
    const url = env.GMAIL_SCRIPT_URL || env.SHEETS_WEBHOOK_URL;
    if (!url) throw new Error("gmail: set SHEETS_WEBHOOK_URL or GMAIL_SCRIPT_URL");
    const r = await fetchImpl(url, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action: "mail", to: msg.to, subject: msg.subject, htmlBody: msg.html, body: msg.text, replyTo: msg.replyTo || "",
        name: env.MAIL_FROM_NAME || from.name || "Bimser QDMS", pdfName: msg.attachment?.filename || "", pdfBase64: msg.attachment?.content || "" }) });
    const txt = await r.text();
    let j = {}; try { j = JSON.parse(txt); } catch {}
    if (!r.ok || j.ok !== true) throw new Error("gmail " + r.status + " " + (j.error || txt.slice(0, 200)));
    return {};
  }
  if (provider === "resend") {
    const r = await fetchImpl("https://api.resend.com/emails", {
      method: "POST", headers: { Authorization: "Bearer " + env.RESEND_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ from: from.name ? `${from.name} <${from.email}>` : from.email, to: msg.to, subject: msg.subject, html: msg.html, text: msg.text,
        reply_to: msg.replyTo || undefined, attachments: msg.attachment ? [{ filename: msg.attachment.filename, content: msg.attachment.content }] : undefined })
    });
    if (!r.ok) throw new Error("resend " + r.status + " " + (await r.text()).slice(0, 300));
    return {};
  }
  if (provider === "sendgrid") {
    const r = await fetchImpl("https://api.sendgrid.com/v3/mail/send", {
      method: "POST", headers: { Authorization: "Bearer " + env.SENDGRID_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ personalizations: [{ to: msg.to.map(email => ({ email })) }], from: { email: from.email, name: from.name || undefined },
        reply_to: msg.replyTo ? { email: msg.replyTo } : undefined, subject: msg.subject,
        content: [{ type: "text/plain", value: msg.text }, { type: "text/html", value: msg.html }],
        attachments: msg.attachment ? [{ content: msg.attachment.content, filename: msg.attachment.filename, type: "application/pdf", disposition: "attachment" }] : undefined })
    });
    if (!r.ok) throw new Error("sendgrid " + r.status + " " + (await r.text()).slice(0, 300));
    return {};
  }
  throw new Error("unknown EMAIL_PROVIDER " + provider);
}

/* ---------- email templates ---------- */
const W = "#7D2142";
function shell(title, inner) {
  return `<!doctype html><html><body style="margin:0;background:#F7F1F3;font-family:Segoe UI,Arial,Helvetica,sans-serif;color:#26161C">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F7F1F3;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#FFFFFF;border-radius:12px;overflow:hidden;border:1px solid #E7D8DE">
<tr><td style="background:${W};background-image:linear-gradient(118deg,#5C1430,#A2466A);padding:28px 32px;color:#FFF6F8">
<div style="font-size:13px;font-weight:700;letter-spacing:.02em">Bimser QDMS</div>
<div style="font-family:Georgia,serif;font-size:24px;line-height:1.25;margin-top:14px">${esc(title)}</div></td></tr>
<tr><td style="padding:28px 32px;font-size:15px;line-height:1.6">${inner}</td></tr>
<tr><td style="padding:18px 32px;background:#FBF5F7;font-size:12px;color:#86707A;line-height:1.5">This is a self-assessment for orientation. It does not replace a certification audit or a professional gap analysis. Bimser Technology Solutions.</td></tr>
</table></td></tr></table></body></html>`;
}
function visitorEmail(d, env) {
  const s = d.summary, book = env.BOOKING_URL || "https://bimser.com/en/";
  const gaps = s.gaps.map(g => `<tr><td style="padding:8px 0;border-top:1px solid #E7D8DE;color:${W};font-weight:600;width:70px">${esc(g.clause)}</td><td style="padding:8px 0;border-top:1px solid #E7D8DE">${esc(g.topic)}</td><td style="padding:8px 0;border-top:1px solid #E7D8DE;text-align:right;color:#5F4951;white-space:nowrap">${esc(g.level)}</td></tr>`).join("");
  const mods = s.modules.map(m => `<li style="margin:4px 0">${esc(m)}</li>`).join("");
  const html = shell(`Your ISO 9001:2026 GAP analysis${s.company ? " for " + s.company : ""}`, `
<p>Hello ${esc(d.lead.fullName.split(" ")[0])},</p>
<p>Thank you for completing the ISO 9001:2026 Readiness Check. Your full report is attached as a PDF. Here is the summary.</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:18px 0"><tr>
<td style="padding-right:36px"><div style="font-family:Georgia,serif;font-size:40px;color:${W};line-height:1">${s.readiness}</div><div style="font-size:13px;color:#5F4951">Transition readiness, of 100</div></td>
<td><div style="font-family:Georgia,serif;font-size:40px;color:${W};line-height:1">${s.digital}</div><div style="font-size:13px;color:#5F4951">Digital maturity, of 100</div></td></tr></table>
<div style="background:#F5E4EA;border-radius:10px;padding:14px 16px;margin:0 0 20px"><b style="color:#541029">${esc(s.verdict)}</b><br><span style="color:#5F4951">${esc(s.verdictText)}</span></div>
${gaps ? `<p style="margin:0 0 6px;font-weight:600">Where to act first</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px">${gaps}</table>` : ""}
${mods ? `<p style="margin:20px 0 6px;font-weight:600">QDMS modules that close these gaps</p><ul style="margin:0;padding-left:20px">${mods}</ul>` : ""}
<p style="margin-top:20px">${s.monthsLeft} months remain until certificates to ISO 9001:2015 expire on 30 September 2029.</p>
<p style="margin:26px 0"><a href="${esc(book)}" style="background:${W};color:#FFFFFF;text-decoration:none;font-weight:600;padding:13px 24px;border-radius:999px;display:inline-block">Book a 30-minute session with a QDMS specialist</a></p>
<p style="color:#5F4951">Kind regards,<br>The Bimser QDMS team</p>`);
  const text = `Hello ${d.lead.fullName},

Your ISO 9001:2026 GAP analysis is attached as a PDF.

Transition readiness: ${s.readiness}/100
Digital maturity: ${s.digital}/100
${s.verdict}: ${s.verdictText}

Where to act first:
${s.gaps.map(g => `- ${g.clause} ${g.topic} (${g.level})`).join("\n")}

QDMS modules that close these gaps:
${s.modules.map(m => `- ${m}`).join("\n")}

Book a 30-minute session: ${book}

The Bimser QDMS team`;
  return { subject: `Your ISO 9001:2026 GAP analysis${s.company ? " – " + s.company : ""}`, html, text };
}
function salesEmail(d) {
  const L = d.lead, s = d.summary, tr = d.tracking || {};
  const row = (k, v) => v ? `<tr><td style="padding:6px 12px 6px 0;color:#86707A;white-space:nowrap;vertical-align:top">${esc(k)}</td><td style="padding:6px 0">${esc(v)}</td></tr>` : "";
  const tag = d.temperature.toUpperCase();
  const html = shell(`${tag} lead: ${L.company}`, `
<table role="presentation" cellpadding="0" cellspacing="0" style="font-size:14px">
${row("Name", L.fullName)}${row("Job title", L.jobTitle)}${row("Company", L.company)}${row("Email", L.email)}${row("Phone", L.phone)}${row("Country", L.country)}
${row("Wants contact", L.wantContact ? "YES" : "no")}${row("Marketing opt-in", L.marketingOptIn ? "yes" : "no")}
${row("Industry", d.profile.industry)}${row("Employees", d.profile.employees)}${row("Certification", d.profile.certification)}
${row("Readiness", s.readiness + "/100")}${row("Digital maturity", s.digital + "/100")}${row("Position", s.verdict)}
${row("Biggest gaps", s.gaps.map(g => `${g.topic.startsWith(g.clause) ? "" : g.clause + " "}${g.topic} (${g.score})`).join("; "))}
${row("Modules to propose", s.modules.join(", "))}
${row("Source", [tr.utm_source, tr.utm_medium, tr.utm_campaign].filter(Boolean).join(" / "))}${row("AM", tr.am)}${row("Partner", tr.partner)}${row("Referrer domain", tr.ref)}
${row("Submitted", d.submittedAt)}${row("Page", d.page)}
</table><p style="color:#86707A;font-size:13px">The visitor's PDF report is attached.</p>`);
  const text = `${tag} lead: ${L.fullName} (${L.jobTitle}), ${L.company}, ${L.country}
Email: ${L.email}  Phone: ${L.phone || "-"}  Wants contact: ${L.wantContact ? "YES" : "no"}
Readiness ${s.readiness}/100, digital ${s.digital}/100 (${s.verdict})
Gaps: ${s.gaps.map(g => `${g.clause} ${g.topic}`).join("; ")}
Modules: ${s.modules.join(", ")}
Source: ${[tr.utm_source, tr.utm_medium, tr.utm_campaign].filter(Boolean).join(" / ") || "direct"}${tr.am ? "  AM: " + tr.am : ""}`;
  return { subject: `[${tag}${L.wantContact ? " · wants contact" : ""}] ISO 9001:2026 lead – ${L.company} (${L.country}) – readiness ${s.readiness}`, html, text };
}

/* ---------- Google Sheets row ---------- */
export const SHEET_COLUMNS = ["Submitted at", "Temperature", "Wants contact", "Full name", "Job title", "Company", "Email", "Phone", "Country",
  "Industry", "Employees", "Certification", "Readiness", "Digital maturity", "Position", "Major gaps", "Partial gaps", "Top gaps", "Recommended modules",
  "Marketing opt-in", "UTM source", "UTM medium", "UTM campaign", "AM", "Partner", "Referrer domain", "Page", "Area scores", "Answers"];
export function sheetRow(d, p) {
  const L = d.lead, s = d.summary, t = d.tracking || {}, gap = p.gap || {};
  const ids = v => (Array.isArray(v) ? v.slice(0, 20).map(x => str(String(x), 20)).join(", ") : "");
  return [d.submittedAt, d.temperature, L.wantContact ? "Yes" : "No", L.fullName, L.jobTitle, L.company, L.email, L.phone, L.country,
    d.profile.industry, d.profile.employees, d.profile.certification, s.readiness, s.digital, s.verdict, ids(gap.major), ids(gap.partial),
    s.gaps.map(g => `${g.topic.startsWith(g.clause) ? "" : g.clause + " "}${g.topic} (${g.score})`).join("; "), s.modules.join(", "),
    L.marketingOptIn ? "Yes" : "No", t.utm_source || "", t.utm_medium || "", t.utm_campaign || "", t.am || "", t.partner || "", t.ref || "", d.page,
    JSON.stringify(p.scores?.areas || {}).slice(0, 500), JSON.stringify(p.answers || {}).slice(0, 1500)];
}

/* ---------- main handler ---------- */
export async function handleSendReport({ body, ip = "", origin = "", env = {}, fetchImpl = fetch }) {
  const allowed = list(env.ALLOWED_ORIGINS);
  if (allowed.length && origin && !allowed.includes(origin)) return { status: 403, body: { ok: false, error: "origin" } };
  let p = body;
  if (typeof p === "string") { try { p = JSON.parse(p); } catch { p = null; } }
  if (!p || typeof p !== "object") return { status: 400, body: { ok: false, error: "bad_json" } };
  if (str(p.website)) return { status: 200, body: { ok: true } };          // honeypot: pretend success

  const l = p.lead || {};
  const lead = { fullName: str(l.fullName, 120), email: str(l.email, 160).toLowerCase(), company: str(l.company, 160), jobTitle: str(l.jobTitle, 120),
    country: str(l.country, 4), phone: str(l.phone, 40), consent: l.consent === true, marketingOptIn: l.marketingOptIn === true, wantContact: l.wantContact === true };
  if (!lead.consent) return { status: 400, body: { ok: false, error: "consent_required" } };
  if (!lead.fullName || !lead.company || !lead.jobTitle || !lead.country) return { status: 400, body: { ok: false, error: "missing_fields" } };
  if (!EMAIL_RE.test(lead.email)) return { status: 400, body: { ok: false, error: "bad_email" } };

  const b64 = typeof p.pdfBase64 === "string" ? p.pdfBase64.replace(/^data:application\/pdf;base64,/, "") : "";
  if (!b64 || b64.length > MAX_PDF_B64 || !/^[A-Za-z0-9+/=\s]+$/.test(b64.slice(0, 2000))) return { status: 400, body: { ok: false, error: "bad_pdf" } };
  if (!Buffer.from(b64.slice(0, 16), "base64").toString("latin1").startsWith("%PDF")) return { status: 400, body: { ok: false, error: "bad_pdf" } };

  if (limited("ip", ip)) return { status: 429, body: { ok: false, error: "rate_limited" } };
  if (limited("to", lead.email)) return { status: 429, body: { ok: false, error: "rate_limited" } };
  if (!(await verifyTurnstile(env, str(p.turnstileToken, 2048), ip, fetchImpl))) return { status: 403, body: { ok: false, error: "bot_check" } };

  const s = p.summary || {};
  const d = {
    lead, submittedAt: new Date().toISOString(), page: str(p.page, 300),
    temperature: ["hot", "warm", "cold"].includes(p.temperature) ? p.temperature : "cold",
    tracking: Object.fromEntries(Object.entries(p.tracking || {}).slice(0, 10).map(([k, v]) => [str(k, 20), str(v, 80)])),
    profile: { industry: str(p.profile?.industry, 60), employees: str(p.profile?.employees, 30), certification: str(p.profile?.certification, 60) },
    summary: { company: str(s.company, 160) || lead.company, readiness: num(s.readiness), digital: num(s.digital), verdict: str(s.verdict, 60), verdictText: str(s.verdictText, 300),
      monthsLeft: Math.max(0, Math.min(60, Math.round(Number(s.monthsLeft) || 0))),
      gaps: (Array.isArray(s.gaps) ? s.gaps : []).slice(0, 8).map(g => ({ clause: str(g.clause, 20), topic: str(g.topic, 120), level: str(g.level, 40), score: num(g.score) })),
      modules: (Array.isArray(s.modules) ? s.modules : []).slice(0, 10).map(m => str(m, 120)) }
  };
  const filename = (str(p.pdfName, 120).replace(/[^\w.-]/g, "-") || "ISO-9001-2026-GAP-analysis.pdf").replace(/(\.pdf)?$/i, ".pdf");
  const attachment = { filename, content: b64.replace(/\s/g, "") };

  let preview = false;
  try {
    const v = visitorEmail(d, env);
    const r = await sendMail(env, { to: [lead.email], subject: v.subject, html: v.html, text: v.text, replyTo: env.MAIL_REPLY_TO, attachment }, fetchImpl);
    preview = !!r.preview;
  } catch (e) {
    console.error("[send-report] visitor mail failed", e.message);
    return { status: 502, body: { ok: false, error: "mail_failed" } };
  }
  const tasks = [];
  const inbox = list(env.SALES_INBOX);
  if (inbox.length) { const m = salesEmail(d); tasks.push(sendMail(env, { to: inbox, subject: m.subject, html: m.html, text: m.text, replyTo: lead.email, attachment }, fetchImpl)); }
  if (env.SHEETS_WEBHOOK_URL) tasks.push(fetchImpl(env.SHEETS_WEBHOOK_URL, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ columns: SHEET_COLUMNS, row: sheetRow(d, p), pdfName: filename, pdfBase64: attachment.content }) })
    .then(async r => { if (!r.ok) throw new Error("sheets " + r.status); const j = await r.json().catch(() => ({})); if (j.ok === false) throw new Error("sheets " + (j.error || "error")); }));
  if (env.CRM_WEBHOOK_URL) tasks.push(fetchImpl(env.CRM_WEBHOOK_URL, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...d, scores: p.scores, gap: p.gap, answers: p.answers }) }));
  const results = await Promise.allSettled(tasks);
  results.filter(x => x.status === "rejected").forEach(x => console.error("[send-report] side task failed", x.reason?.message));
  return { status: 200, body: { ok: true, preview } };
}
