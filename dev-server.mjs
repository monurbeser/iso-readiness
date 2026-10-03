// Local test server: node dev-server.mjs  ->  http://localhost:3000
// Serves ./public and POST /api/send-report. With EMAIL_PROVIDER=log, emails are written to ./.outbox as HTML.
import http from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { handleSendReport } from "./lib/report-mail.mjs";

if (existsSync(".env")) for (const line of readFileSync(".env", "utf8").split("\n")) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*(#.*)?$/.exec(line); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
}
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".txt": "text/plain", ".png": "image/png", ".svg": "image/svg+xml" };
const PORT = Number(process.env.PORT || 3000);

// In log mode, capture outgoing mail to files so you can open them in a browser.
const logFetch = async (url, opts) => {
  if (/api\.(resend|sendgrid)\.com/.test(url)) {
    await mkdir(".outbox", { recursive: true });
    const b = JSON.parse(opts.body), stamp = Date.now();
    await writeFile(`.outbox/${stamp}.json`, JSON.stringify({ ...b, attachments: b.attachments?.map(a => ({ ...a, content: `[${a.content.length} base64 chars]` })) }, null, 2));
    if (b.html) await writeFile(`.outbox/${stamp}.html`, b.html);
    const att = b.attachments?.[0]; if (att) await writeFile(`.outbox/${stamp}-${att.filename}`, Buffer.from(att.content, "base64"));
    return new Response(JSON.stringify({ id: String(stamp) }), { status: 200 });
  }
  return fetch(url, opts);
};

http.createServer(async (req, res) => {
  try {
    if (req.url.startsWith("/api/send-report")) {
      if (req.method !== "POST") { res.writeHead(405); return res.end(); }
      let raw = ""; for await (const c of req) raw += c;
      const dryRun = process.env.DEV_CAPTURE === "1";
      const env = dryRun ? { ...process.env, EMAIL_PROVIDER: process.env.EMAIL_PROVIDER === "sendgrid" ? "sendgrid" : "resend", RESEND_API_KEY: "dev", SENDGRID_API_KEY: "dev" } : process.env;
      const r = await handleSendReport({ body: raw, ip: req.socket.remoteAddress, origin: req.headers.origin || "", env, fetchImpl: dryRun ? logFetch : fetch });
      res.writeHead(r.status, { "Content-Type": "application/json" }); return res.end(JSON.stringify(r.body));
    }
    let p = normalize(decodeURIComponent(req.url.split("?")[0])).replace(/^(\.\.[/\\])+/, "");
    if (p === "/" || p === "\\") p = "/index.html";
    const file = join("public", p);
    const data = await readFile(file);
    res.writeHead(200, { "Content-Type": TYPES[extname(file)] || "application/octet-stream" }); res.end(data);
  } catch { res.writeHead(404); res.end("Not found"); }
}).listen(PORT, () => console.log(`ISO 9001:2026 Readiness Check on http://localhost:${PORT}  (DEV_CAPTURE=1 writes emails to ./.outbox)`));
