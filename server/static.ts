import express, { type Express } from "express";
import fs from "fs";
import path from "path";

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
  app.use(express.static(distPath, { index: false }));

  // fall through to index.html if the file doesn't exist. The shell is
  // tiny and must always be the newest one (it names the current chunks).
  app.use("/{*path}", (_req, res) => {
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
