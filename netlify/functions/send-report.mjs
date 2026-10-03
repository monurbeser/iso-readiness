// Netlify function (v2): POST /api/send-report
import { handleSendReport } from "../../lib/report-mail.mjs";

export default async (req, context) => {
  if (req.method !== "POST") return new Response(JSON.stringify({ ok: false, error: "method" }), { status: 405, headers: { "Content-Type": "application/json", Allow: "POST" } });
  let body = null;
  try { body = await req.json(); } catch {}
  const r = await handleSendReport({ body, ip: context.ip || "", origin: req.headers.get("origin") || "", env: process.env });
  return new Response(JSON.stringify(r.body), { status: r.status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
};

export const config = { path: "/api/send-report" };
