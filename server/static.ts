import express, { type Express } from "express";
import fs from "fs";
import path from "path";
import { applyLinkPreview, linkPreviewFor } from "./link-preview";

export function serveStatic(app: Express) {
  const distPath = path.resolve(__dirname, "public");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  /* Vite names every built file after its content (index-CutpPHUE.js), so a
     file under /assets can NEVER change — cache it for a year and skip even
     the "has it changed?" round trip. It used to be served max-age=0, so the
     browser re-asked about the whole 2.2 MB app on every visit.
     🔴 A missing /assets file answers 404, never index.html: after a deploy an
     open tab may ask for a chunk that no longer exists, and HTML where
     JavaScript was expected is a confusing failure — a clean 404 lets the
     client's reload-once guard (main.tsx) move it onto the new version. */
  app.use(
    "/assets",
    express.static(path.join(distPath, "assets"), { immutable: true, maxAge: "1y", index: false }),
    (_req, res) => res.status(404).end(),
  );
  /* The brands' own typefaces for Content Studio pages and graphics. A
     published page lives on another host (join.southislandunited.com) and the
     preview runs in a sandboxed (opaque-origin) frame, so a font needs CORS. */
  app.use(
    "/studio-fonts",
    (_req, res, next) => { res.setHeader("Access-Control-Allow-Origin", "*"); next(); },
    express.static(path.join(distPath, "studio-fonts"), { maxAge: "30d", index: false }),
    (_req, res) => res.status(404).end(),
  );
  app.use(express.static(distPath, { index: false }));

  // fall through to index.html if the file doesn't exist. The shell is
  // tiny and must always be the newest one (it names the current chunks).
  // Each link previews as what it is (a film, the film library, a programme,
  // the brand of its host) — server/link-preview.ts writes it into the shell.
  const shell = fs.readFileSync(path.resolve(distPath, "index.html"), "utf8");
  app.use("/{*path}", async (req, res) => {
    res.setHeader("Cache-Control", "no-cache");
    try {
      const p = await linkPreviewFor(String(req.headers["x-forwarded-host"] || req.headers.host || ""), req.originalUrl || "/");
      res.type("html").send(applyLinkPreview(shell, p));
    } catch {
      res.sendFile(path.resolve(distPath, "index.html"));
    }
  });
}
