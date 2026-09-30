/**
 * _perf-admin-load.ts — how long does a member of staff wait for the ClubOS
 * dashboard? Old build vs new build, same conditions.
 *
 *   npx tsx --env-file=.env script/_perf-admin-load.ts <old-dist> <new-dist>
 *
 * Serves each build from a local server (brotli, and EACH build's own caching
 * rules: old = max-age=0 + ETag revalidation, new = /assets immutable), with
 * /api passed straight through to production — so the data, the database and
 * the network to it are identical and only the front end differs. A throwaway
 * CUFC workspace admin (what Olga and Travis are) signs in; Chrome runs as a
 * phone on "fast 4G" with a 4× slower CPU. "Ready" = the dashboard's content
 * area has real text, not the moment the HTML arrived. The user is deleted.
 */
import http from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, extname } from "node:path";
import { brotliCompressSync, constants } from "node:zlib";
import { createHash } from "node:crypto";
import puppeteer from "puppeteer-core";
import pg from "pg";
import bcrypt from "bcryptjs";

const [OLD, NEW] = process.argv.slice(2);
const PROD = "https://app.usg.co.nz";
const TYPES: Record<string, string> = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".json": "application/json", ".webp": "image/webp" };
const brCache = new Map<string, Buffer>();

function serve(dist: string, mode: "old" | "new", port: number) {
  return http
    .createServer(async (req, res) => {
      const url = req.url ?? "/";
      if (url.startsWith("/api/")) {
        const chunks: Buffer[] = [];
        for await (const c of req) chunks.push(c as Buffer);
        const r = await fetch(PROD + url, {
          method: req.method,
          headers: { cookie: req.headers.cookie ?? "", "content-type": req.headers["content-type"] ?? "application/json", "x-workspace-slug": String(req.headers["x-workspace-slug"] ?? "") },
          body: ["GET", "HEAD"].includes(req.method ?? "GET") ? undefined : Buffer.concat(chunks),
          redirect: "manual",
        });
        const body = Buffer.from(await r.arrayBuffer());
        res.writeHead(r.status, { "content-type": r.headers.get("content-type") ?? "application/json" });
        return res.end(body);
      }
      let file = join(dist, decodeURIComponent(url.split("?")[0]));
      if (!existsSync(file) || statSync(file).isDirectory()) {
        if (url.startsWith("/assets/")) return res.writeHead(404).end();
        file = join(dist, "index.html");
      }
      let body = brCache.get(file);
      if (!body) {
        body = brotliCompressSync(readFileSync(file), { params: { [constants.BROTLI_PARAM_QUALITY]: 5 } });
        brCache.set(file, body);
      }
      const etag = `"${createHash("md5").update(body).digest("hex")}"`;
      const isAsset = url.startsWith("/assets/");
      const cc = mode === "new" && isAsset ? "public, max-age=31536000, immutable" : mode === "new" ? "no-cache" : "public, max-age=0";
      if (req.headers["if-none-match"] === etag) return res.writeHead(304, { etag, "cache-control": cc }).end();
      res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream", "content-encoding": "br", etag, "cache-control": cc });
      res.end(body);
    })
    .listen(port);
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const email = `_perf_${Date.now()}@usg.co.nz`;
const pw = `T${Math.random().toString(36).slice(2)}!aA9`;
const { rows } = await pool.query(
  `INSERT INTO users (email,first_name,last_name,password,role,active) VALUES ($1,'Perf','Check',$2,'admin',true) RETURNING id`,
  [email, await bcrypt.hash(pw, 10)],
);
const uid = rows[0].id;
await pool.query(`INSERT INTO user_organizations (user_id,organization_id,role,tabs) VALUES ($1,1,'admin',NULL)`, [uid]);
const login = await fetch(`${PROD}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: pw }) });
const [cn, cv] = (login.headers.get("set-cookie") || "").split(";")[0].split("=");

const servers = [serve(OLD, "old", 5181), serve(NEW, "new", 5182)];
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true, args: ["--no-sandbox"] });
const NET = { offline: false, latency: 60, downloadThroughput: (9 * 1024 * 1024) / 8, uploadThroughput: (1.5 * 1024 * 1024) / 8 };

async function visit(ctx: any, port: number) {
  const page = await ctx.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  const cdp = await page.createCDPSession();
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", NET);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await page.setCookie({ name: cn, value: cv, domain: "localhost", path: "/" });
  let js = 0;
  const types = new Map<string, string>();
  cdp.on("Network.responseReceived", (e: any) => types.set(e.requestId, e.type));
  cdp.on("Network.loadingFinished", (e: any) => { if (types.get(e.requestId) === "Script") js += e.encodedDataLength; });
  const t0 = Date.now();
  await page.goto(`http://localhost:${port}/admin`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => ((document.querySelector("main") as HTMLElement | null)?.innerText.trim().length ?? 0) > 150, { timeout: 90000, polling: 100 });
  const ms = Date.now() - t0;
  await page.close();
  return { ms, jsKB: Math.round(js / 1024) };
}

try {
  for (const [label, port] of [["OLD (one 2.2 MB file)", 5181], ["NEW (split)", 5182]] as const) {
    const ctx = await browser.createBrowserContext();
    const cold = await visit(ctx, port);
    const warm = await visit(ctx, port);
    console.log(`${label.padEnd(24)} first open ${(cold.ms / 1000).toFixed(1)}s (JS ${cold.jsKB} KB) · next open ${(warm.ms / 1000).toFixed(1)}s (JS ${warm.jsKB} KB)`);
    await ctx.close();
  }
} finally {
  await browser.close();
  servers.forEach((s) => s.close());
  await pool.query(`DELETE FROM user_organizations WHERE user_id=$1`, [uid]);
  await pool.query(`DELETE FROM users WHERE id=$1`, [uid]);
  await pool.end();
}
