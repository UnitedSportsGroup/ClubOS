#!/usr/bin/env node
/**
 * The check that stops "I ship a feature, it works for me, and nobody else can
 * see it".
 *
 * Daniel, 2026-09-10: "so many inconsistencies around me seeing things and ryan
 * not... I ship features, think the work is done, but actually only i can see
 * it and no one else. big problem."
 *
 * 🔴 THE MECHANISM. `requireTab()` returns early on the super_admin check, one
 * line before it looks for X-Workspace-Slug. A page that calls a tab-gated
 * endpoint with a bare `fetch()` therefore sends no header, and:
 *
 *     Daniel (super admin) → short-circuits → 200 with real data
 *     everybody else       → 400 X-Workspace-Slug header required
 *
 * The page then renders the failure as zeros, so it does not even look broken.
 * That is exactly how the Grant Funding page showed Daniel 52 funders and Ryan
 * "Funders tracked 0", and how the Contacts tab shipped blank for every member
 * of staff.
 *
 * The client already has `workspaceFetch()` and `apiRequest()`, both of which
 * attach the header. This finds the calls that use neither.
 *
 *   node script/check-workspace-fetch.mjs          # fail on any offender
 *   node script/check-workspace-fetch.mjs --list   # just list them
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLIENT = join(ROOT, "client", "src");
const SERVER = join(ROOT, "server");
const LIST_ONLY = process.argv.includes("--list");

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

// ── Which admin endpoints are tab-gated on the server ────────────────────────
// Read it from the routes rather than keeping a list: a list would go stale the
// first time somebody adds a gate, and this check would then pass over the very
// endpoint it exists to protect.
const gated = new Set();
for (const file of walk(SERVER)) {
  const src = readFileSync(file, "utf8");
  const re = /app\.(get|post|patch|put|delete)\(\s*["'`]([^"'`]+)["'`][^)]*?requireTab\(/gs;
  let m;
  while ((m = re.exec(src))) gated.add(m[2]);
  // `const tab = requireTab("x")` then `app.get(path, requireAuth, tab, …)`
  const viaConst = /app\.(get|post|patch|put|delete)\(\s*["'`]([^"'`]+)["'`]\s*,\s*requireAuth\s*,\s*tab\b/gs;
  if (/=\s*requireTab\(/.test(src)) {
    let m2;
    while ((m2 = viaConst.exec(src))) gated.add(m2[2]);
  }
}

/** "/api/admin/grants/funders?x=1" → "/api/admin/grants/funders" */
const clean = (u) => u.split("?")[0].replace(/\$\{[^}]*\}/g, ":p").replace(/\/+$/, "");

/** Does this called path match a gated route pattern (":id" wildcards)? */
function isGated(path) {
  if (gated.has(path)) return true;
  for (const route of gated) {
    if (!route.includes(":")) continue;
    const rx = new RegExp("^" + route.replace(/:[A-Za-z0-9_]+/g, "[^/]+") + "$");
    if (rx.test(path)) return true;
  }
  return false;
}

const offenders = [];
for (const file of walk(CLIENT)) {
  const src = readFileSync(file, "utf8");
  const lines = src.split("\n");
  lines.forEach((line, i) => {
    // A bare fetch() — not workspaceFetch(, not apiRequest(.
    const m = /(?<![\w.])fetch\(\s*[`"']([^`"']*\/api\/admin\/[^`"']*)/.exec(line);
    if (!m) return;
    if (/workspaceFetch\(|apiRequest\(/.test(line)) return;
    const path = clean(m[1]);
    if (!isGated(path)) return; // ungated endpoints do their own scoping
    offenders.push({ file: relative(ROOT, file), line: i + 1, path });
  });
}

if (offenders.length === 0) {
  console.log(`✓ no bare fetch() to a tab-gated admin endpoint (${gated.size} gated routes scanned)`);
  process.exit(0);
}

const byFile = new Map();
for (const o of offenders) {
  if (!byFile.has(o.file)) byFile.set(o.file, []);
  byFile.get(o.file).push(o);
}
console.log(`\n${offenders.length} bare fetch() call(s) to a TAB-GATED admin endpoint, in ${byFile.size} file(s):\n`);
for (const [file, list] of [...byFile].sort()) {
  console.log(`  ${file}`);
  for (const o of list) console.log(`    :${String(o.line).padEnd(5)} ${o.path}`);
}
console.log(`
These work for a super admin and answer 400 for everybody else, because
requireTab() short-circuits on super_admin before it looks for the
X-Workspace-Slug header. Use workspaceFetch() (or apiRequest()) from
@/lib/queryClient — both attach it.
`);
process.exit(LIST_ONLY ? 0 : 1);
