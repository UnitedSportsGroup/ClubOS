/* 🔴 THE ONE DECIDER for whether a public form submission looks like a person.
 *
 * Ported verbatim from apps/atarangi-lodge, where the lodge's enquiry form was
 * found on 10 Sept 2026 to have mailed 25 harvested strangers in a single day —
 * a form that emails the submitter a copy is not merely a form that RECEIVES
 * spam, it is one that SENDS it, from a verified sending domain.
 *
 * Pure functions only: no database, no request object, so the same rules can be
 * unit-tested, run on the server and (if ever needed) reasoned about on the
 * client. The decision itself lives in server/form-guard.ts.
 *
 * The governing asymmetry, and the reason nothing here ever rejects outright:
 * a bot getting through costs somebody one junk email; a real parent turned
 * away costs a registration and nobody ever finds out. So two independent
 * signals are always required, and the caller's response is identical either
 * way — a bot that can tell accepted from held tunes itself until it passes.
 */

/** Lower→upper transitions inside a word: "urGjzFiQUffjCyKEe" has many, "Jane" none. */
function caseFlips(s: string): number {
  let n = 0;
  for (let i = 1; i < s.length; i++) {
    const prev = s[i - 1];
    const cur = s[i];
    if (!/[A-Za-z]/.test(prev) || !/[A-Za-z]/.test(cur)) continue;
    if (prev === prev.toLowerCase() && cur === cur.toUpperCase()) n++;
  }
  return n;
}

/** Text that reads as a random token rather than as writing. */
export function looksRandom(raw: string | null | undefined): boolean {
  const s = (raw ?? "").trim();
  if (s.length < 10) return false;
  const oneWord = !/\s/.test(s);
  if (oneWord && s.length >= 12 && /^[A-Za-z0-9]+$/.test(s)) return true;
  if (oneWord && caseFlips(s) >= 3) return true;
  return false;
}

/* 🔴 Deliberately NOT a consonant-run test. "Grzegorz Brzęczyszczykiewicz" is a
 * real name and a consonant rule reads it as a bot. A word of four or more
 * letters with NO vowel at all — "Rqqcdq", "Kczf" — is the safe version, and
 * accented vowels count so it does not fire on te reo or European names. */
export function vowellessName(raw: string | null | undefined): boolean {
  // 🔴 No /u flag and no \p{L} — this tsconfig targets below ES6 and TS1501s on
  // both. The explicit ranges cover Latin, accented European letters and the
  // macronised vowels of te reo Māori (Ā-ž spans U+0100–U+017E).
  const words = (raw ?? "").split(/\s+/).filter((w) => w.length >= 4 && /^[A-Za-z\u00C0-\u024F'-]+$/.test(w));
  if (!words.length) return false;
  return words.some((w) => !/[aeiouyàáâäãåèéêëìíîïòóôöõùúûüỳýÿœæ]/i.test(w));
}

/* 🔴 A name-shaped field is judged by DIFFERENT rules than prose.
 * `looksRandom` fires on any one-word alphanumeric string of twelve characters
 * or more — which is what a team name looks like ("TheKickers2026"). So a field
 * that holds a name, a team, a business gets only the two tests that a real one
 * cannot trip: no vowel at all, or capitals scattered through the middle.
 * Found by a live probe: the MFL waitlist form has NO prose field, so with the
 * team name unjudged the only signal available was the contact name, and one
 * signal never holds anything. */
export function looksRandomName(raw: string | null | undefined): boolean {
  const s = (raw ?? "").trim();
  if (vowellessName(s)) return true;
  return s.length >= 10 && !/\s/.test(s) && caseFlips(s) >= 3;
}

const LINK_RE = /(https?:\/\/|www\.|\[url|<a\s|\bt\.me\/|\bbit\.ly\/)/i;
export function hasLink(s: string | null | undefined): boolean {
  return LINK_RE.test(s ?? "");
}

export interface ContentInput {
  name?: string | null;
  /** Every free-text field a human is supposed to have written. */
  text?: (string | null | undefined)[];
  /** Name-shaped fields — a team, a business, a child. Judged by name rules only. */
  names?: (string | null | undefined)[];
  /** Dates the form collected, as submitted (YYYY-MM-DD), with today for comparison. */
  dates?: (string | null | undefined)[];
  today?: string;
}

/** The named signals in a payload. Two or more means hold it. */
export function contentSignals(input: ContentInput): string[] {
  const out: string[] = [];
  const texts = (input.text ?? []).filter(Boolean) as string[];
  if (texts.some((t) => looksRandom(t))) out.push("random_text");
  if (looksRandom(input.name) || vowellessName(input.name)) out.push("random_name");
  if ((input.names ?? []).some((n) => looksRandomName(n))) out.push("random_name_field");
  if (texts.some((t) => hasLink(t))) out.push("link_in_message");
  for (const d of input.dates ?? []) {
    if (!d) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) { out.push("invalid_date"); break; }
    // 1970-05-31 in every date field is the Unix epoch leaking out of a bot.
    if (input.today && d < input.today) { out.push("date_in_past"); break; }
  }
  return out;
}

/** Plain English for the admin, so a held submission can be judged by a human. */
export const GUARD_REASON_TEXT: Record<string, string> = {
  honeypot: "filled a hidden field",
  no_form_token: "posted straight at the API",
  bad_form_token: "invalid form token",
  submitted_too_fast: "submitted in under 3 seconds",
  stale_form_token: "form was more than 6 hours old",
  random_text: "message reads as random characters",
  random_name: "name reads as random characters",
  random_name_field: "a name field reads as random characters",
  link_in_message: "contained a link",
  invalid_date: "impossible date",
  date_in_past: "date in the past",
  ip_rate_hour: "more than 5 submissions from that address in an hour",
  ip_rate_day: "more than 15 submissions from that address in a day",
  email_rate_hour: "same email more than 3 times in an hour",
};

export const GUARD_THRESHOLD = 2;
