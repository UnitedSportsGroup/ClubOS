// Which address actually reaches a person — the ONE rule, shared by the
// Mailer's recipient search, the "email this person" link on a profile and the
// Contacts list, and the person page's own hint.
//
// Daniel, 2026-11-03: "if kid doesn't have email for them personally it will
// email parents but still shows up on kids profile because often times Olga
// and Travis won't know parents name but will know kid name from like coaches
// roll etc."
//
// 🔴 THEIR OWN ADDRESS WINS WHEN THEY HAVE ONE. Otherwise EVERY parent on file
// with an address, each one named — a child with two parents on file is
// emailed at both mailboxes, and the chip on the Mailer says whose mailbox
// each one is. Never silently: a player's own (usually empty) email field
// attached without a word would look like it worked and email nobody.
//
// Pure, no imports: the server and the browser read the same function.

export type ReachGuardian = { name: string; email: string | null | undefined };

/** One mailbox that reaches the person, and whose it is when not their own. */
export type ReachAddress = { email: string; owner: string | null };

const clean = (e: string | null | undefined) => String(e ?? "").trim().toLowerCase();

/**
 * The addresses that reach a person: their own, else each guardian's.
 * Deduped by address (two parents sharing one mailbox are one send).
 */
export function reachableAddresses(own: string | null | undefined, guardians: ReachGuardian[]): ReachAddress[] {
  const mine = clean(own);
  if (mine) return [{ email: mine, owner: null }];
  const out: ReachAddress[] = [];
  const seen = new Set<string>();
  for (const g of guardians) {
    const e = clean(g.email);
    if (!e || seen.has(e)) continue;
    seen.add(e);
    out.push({ email: e, owner: g.name.trim() || "their parent" });
  }
  return out;
}

/** Why nobody can be emailed, worded for the kind of person. */
export function unreachableReason(type: string | null | undefined): string {
  return type === "player" ? "no email, and no parent on file with one" : "no email on file";
}
