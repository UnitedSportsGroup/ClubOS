// Can this address receive mail at all? — the Mailer's typed-address check.
//
// Daniel, 2026-10-25, having typed dmeyn@beastmail.com: "Do you think it's
// worth having some kind of check, especially if it can just be done super
// quickly, where it would only do it if it's a real email?"
//
// What CAN be known in a moment, from this server, without a third party:
//   1. the address is shaped like one (syntax);
//   2. the domain is a one-letter slip of a mailbox everyone uses (gmial.com);
//   3. the domain actually takes mail — it publishes MX records (or, failing
//      that, resolves at all). A DNS lookup, ~50 ms, cached per domain.
//
// What CANNOT be known cheaply: whether the MAILBOX exists. Probing a mail
// server for a mailbox (SMTP "RCPT TO") is unreliable — Gmail and Microsoft
// answer yes to everything, and doing it at volume gets our sending IP
// blocklisted. Resend's own bounce report is the real answer for a mailbox,
// after the fact. So this says "can't receive mail" only when the DOMAIN
// cannot, and never claims a mailbox is good.
//
// 🔴 IT FLAGS, IT NEVER BLOCKS. A failed lookup (timeout, our DNS down) reads
// as "not checked", not "bad" — a real family must never be struck off a
// send because a resolver hiccupped.
import dns from "node:dns";

export type Deliverability = {
  status: "ok" | "bad_syntax" | "no_domain" | "typo" | "unchecked";
  /** Plain English, shown beside the address. Null when ok. */
  reason: string | null;
  /** The address we think they meant, for a one-tap fix. */
  suggestion: string | null;
};

const SYNTAX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// One-letter slips of the mailboxes most families use. Keyed by the typo.
const TYPOS: Record<string, string> = {
  "gmial.com": "gmail.com", "gamil.com": "gmail.com", "gmai.com": "gmail.com", "gmail.co": "gmail.com",
  "gmail.con": "gmail.com", "gmail.cm": "gmail.com", "gmali.com": "gmail.com", "gmil.com": "gmail.com",
  "gnail.com": "gmail.com", "gmaill.com": "gmail.com", "gmail.co.nz": "gmail.com", "googlemail.co": "googlemail.com",
  "hotmal.com": "hotmail.com", "hotmial.com": "hotmail.com", "hotmai.com": "hotmail.com", "hotmail.co": "hotmail.com",
  "hotmail.con": "hotmail.com", "hotmil.com": "hotmail.com", "hotmaill.com": "hotmail.com",
  "outlok.com": "outlook.com", "outloo.com": "outlook.com", "outlook.co": "outlook.com", "outlook.con": "outlook.com",
  "yaho.com": "yahoo.com", "yahooo.com": "yahoo.com", "yahoo.co": "yahoo.com", "yahoo.con": "yahoo.com",
  "icloud.co": "icloud.com", "icloud.con": "icloud.com", "iclould.com": "icloud.com", "icoud.com": "icloud.com",
  "xtra.co": "xtra.co.nz", "xtra.com": "xtra.co.nz", "xtra.nz": "xtra.co.nz",
};

// Per-domain memory, so a list of 3,800 Gmail addresses asks DNS once.
const cache = new Map<string, { ok: boolean; until: number }>();
const TTL_MS = 6 * 60 * 60 * 1000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

/** true = takes mail · false = provably not · null = could not check. */
async function domainTakesMail(domain: string): Promise<boolean | null> {
  const hit = cache.get(domain);
  if (hit && hit.until > Date.now()) return hit.ok;
  let ok: boolean | null = null;
  try {
    const mx = await withTimeout(dns.promises.resolveMx(domain), 2500);
    ok = mx.length > 0;
  } catch (e: any) {
    const code = String(e?.code ?? e?.message ?? "");
    if (code === "ENOTFOUND" || code === "ENODATA" || code === "ESERVFAIL") {
      // No MX. A domain with only an A record can still take mail (rare, but
      // real for a small business running its own box), so check that too.
      try {
        const a = await withTimeout(dns.promises.resolve4(domain), 2000);
        ok = a.length > 0;
      } catch (e2: any) {
        const c2 = String(e2?.code ?? e2?.message ?? "");
        ok = c2 === "ENOTFOUND" || c2 === "ENODATA" ? false : null;
      }
    } else {
      ok = null;   // timeout or resolver trouble: say nothing
    }
  }
  if (ok !== null) cache.set(domain, { ok, until: Date.now() + TTL_MS });
  return ok;
}

export async function checkEmailDeliverability(raw: string): Promise<Deliverability> {
  const email = String(raw ?? "").trim().toLowerCase();
  if (!SYNTAX.test(email)) {
    return { status: "bad_syntax", reason: "That isn't a complete email address", suggestion: null };
  }
  const domain = email.slice(email.lastIndexOf("@") + 1);
  const fix = TYPOS[domain];
  if (fix) {
    return { status: "typo", reason: `Did you mean ${fix}?`, suggestion: email.slice(0, email.lastIndexOf("@") + 1) + fix };
  }
  const takes = await domainTakesMail(domain);
  if (takes === false) {
    return { status: "no_domain", reason: `${domain} can't receive email — nothing sent there will arrive`, suggestion: null };
  }
  if (takes === null) return { status: "unchecked", reason: null, suggestion: null };
  return { status: "ok", reason: null, suggestion: null };
}

/** Many at once, a few domains in flight at a time, in the order given. */
export async function checkManyDeliverability(emails: string[], concurrency = 8): Promise<Map<string, Deliverability>> {
  const out = new Map<string, Deliverability>();
  let i = 0;
  const worker = async () => {
    while (i < emails.length) {
      const e = emails[i++];
      out.set(e, await checkEmailDeliverability(e));
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, emails.length) }, worker));
  return out;
}
