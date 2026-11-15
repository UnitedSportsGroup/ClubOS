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
  email: string;            // From (and Reply-To unless replyTo is set)
  userIds: number[];        // ClubOS users who send as this by default
  /** Where replies land when it is not the From address — a noreply@ sender
   *  on a brand domain whose replies go to a real inbox. */
  replyTo?: string;
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

// ── Every other workspace (2026-11-14, Daniel: "make mailer same for all
// workspaces same as cufc") ────────────────────────────────────────────────
// Each brand's own From addresses, on its own verified sending domain, with
// replies going to the inbox that brand already uses. These are the addresses
// the old per-brand mailers sent from, so nothing about a family's inbox moves.
export const SIU_MAILER_SENDERS: MailerSender[] = [
  { id: "siu", label: "South Island United — noreply@ (replies to info@)", fromName: "South Island United", email: "noreply@southislandunited.com", replyTo: "info@southislandunited.com", userIds: [] },
];
export const MFL_MAILER_SENDERS: MailerSender[] = [
  { id: "mfl", label: "Mini Football Leagues — noreply@ (replies to minifootball@cufc.co.nz)", fromName: "Mini Football Leagues", email: "noreply@minifootball.co.nz", replyTo: "minifootball@cufc.co.nz", userIds: [] },
];
export const CIC_MAILER_SENDERS: MailerSender[] = [
  { id: "cic-youth", label: "Christchurch International Cup — noreply@cicyouth.com", fromName: "Christchurch International Cup", email: "noreply@cicyouth.com", replyTo: "info@cicyouth.com", userIds: [] },
  { id: "cic-7s", label: "CIC 7's — noreply@cic7s.com", fromName: "CIC 7's", email: "noreply@cic7s.com", replyTo: "info@cicyouth.com", userIds: [] },
];
export const CUGC_MAILER_SENDERS: MailerSender[] = [
  { id: "cugc", label: "United Gymnastics — noreply@ (replies to info@cugc.co.nz)", fromName: "Christchurch United Gymnastics Club", email: "noreply@cugc.co.nz", replyTo: "info@cugc.co.nz", userIds: [] },
];

/** The senders a workspace's Mailer offers. Unknown workspace → CUFC's. */
export function mailerSendersFor(orgSlug: string | null | undefined): MailerSender[] {
  switch (orgSlug) {
    case "south-island-united": return SIU_MAILER_SENDERS;
    case "mini-football-leagues": return MFL_MAILER_SENDERS;
    case "christchurch-international-cup": return CIC_MAILER_SENDERS;
    case "united-gymnastics": return CUGC_MAILER_SENDERS;
    default: return CUFC_MAILER_SENDERS;
  }
}

/** Where replies go for this sender. */
export function senderReplyTo(s: MailerSender): string {
  return s.replyTo ?? s.email;
}

export function senderFrom(s: MailerSender): string {
  return `${s.fromName} <${s.email}>`;
}

/** The sender linked to this ClubOS user, else the club's main address. */
export function defaultSenderFor(userId: number | null | undefined, list: MailerSender[] = CUFC_MAILER_SENDERS): MailerSender {
  return list.find((s) => userId != null && s.userIds.includes(userId)) ?? list[0];
}
