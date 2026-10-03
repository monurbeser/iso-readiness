// Vercel serverless function: POST /api/send-report
import { handleSendReport } from "../lib/report-mail.mjs";

export const config = { maxDuration: 20 };

export default async function handler(req, res) {
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({ ok: false, error: "method" }); }
  const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket?.remoteAddress || "";
  const r = await handleSendReport({ body: req.body, ip, origin: req.headers.origin || "", env: process.env });
  res.setHeader("Cache-Control", "no-store");
  return res.status(r.status).json(r.body);
}
