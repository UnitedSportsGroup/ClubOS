/**
 * _verify-checkout-live.ts — does PRODUCTION still have a working card checkout?
 *
 * Why this exists (2026-09-03). Vite inlines VITE_* at BUILD time, so the Stripe
 * publishable key is baked into the client bundle. A deploy that does not pass
 * `--build-arg VITE_STRIPE_PUBLISHABLE_KEY` compiles
 *
 *     loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || "")
 *
 * down to `loadStripe("")`. Stripe never initialises, the Payment Element never
 * mounts, and the checkout step renders and simply sits there. Every card
 * checkout in ClubOS — camps, academy, membership, shop, venue, team pay — dies
 * at once, and it is INVISIBLE to a route probe: every endpoint still answers
 * 200, the booking row is still written, the PaymentIntent is still created.
 * The only symptom is that no human can ever reach a card field, which surfaces
 * as parents emailing the office days later.
 *
 * deploy.sh already refused to ship without the key in .env. That guards the
 * INPUT. Nothing asserted the OUTPUT, and the build args were dropped by a
 * deploy that went around the script. This asserts the output.
 *
 *   npx tsx --env-file=.env script/_verify-checkout-live.ts
 *   npx tsx --env-file=.env script/_verify-checkout-live.ts https://app.usg.co.nz
 *   npx tsx --env-file=.env script/_verify-checkout-live.ts --dist dist/public   (a local build)
 *
 * 🔴 2026-09-30: pages are now separate downloads (App.tsx lazy), so the key is
 * no longer in the entry file — Vite inlines it into EACH checkout page's own
 * chunk. The check follows the split: it reads every chunk the entry can load,
 * and asserts that as many chunks carry OUR key as there are source files that
 * read VITE_STRIPE_PUBLISHABLE_KEY (14 today). That is stricter than before:
 * one checkout compiled with an empty key now fails by itself instead of hiding
 * behind the other thirteen.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";

const args = process.argv.slice(2);
const distArg = args.includes("--dist") ? args[args.indexOf("--dist") + 1] : null;
const HOSTS = distArg ? [`file:${distArg}`] : args[0] ? [args[0]] : ["https://app.usg.co.nz", "https://join.cufc.co.nz"];

const expected = (process.env.VITE_STRIPE_PUBLISHABLE_KEY || "").trim();
let failed = 0;
const ok = (m: string) => console.log(`  ok   ${m}`);
const bad = (m: string) => { failed++; console.log(`  FAIL ${m}`); };

/* How many checkout surfaces there are = source files that read the key. */
function sourcesUsingKey(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const f of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, f.name);
      if (f.isDirectory()) walk(p);
      else if (/\.(tsx?|jsx?)$/.test(f.name) && readFileSync(p, "utf8").includes("VITE_STRIPE_PUBLISHABLE_KEY")) out.push(p);
    }
  };
  if (existsSync(dir)) walk(dir);
  return out;
}
const CLIENT = resolve(import.meta.dirname ?? __dirname, "../client/src");
const surfaces = sourcesUsingKey(CLIENT).length;

async function get(host: string, path: string): Promise<string> {
  if (host.startsWith("file:")) return readFileSync(join(host.slice(5), path.replace(/^\//, "")), "utf8");
  const r = await fetch(host + path, { redirect: "follow" });
  if (!r.ok) throw new Error(`${path} answered ${r.status}`);
  return r.text();
}

for (const host of HOSTS) {
  console.log(`\n${host}`);
  let html: string;
  try {
    html = await get(host, host.startsWith("file:") ? "/index.html" : "/");
  } catch (e: any) { bad(`could not reach ${host}: ${e.message}`); continue; }

  const entry = html.match(/\/assets\/index-[A-Za-z0-9_-]+\.js/)?.[0];
  if (!entry) { bad("no /assets/index-*.js referenced by the page"); continue; }
  ok(`entry ${entry}`);

  /* The entry and every chunk it can load (dynamic imports name them "./x.js"). */
  let entryJs: string;
  try { entryJs = await get(host, entry); } catch (e: any) { bad(`could not fetch the entry: ${e.message}`); continue; }
  const chunkNames = [...new Set([...entryJs.matchAll(/["'`]\.\/([A-Za-z0-9_-]+\.js)["'`]/g)].map((m) => m[1]))];
  const files: { name: string; js: string }[] = [{ name: entry, js: entryJs }];
  for (let i = 0; i < chunkNames.length; i += 24) {
    const batch = chunkNames.slice(i, i + 24);
    const got = await Promise.all(batch.map((n) => get(host, `/assets/${n}`).then((js) => ({ name: n, js })).catch(() => null)));
    for (const g of got) if (g) files.push(g);
  }
  ok(`read ${files.length} file(s) (entry + ${files.length - 1} chunk(s))`);

  // 1. A real publishable key must be present — in as many chunks as there are checkout surfaces.
  /* Vite inlines the key literal at EVERY place it is read, so it appears once
     per checkout surface — whether those surfaces share one file (an unsplit
     build) or each has its own chunk (split). Count occurrences, not files. */
  const keys = new Set<string>();
  let occurrences = 0;
  let withKey = 0;
  for (const f of files) {
    const k = f.js.match(/pk_live_[A-Za-z0-9]{20,}/g) || [];
    if (k.length) withKey++;
    occurrences += k.length;
    k.forEach((x) => keys.add(x));
  }
  if (keys.size === 0) bad("NO Stripe publishable key anywhere in the shipped app — every card checkout is dead");
  else ok(`Stripe key present (${[...keys][0].slice(0, 11)}…, ${keys.size} distinct) — ${occurrences} use(s) across ${withKey} file(s)`);
  if (surfaces && keys.size && occurrences < surfaces) {
    bad(`the key is inlined ${occurrences} time(s) but ${surfaces} source files read it — a checkout was built without it`);
  } else if (surfaces && keys.size) ok(`every checkout surface carries it (${occurrences} ≥ ${surfaces})`);

  // 2. It must be OUR key, not some other account's.
  if (expected && keys.size && (![...keys].includes(expected) || keys.size > 1)) {
    bad(`shipped key(s) do not match .env — prod would take money into the wrong Stripe account`);
  } else if (expected && keys.size) ok("shipped key matches .env");

  // 3. No checkout constructed with an empty key: a file that builds a Stripe
  //    promise with "" and carries NO real key is exactly the 2026-09-03 bug.
  const emptyOnly = files.filter((f) => /=\s*[A-Za-z_$][\w$]*\(""\)\s*[,;]/.test(f.js) && !/pk_live_[A-Za-z0-9]{20,}/.test(f.js) && /stripe/i.test(f.js));
  if (emptyOnly.length) bad(`${emptyOnly.length} Stripe file(s) initialise with an empty key: ${emptyOnly.map((f) => f.name).slice(0, 5).join(", ")}`);
  else ok("no Stripe initialisation with an empty key");
}

console.log(
  failed === 0
    ? "\n✓ Card checkout can mount on production.\n"
    : `\n✗ ${failed} check(s) failed — production cannot take a card payment.\n`,
);
process.exit(failed === 0 ? 0 : 1);
