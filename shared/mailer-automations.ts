// ─────────────────────────────────────────────────────────────────────────────
// Mailer Automations — the ONE place that says what an automation can be.
//
// Daniel, 2026-10-25: "a single email or a flow of like after purchase, after
// 1 day, after 3 days, 1 week, 30 days, on birthday etc … if bought then stop
// the sequence as that would be annoying". The page, the API and the runner all
// read this file, so a trigger or a timing the page offers is one the runner
// understands — and the sentence the page prints is the rule the runner runs.
//
// 🔴 Every email is timed FROM THE TRIGGER, never from the previous email.
// "3 days after they pay" stays 3 days after they pay when someone adds an
// email in front of it. That is how staff talk about it, and it means the
// order on screen is simply the order in time.
// ─────────────────────────────────────────────────────────────────────────────

export type TriggerType =
  | "registration_paid"
  | "registration_started"
  | "first_registration"
  | "birthday"
  | "programme_start"
  | "programme_end";

export type TimingUnit = "immediately" | "minutes" | "hours" | "days" | "weeks";
export type TimingDirection = "after" | "before";
export type AutomationStatus = "off" | "test" | "on";
export type EmailKind = "operational" | "marketing";

export interface TriggerMeta {
  type: TriggerType;
  /** The card heading. */
  label: string;
  /** One line under it. */
  blurb: string;
  /** "3 days {anchorPhrase}" — reads as a sentence on every email node. */
  anchorPhrase: string;
  /** "3 days before {beforePhrase}". Only date triggers allow "before". */
  beforePhrase?: string;
  /** A date trigger fires on a calendar day; its emails default to a time of day. */
  dateBased: boolean;
  /** Where the list groups it. */
  group: "purchase" | "unfinished" | "welcome" | "dates";
  /** The abandoned-cart flow always offers "stop when they pay". */
  canStopOnPayment: boolean;
}

export const TRIGGERS: Record<TriggerType, TriggerMeta> = {
  registration_paid: {
    type: "registration_paid",
    label: "Post purchase",
    blurb: "Starts the moment a registration is paid for.",
    anchorPhrase: "after they pay",
    dateBased: false,
    group: "purchase",
    canStopOnPayment: false,
  },
  registration_started: {
    type: "registration_started",
    label: "Abandoned cart",
    blurb: "Someone started registering and didn't pay. Stops the moment they do.",
    anchorPhrase: "after they stopped at checkout",
    dateBased: false,
    group: "unfinished",
    canStopOnPayment: true,
  },
  first_registration: {
    type: "first_registration",
    label: "Welcome a new family",
    blurb: "A family's first ever paid registration with the club.",
    anchorPhrase: "after their first registration",
    dateBased: false,
    group: "welcome",
    canStopOnPayment: false,
  },
  birthday: {
    type: "birthday",
    label: "Player's birthday",
    blurb: "On the birthday of a registered player.",
    anchorPhrase: "after their birthday",
    beforePhrase: "their birthday",
    dateBased: true,
    group: "dates",
    canStopOnPayment: false,
  },
  programme_start: {
    type: "programme_start",
    label: "Around the start date",
    blurb: "Before or after the programme (or its term) starts.",
    anchorPhrase: "after it starts",
    beforePhrase: "it starts",
    dateBased: true,
    group: "dates",
    canStopOnPayment: false,
  },
  programme_end: {
    type: "programme_end",
    label: "Around the end date",
    blurb: "Before or after the programme (or its term) finishes.",
    anchorPhrase: "after it ends",
    beforePhrase: "it ends",
    dateBased: true,
    group: "dates",
    canStopOnPayment: false,
  },
};

export const TRIGGER_ORDER: TriggerType[] = [
  "registration_paid",
  "registration_started",
  "first_registration",
  "programme_start",
  "programme_end",
  "birthday",
];

export const GROUP_LABELS: Record<TriggerMeta["group"], string> = {
  purchase: "Post purchase",
  unfinished: "Abandoned cart",
  welcome: "Welcome",
  dates: "Dates — start, end and birthdays",
};

export const TIMING_UNITS: TimingUnit[] = ["immediately", "minutes", "hours", "days", "weeks"];
export const UNIT_MINUTES: Record<TimingUnit, number> = {
  immediately: 0,
  minutes: 1,
  hours: 60,
  days: 60 * 24,
  weeks: 60 * 24 * 7,
};

