// The Mailer's "Send as" list — who an email comes FROM and where replies go.
//
// Daniel, 2026-10-09: "easy drop down select for sender details from and reply
// to … connected to clubos people — zach would be grassroots, olga could be
// connected to accounts@cufc.co.nz". Each sender is a real cufc.co.nz mailbox
// (outputs/identity-access/account-register.md), so a reply lands with a person
// who reads it. cufc.co.nz is a verified Resend sending domain, so any address
// on it can be the From.
//
// 🔴 People are linked by ClubOS USER ID, never by name or login email — Olga
// signs in with a Gmail address but sends as accounts@. Adding a person is one
// entry here; the page pre-selects the sender linked to whoever is signed in.

export type MailerSender = {
  id: string;
  label: string;            // what the dropdown shows
  fromName: string;         // the name the inbox shows
  email: string;            // From AND Reply-To
  userIds: number[];        // ClubOS users who send as this by default
};

export const CUFC_MAILER_SENDERS: MailerSender[] = [
  { id: "info", label: "Christchurch United FC — info@", fromName: "Christchurch United FC", email: "info@cufc.co.nz", userIds: [] },
  { id: "grassroots", label: "Grassroots (Zach) — grassroots@", fromName: "Christchurch United FC Grassroots", email: "grassroots@cufc.co.nz", userIds: [2] },
  { id: "accounts", label: "Accounts (Olga) — accounts@", fromName: "Christchurch United FC Accounts", email: "accounts@cufc.co.nz", userIds: [45] },
  { id: "academy", label: "Academy (Paul) — academy@", fromName: "Christchurch United FC Academy", email: "academy@cufc.co.nz", userIds: [4] },
  { id: "travis", label: "Travis Graham — travis@", fromName: "Travis Graham · Christchurch United FC", email: "travis@cufc.co.nz", userIds: [44] },
  { id: "ryan", label: "Ryan Edwards — ryan@", fromName: "Ryan Edwards · Christchurch United FC", email: "ryan@cufc.co.nz", userIds: [6] },
  { id: "daniel", label: "Daniel Meyn — daniel@", fromName: "Daniel Meyn · Christchurch United FC", email: "daniel@cufc.co.nz", userIds: [1] },
];

export function senderFrom(s: MailerSender): string {
  return `${s.fromName} <${s.email}>`;
}

/** The sender linked to this ClubOS user, else the club's main address. */
export function defaultSenderFor(userId: number | null | undefined): MailerSender {
  return CUFC_MAILER_SENDERS.find((s) => userId != null && s.userIds.includes(userId)) ?? CUFC_MAILER_SENDERS[0];
}