export function isTriggerType(v: unknown): v is TriggerType {
  return typeof v === "string" && v in TRIGGERS;
}
export function isTimingUnit(v: unknown): v is TimingUnit {
  return typeof v === "string" && (TIMING_UNITS as string[]).includes(v);
}
export function isStatus(v: unknown): v is AutomationStatus {
  return v === "off" || v === "test" || v === "on";
}

export interface StepTiming {
  timingUnit: TimingUnit;
  timingAmount: number;
  timingDirection: TimingDirection;
  /** "HH:MM", NZ time. Only meaningful for days/weeks (and date triggers). */
  sendTime: string | null;
}

/** Signed minutes from the anchor. "Before" is negative. */
export function offsetMinutes(t: Pick<StepTiming, "timingUnit" | "timingAmount" | "timingDirection">): number {
  const m = t.timingUnit === "immediately" ? 0 : Math.max(0, Math.round(t.timingAmount)) * UNIT_MINUTES[t.timingUnit];
  return t.timingDirection === "before" ? -m : m;
}

export function isValidSendTime(v: unknown): v is string {
  return typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
}

/** A time of day only applies when the gap is whole days or weeks — "2 hours
 *  after, at 9am" contradicts itself. */
export function sendTimeApplies(t: Pick<StepTiming, "timingUnit">, trigger: TriggerType): boolean {
  if (t.timingUnit === "days" || t.timingUnit === "weeks") return true;
  return TRIGGERS[trigger].dateBased && t.timingUnit === "immediately";
}

function plural(n: number, unit: string): string {
  const one = unit.replace(/s$/, "");
  return `${n} ${n === 1 ? one : unit}`;
}

export function formatClock(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const suffix = h >= 12 ? "pm" : "am";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${h12}${suffix}` : `${h12}:${String(m).padStart(2, "0")}${suffix}`;
}

/** The sentence on every email node: "Sends 3 days after they pay, at 9am". */
export function timingSentence(t: StepTiming, trigger: TriggerType): string {
  const meta = TRIGGERS[trigger];
  const at = t.sendTime && sendTimeApplies(t, trigger) ? `, at ${formatClock(t.sendTime)}` : "";
  if (t.timingUnit === "immediately" || t.timingAmount <= 0) {
    if (meta.dateBased) {
      const day = trigger === "birthday" ? "On their birthday" : trigger === "programme_start" ? "On the day it starts" : "On the day it ends";
      return `${day}${at || (t.sendTime ? "" : ", at 9am")}`;
    }
    return "Sends straight away";
  }
  const span = plural(t.timingAmount, t.timingUnit);
  if (t.timingDirection === "before" && meta.beforePhrase) return `Sends ${span} before ${meta.beforePhrase}${at}`;
  return `Sends ${span} ${meta.anchorPhrase}${at}`;
}

/** A short chip for the list's mini-timeline: "Now", "2h", "1d", "1w". */
export function timingChip(t: StepTiming): string {
  if (t.timingUnit === "immediately" || t.timingAmount <= 0) return "Day 0";
  const u = t.timingUnit === "minutes" ? "m" : t.timingUnit === "hours" ? "h" : t.timingUnit === "days" ? "d" : "w";
  return `${t.timingDirection === "before" ? "−" : "+"}${t.timingAmount}${u}`;
}

// ── New Zealand time, without a library ───────────────────────────────────────
// Every time a parent sees is Pacific/Auckland. A server clock is UTC, and a
// "9am" computed in UTC lands at 9pm or 10pm in NZ.

const NZ = "Pacific/Auckland";

export function nzParts(d: Date): { y: number; mo: number; d: number; h: number; mi: number } {
  const f = new Intl.DateTimeFormat("en-NZ", {
    timeZone: NZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  });
  const p: Record<string, string> = {};
  for (const x of f.formatToParts(d)) p[x.type] = x.value;
  return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour % 24, mi: +p.minute };
}

/** The UTC instant at which the NZ wall clock reads y-mo-d h:mi. Two passes
 *  settle the daylight-saving offset (NZ moves in April and September). */
export function nzWallToUtc(y: number, mo: number, d: number, h: number, mi: number): Date {
  let guess = Date.UTC(y, mo - 1, d, h, mi);
  for (let i = 0; i < 2; i++) {
    const p = nzParts(new Date(guess));
    const shown = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi);
    guess += Date.UTC(y, mo - 1, d, h, mi) - shown;
  }
  return new Date(guess);
}

/** Midnight NZ at the start of an ISO date ("2026-11-03"). Never through `new Date(iso)`,
 *  which reads the date as UTC and lands on the wrong NZ day. */
export function nzMidnight(iso: string): Date {
  const [y, mo, d] = iso.slice(0, 10).split("-").map(Number);
  return nzWallToUtc(y, mo, d, 0, 0);
}

export const QUIET_FROM_HOUR = 20; // 8pm
export const QUIET_UNTIL_HOUR = 8; // 8am

/** Inside 8pm–8am NZ → the next 8am. Otherwise unchanged. */
export function outOfQuietHours(at: Date): Date {
  const p = nzParts(at);
  if (p.h >= QUIET_FROM_HOUR) {
    const next = new Date(nzWallToUtc(p.y, p.mo, p.d, 12, 0).getTime() + 24 * 3600 * 1000);
    const n = nzParts(next);
    return nzWallToUtc(n.y, n.mo, n.d, QUIET_UNTIL_HOUR, 0);
  }
  if (p.h < QUIET_UNTIL_HOUR) return nzWallToUtc(p.y, p.mo, p.d, QUIET_UNTIL_HOUR, 0);
  return at;
}

/** When one email is due for one family. */
export function dueAt(anchor: Date, step: StepTiming, trigger: TriggerType, quietHours: boolean): Date {
  let at = new Date(anchor.getTime() + offsetMinutes(step) * 60_000);
  const time = step.sendTime ?? (TRIGGERS[trigger].dateBased ? "09:00" : null);
  if (time && sendTimeApplies(step, trigger)) {
    const p = nzParts(at);
    const [h, m] = time.split(":").map(Number);
    at = nzWallToUtc(p.y, p.mo, p.d, h, m);
  }
  return quietHours ? outOfQuietHours(at) : at;
}

// ── Merge tags offered in an automation email ─────────────────────────────────

export const AUTOMATION_MERGE_TAGS: { tag: string; label: string }[] = [
  { tag: "{{first_name}}", label: "Parent's first name" },
  { tag: "{{player_first_name}}", label: "Player's first name" },
  { tag: "{{programme_name}}", label: "Programme name" },
  { tag: "{{programme_start_date}}", label: "Start date" },
  { tag: "{{programme_link}}", label: "Link to register" },
];

// ── Starter flows ─────────────────────────────────────────────────────────────
// What a new automation opens with, so nobody starts from a blank page. The
// words are a first draft for staff to make their own; no prices, no discount
// codes (fees are Ryan's call and the printed fee schedule prevails).

export interface StarterStep extends StepTiming {
  subject: string;
  preheader?: string;
  bodyHtml: string;
}

export interface StarterFlow {
  key: string;
  name: string;
  description: string;
  trigger: TriggerType;
  stopOnPayment: boolean;
  emailKind: EmailKind;
  steps: StarterStep[];
}

const p = (...lines: string[]) => lines.map((l) => `<p style="margin:0 0 14px;line-height:1.55;">${l}</p>`).join("\n");
const letter = (inner: string) =>
  `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#1f2937;max-width:560px;margin:0 auto;padding:24px 8px;">\n${inner}\n</div>`;
const button = (label: string, href: string) =>
  `<p style="margin:22px 0;"><a href="${href}" style="display:inline-block;background:#22399B;color:#ffffff;text-decoration:none;font-weight:bold;padding:12px 22px;border-radius:8px;">${label}</a></p>`;

const step = (
  timingUnit: TimingUnit, timingAmount: number, subject: string, bodyHtml: string,
  extra: Partial<StepTiming> = {},
): StarterStep => ({
  timingUnit, timingAmount, timingDirection: "after", sendTime: null, subject, bodyHtml, ...extra,
});

export const STARTER_FLOWS: StarterFlow[] = [
  {
    key: "after_purchase",
    name: "Post purchase",
    description: "Follow-ups after a family registers. The receipt still goes the moment they pay; these come after it.",
    trigger: "registration_paid",
    stopOnPayment: false,
    emailKind: "operational",
    steps: [
      step("days", 1, "What to expect at {{programme_name}}", letter(p(
        "Hi {{first_name}},",
        "Thanks again for registering {{player_first_name}} for {{programme_name}}. Here's everything you need for the first session.",
        "<strong>When:</strong> from {{programme_start_date}}<br/><strong>Bring:</strong> boots or trainers, shin pads, a drink bottle and a warm layer.",
        "If anything changes, just reply to this email and the office will sort it.",
        "See you there,<br/>Christchurch United",
      )), { sendTime: "09:00" }),
      step("weeks", 1, "How is {{player_first_name}} finding it?", letter(p(
        "Hi {{first_name}},",
        "{{player_first_name}} has had a week at {{programme_name}}. We'd love to hear how it's going — just hit reply.",
        "Christchurch United",
      )), { sendTime: "10:00" }),
    ],
  },
  {
    key: "unfinished_registration",
    name: "Abandoned cart",
    description: "Reminds a family who started registering and didn't pay. Stops the moment they pay.",
    trigger: "registration_started",
    stopOnPayment: true,
    emailKind: "operational",
    steps: [
      step("hours", 2, "Your spot in {{programme_name}} isn't booked yet", letter(p(
        "Hi {{first_name}},",
        "It looks like you started registering for {{programme_name}} but didn't get to the end. Your registration isn't complete until it's paid.",
      ) + button("Finish registering", "{{programme_link}}") + p(
        "Had trouble at checkout? Reply to this email and we'll help.",
        "Christchurch United",
      ))),
      step("days", 1, "Still keen on {{programme_name}}?", letter(p(
        "Hi {{first_name}},",
        "Just a reminder that your registration for {{programme_name}} is still unfinished.",
      ) + button("Finish registering", "{{programme_link}}") + p("Christchurch United")), { sendTime: "10:00" }),
      step("days", 3, "Last reminder: {{programme_name}}", letter(p(
        "Hi {{first_name}},",
        "This is our last reminder about {{programme_name}}. If you'd still like a spot, you can finish registering here:",
      ) + button("Finish registering", "{{programme_link}}") + p(
        "If it's not the right time, no worries — we won't email about this again.",
        "Christchurch United",
      )), { sendTime: "10:00" }),
    ],
  },
  {
    key: "welcome",
    name: "Welcome a new family",
    description: "Sent once, on a family's first ever registration with the club.",
    trigger: "first_registration",
    stopOnPayment: false,
    emailKind: "marketing",
    steps: [
      step("hours", 1, "Welcome to Christchurch United", letter(p(
        "Hi {{first_name}},",
        "Welcome to the club! We're really glad {{player_first_name}} is joining us.",
        "Over the coming weeks you'll hear from us about sessions, holiday camps and club days. If you ever have a question, just reply — a real person reads every email.",
        "Christchurch United",
      ))),
    ],
  },
  {
    key: "birthday",
    name: "Happy birthday",
    description: "A birthday message to a registered player's family.",
    trigger: "birthday",
    stopOnPayment: false,
    emailKind: "marketing",
    steps: [
      step("immediately", 0, "Happy birthday {{player_first_name}}!", letter(p(
        "Hi {{first_name}},",
        "Everyone at Christchurch United wishes {{player_first_name}} a very happy birthday today!",
        "Christchurch United",
      )), { sendTime: "09:00" }),
    ],
  },
  {
    key: "before_start",
    name: "Before the programme starts",
    description: "Reminders in the days before the first session.",
    trigger: "programme_start",
    stopOnPayment: false,
    emailKind: "operational",
    steps: [
      step("days", 3, "{{programme_name}} starts soon", letter(p(
        "Hi {{first_name}},",
        "{{programme_name}} starts on {{programme_start_date}}. We can't wait to see {{player_first_name}} there.",
        "<strong>Bring:</strong> boots or trainers, shin pads, a drink bottle and a warm layer.",
        "Christchurch United",
      )), { timingDirection: "before", sendTime: "09:00" }),
      step("days", 1, "See you tomorrow at {{programme_name}}", letter(p(
        "Hi {{first_name}},",
        "Just a quick reminder — {{programme_name}} starts tomorrow. See you there!",
        "Christchurch United",
      )), { timingDirection: "before", sendTime: "16:00" }),
    ],
  },
  {
    key: "after_end",
    name: "After the programme ends",
    description: "A thank-you, then a nudge about what's next.",
    trigger: "programme_end",
    stopOnPayment: false,
    emailKind: "marketing",
    steps: [
      step("days", 1, "Thanks for a great term", letter(p(
        "Hi {{first_name}},",
        "Thanks for being part of {{programme_name}}. We loved having {{player_first_name}} with us.",
        "Christchurch United",
      )), { sendTime: "10:00" }),
      step("days", 30, "What's next for {{player_first_name}}?", letter(p(
        "Hi {{first_name}},",
        "Registrations for the next programme are open. We'd love to see {{player_first_name}} back.",
        "Christchurch United",
      )), { sendTime: "10:00" }),
    ],
  },
];

export function starterFlow(key: string): StarterFlow | undefined {
  return STARTER_FLOWS.find((f) => f.key === key);
}
