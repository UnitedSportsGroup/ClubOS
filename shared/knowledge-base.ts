// ─────────────────────────────────────────────────────────────────────────────
// Knowledge Base — the club's vault, and the scope rules Rambo answers under.
//
// Two things live here because they must never drift apart:
//
//  1. The BRANDS a piece of knowledge can belong to (United Prints, CUFC, CIC…).
//  2. The ONE decider for whether a person may see a given piece of information —
//     used by the article reader, by Rambo's tool list, and by every stat tool's
//     own re-check. Three call sites, one function.
//
// 🔴 The whole point of the tab-based model: Rambo is not a new permission
// system. A person can learn through Rambo exactly what they could have learned
// by clicking around ClubOS themselves, and nothing else. If the Budget tab is
// closed to them, the budget is closed to them here — no matter how the question
// is phrased.
// ─────────────────────────────────────────────────────────────────────────────
import { canAccessTab, SUPER_ADMIN_ONLY_TABS, tabsForOrgSlug } from "./tabs";

// ── Brands ───────────────────────────────────────────────────────────────────
// A brand is the FILTER a reader picks ("show me United Prints knowledge"), not
// a permission. Knowledge about how we print a banner is not secret; the stats
// behind a tab are. Keep those two ideas apart.
export interface KbBrand {
  key: string;
  label: string;
  short: string;
  /** The ClubOS workspace this brand maps to, where one exists. */
  orgSlug?: string;
}

export const KB_BRANDS: KbBrand[] = [
  { key: "usg", label: "United Sports Group", short: "USG", orgSlug: "united-sports-group" },
  { key: "cufc", label: "Christchurch United FC", short: "CUFC", orgSlug: "christchurch-united" },
  { key: "siu", label: "South Island United", short: "SIU", orgSlug: "south-island-united" },
  { key: "mfl", label: "Mini Football Leagues", short: "MFL", orgSlug: "mini-football-leagues" },
  { key: "cic", label: "Christchurch International Cup", short: "CIC", orgSlug: "christchurch-international-cup" },
  { key: "cugc", label: "United Gymnastics", short: "Gymnastics", orgSlug: "united-gymnastics" },
  { key: "prints", label: "United Prints", short: "Prints", orgSlug: "united-prints" },
  { key: "usc", label: "United Sports Centre", short: "USC", orgSlug: "united-sports-centre" },
];

export const KB_BRAND_KEYS = KB_BRANDS.map((b) => b.key);

export function kbBrandLabel(key: string | null | undefined): string {
  if (!key || key === "all") return "All brands";
  return KB_BRANDS.find((b) => b.key === key)?.label ?? key;
}

export function isKbBrand(key: unknown): key is string {
  return typeof key === "string" && (key === "all" || KB_BRAND_KEYS.includes(key));
}

/** Article lifecycle. Only `published` is searchable by other staff or Rambo. */
export const KB_STATUSES = ["draft", "published", "archived"] as const;
export type KbStatus = (typeof KB_STATUSES)[number];

// Categories are a starting vocabulary, not a closed enum — the column is free
// text so a team can name its own. These seed the dropdown.
export const KB_CATEGORY_SUGGESTIONS = [
  "Print specifications",
  "Design specs",
  "File formats",
  "Placement & sizing",
  "Pricing & quoting",
  "How-to",
  "Policy",
  "Process",
  "Suppliers & contacts",
  "Troubleshooting",
  "Onboarding",
];

// ── The viewer ───────────────────────────────────────────────────────────────
// Built SERVER-SIDE from the live database on every request. Never accepted
// from the client, never cached in the session: revoking someone's access has
// to bite on their next message, not on their next login.
export interface ViewerMembership {
  orgSlug: string;
  orgName: string;
  /** Membership role in this workspace: admin | manager | team_member | coach … */
  role: string | null;
  /** Per-member tab whitelist. null = every tab in the workspace (legacy default). */
  tabs: string[] | null;
  /** Locked tabs (SUPER_ADMIN_ONLY_TABS) granted to this person by name.
   *  null/[] = none. A role never puts a slug in here. */
  unlockedTabs?: string[] | null;
}

export interface Viewer {
  userId: number;
  name: string;
  /** Global role — only "super_admin" is special. */
  globalRole: string | null;
  memberships: ViewerMembership[];
  /** The workspace the person is standing in (X-Workspace-Slug) — the club-data
   *  tools answer about THIS organisation and re-check the tab there. */
  workspaceSlug?: string | null;
}

/**
 * Can this person reach `tabSlug`, and if so through which workspace?
 *
 * 🔴 THE TRAP THIS EXISTS TO CLOSE. `canAccessTab` returns true for ANY slug
 * when the member's role is admin or manager — it assumes the caller already
 * knows the tab belongs to that workspace, because the sidebar only ever asks
 * about tabs it is already rendering. Ask it cold, and Dima (an admin of United
 * Prints) "can access" the Budget tab, which only exists in USG. Rambo asks
 * cold. So the tab must be proven to EXIST in the workspace before the role is
 * allowed to answer for it.
 *
 * Everything else defers to canAccessTab so this can never drift from what the
 * sidebar shows and requireTab enforces.
 */
export function viewerCanReachTab(
  viewer: Viewer,
  tabSlug: string,
  orgSlug?: string,
): { allowed: boolean; via?: ViewerMembership } {
  // Super-admin-only tabs (budget, cashflow, housing, vehicles…): the global
  // role is the only key, or an explicit per-person grant on the membership.
  // No workspace ROLE opens these, by design — which is why this checks
  // `unlockedTabs` and never `tabs`.
  if (SUPER_ADMIN_ONLY_TABS.has(tabSlug)) {
    if (viewer.globalRole === "super_admin") return { allowed: true };
    const candidates = orgSlug
      ? viewer.memberships.filter((m) => m.orgSlug === orgSlug)
      : viewer.memberships;
    // The tab must still LIVE in the workspace granting it — the same cold-ask
    // trap this function exists to close applies to a grant as much as a role.
    const via = candidates.find(
      (m) =>
        Array.isArray(m.unlockedTabs) &&
        m.unlockedTabs.includes(tabSlug) &&
        tabsForOrgSlug(m.orgSlug).some((t) => t.slug === tabSlug),
    );
    return via ? { allowed: true, via } : { allowed: false };
  }
  if (viewer.globalRole === "super_admin") return { allowed: true };

  const candidates = orgSlug
    ? viewer.memberships.filter((m) => m.orgSlug === orgSlug)
    : viewer.memberships;

  for (const m of candidates) {
    const tabLivesHere = tabsForOrgSlug(m.orgSlug).some((t) => t.slug === tabSlug);
    if (!tabLivesHere) continue;
    const ok = canAccessTab({
      globalRole: viewer.globalRole,
      membershipRole: m.role,
      membershipTabs: m.tabs,
      tabSlug,
    });
    if (ok) return { allowed: true, via: m };
  }
  return { allowed: false };
}

/**
 * May this person read an article? An article with no `requiredTab` is open to
 * every staff member — that is the normal case and the point of the vault.
 */
export function viewerCanReadArticle(
  viewer: Viewer,
  article: { requiredTab?: string | null; requiredWorkspace?: string | null },
): boolean {
  if (!article.requiredTab) return true;
  return viewerCanReachTab(viewer, article.requiredTab, article.requiredWorkspace ?? undefined).allowed;
}

// ── Rambo's tools ────────────────────────────────────────────────────────────
// A closed catalogue. Rambo cannot write SQL, cannot pick a table, and cannot
// widen its own reach: each tool is a hand-written, parameter-bounded query,
// and the list handed to the model is filtered per request by the rules above.
//
// 🔴 Tools a person cannot use are NEVER SENT TO THE MODEL. Not sent-and-
// refused, not sent-with-a-warning — absent. A model cannot leak, be talked
// into, or hallucinate its way past a capability it was never given, and no
// prompt-injection in an article body can conjure one. Restricted data must
// never enter the context in the first place.
export interface RamboToolDef {
  name: string;
  /** Shown to the human in "what Rambo can see for you". */
  title: string;
  /** Shown to the model. */
  description: string;
  /** The ClubOS tab this data lives behind. null = open to all staff. */
  requiredTab: string | null;
  /** Judge the tab in this workspace specifically. Omit for "any of theirs". */
  workspaceSlug?: string;
  inputSchema: Record<string, unknown>;
}

export const RAMBO_TOOLS: RamboToolDef[] = [
  {
    name: "search_knowledge_base",
    title: "The knowledge base",
    description:
      "Search the club's knowledge base for written articles, specifications and procedures. " +
      "ALWAYS use this before answering any question about how the club does something. " +
      "Returns article titles, categories and their full text.",
    requiredTab: null,
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Keywords to search for, e.g. 'banner roll width' or 'file format for corflute'." },
        brand: {
          type: "string",
          description:
            "Optional brand filter. One of: " + KB_BRAND_KEYS.join(", ") + ". Omit to search every brand.",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "print_materials",
    title: "United Prints materials & rates",
    description:
      "The live United Prints product catalogue: every material, its pricing method and rates, its minimum and maximum " +
      "printable size in millimetres, the printer roll width it runs on, turnaround days, and whether it needs a human quote. " +
      "This is the authoritative source for what United Prints can physically produce and what it costs.",
    requiredTab: "materials",
    workspaceSlug: "united-prints",
    inputSchema: {
      type: "object",
      properties: {
        search: { type: "string", description: "Optional name or category filter, e.g. 'corflute' or 'banner'." },
      },
    },
  },
  {
    name: "print_jobs_summary",
    title: "United Prints job pipeline",
    description:
      "How many print jobs sit at each stage of the production pipeline right now, and the most recent jobs. " +
      "Use for questions about print workload, what is in production, or how busy the shop is.",
    requiredTab: "jobs",
    workspaceSlug: "united-prints",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "programme_list",
    title: "Programmes & prices",
    description:
      "The programmes a workspace runs — name, type, whether registration is open, capacity and the term or session price. " +
      "Use for questions about what we offer, what it costs a family, or whether something is open for sign-up.",
    requiredTab: "academy",
    inputSchema: {
      type: "object",
      properties: {
        brand: { type: "string", description: "Brand key: " + KB_BRAND_KEYS.join(", ") },
      },
    },
  },
  {
    name: "registration_counts",
    title: "Registration numbers",
    description:
      "How many paid registrations exist per programme, broken down by status (confirmed, refunded). Unfinished online checkouts are not registrations and are never counted. " +
      "Use for questions about how many players or children are signed up.",
    requiredTab: "registrations",
    inputSchema: {
      type: "object",
      properties: {
        brand: { type: "string", description: "Brand key: " + KB_BRAND_KEYS.join(", ") },
      },
    },
  },
  {
    name: "sponsorship_summary",
    title: "Sponsors",
    description:
      "The club's current sponsors by brand and tier, and whether their website is reachable. " +
      "Use for questions about who sponsors us.",
    requiredTab: "sponsorship",
    workspaceSlug: "united-sports-group",
    inputSchema: {
      type: "object",
      properties: {
        brand: { type: "string", description: "Brand key: " + KB_BRAND_KEYS.join(", ") },
      },
    },
  },
  {
    name: "budget_summary",
    title: "Budget",
    description:
      "Budgeted and actual figures by cost centre for a financial year. Financial planning data.",
    // 🔴 "budget" is in SUPER_ADMIN_ONLY_TABS, so viewerCanReachTab resolves this
    // to Daniel alone — including for a workspace admin or manager. This tool is
    // the canary: if it ever appears for anyone else, the gate is broken.
    requiredTab: "budget",
    workspaceSlug: "united-sports-group",
    inputSchema: {
      type: "object",
      properties: {
        year: { type: "number", description: "Financial year, e.g. 2026. Defaults to the current year." },
      },
    },
  },
  // ── The club's numbers (Daniel, 2026-10-26: "how many under-4 to 8s … by
  // age … how many were in the holiday camps … on the roll but not paid …
  // percentage of academy payments … U13 Blue"). Every query is hand-written
  // in server/rambo-club-tools.ts; the model only names a programme, a term
  // and a grouping. All four sit behind the Registrations tab, re-checked in
  // the workspace being asked about.
  {
    name: "player_numbers",
    title: "Player numbers",
    description:
      "How many players are REGISTERED (paid) on a programme for a term, as distinct people, with a breakdown by programme, by age in years, by age grade (U9, U10 …) or by the option the family chose. " +
      "Use for 'how many U4–U8s do we have', 'how many 5-year-olds', 'how many in the academy this term', 'how many at the camps'. " +
      "programme takes the names staff use: 'U4-U8' / 'FUNiño', 'pre-academy' / 'U9-U12', 'academy' / 'U13-U17', 'technification', 'goalkeeper', 'holiday camps', or 'all'. " +
      "term: 'current' (default), 'last term', 'Term 3 2026', or 'all' for all time.",
    requiredTab: "registrations",
    inputSchema: {
      type: "object",
      properties: {
        programme: { type: "string", description: "Programme name or nickname, e.g. 'U4-U8', 'pre-academy', 'academy', 'holiday camps', 'all'." },
        term: { type: "string", description: "'current' (default), 'last term', 'next term', 'Term 3 2026', a year, or 'all'." },
        group_by: { type: "string", enum: ["programme", "age", "grade", "option"], description: "'age' = years old today; 'grade' = U-grade by year of birth; 'option' = the age band / option the family picked." },
        brand: { type: "string", description: "Only if the person asks about a DIFFERENT workspace than the one they are in: " + KB_BRAND_KEYS.join(", ") },
      },
    },
  },
  {
    name: "payment_status",
    title: "Who has paid",
    description:
      "For a programme and term: how many have PAID and are registered, how many are ON THE ROLL (marked present or checked in at a session this term) but have NOT paid — with their names — how many started an online checkout and never paid, and the paid share as a percentage. " +
      "Use for 'who is on the roll but hasn't paid', 'what percentage of the academy / pre-academy has paid', 'how are payments going for U4-U8'. For a specific squad like 'U13 Blue' use squad_payment_status instead.",
    requiredTab: "registrations",
    inputSchema: {
      type: "object",
      properties: {
        programme: { type: "string", description: "Programme name or nickname; 'core academy' for every core academy programme together (the default)." },
        term: { type: "string", description: "'current' (default), 'last term', or 'Term 3 2026'." },
        brand: { type: "string", description: "Only for a different workspace than the one they are in." },
      },
    },
  },
  {
    name: "camp_overlap",
    title: "Camp crossover",
    description:
      "How many of a programme's registered players have ALSO been to one of the club's holiday camps (any camp on record, or a given year), which camps, and the share as a percentage. " +
      "Use for 'how many of them were in the holiday camps', 'how many academy kids came to a camp'. Matches by name and date of birth and says so.",
    requiredTab: "registrations",
    inputSchema: {
      type: "object",
      properties: {
        programme: { type: "string", description: "The academy programme, e.g. 'U4-U8', 'pre-academy', 'academy'." },
        term: { type: "string", description: "The programme's term: 'current' (default), 'last term', 'Term 3 2026'." },
        year: { type: "number", description: "Only count camps that ran in this year. Omit for any camp on record." },
        brand: { type: "string", description: "Only for a different workspace than the one they are in." },
      },
    },
  },
  {
    name: "squad_payment_status",
    title: "Squad payments",
    description:
      "For a named squad or team (e.g. 'U13 Blue', 'U9 Kiwis', or 'all'): who on its roster has a paid academy registration for the term and who has not, by name, with the paid percentage per squad. " +
      "Use for 'U13 Blue specific', 'which of the U10s haven't paid', 'payments by team'.",
    requiredTab: "registrations",
    inputSchema: {
      type: "object",
      properties: {
        squad: { type: "string", description: "Squad name as the club writes it ('U13 Blue', 'U9 Kiwis'), a grade ('U10' = every U10 squad), or 'all'." },
        term: { type: "string", description: "'current' (default), 'last term', or 'Term 3 2026'." },
        brand: { type: "string", description: "Only for a different workspace than the one they are in." },
      },
      required: ["squad"],
    },
  },
  {
    name: "search_drive",
    title: "Club Drive files",
    description:
      "Search Club Drive — every document the club stores: contracts, proposals, budgets, policies, plans, " +
      "spreadsheets and PDFs. Searches the CONTENTS of files as well as their names, so use it when someone " +
      "half-remembers a document ('the thing about the gym partnership', 'that sponsorship deck from last year') " +
      "and cannot name it. Returns the file name, where it sits in the folder tree, and a matching extract. " +
      "Always give the person the file name and its folder path so they can go and open it.",
    // 🔴 null on purpose: every staff member may SEARCH the drive. Files are
    // then filtered one by one against that person's real tab access inside the
    // handler — a locked file never reaches the model, not even its name.
    // Gating the whole tool instead would either hide the drive from everyone
    // or expose every contract in it.
    requiredTab: null,
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "What to look for, e.g. 'gym partnership agreement' or 'academy fee schedule'." },
      },
      required: ["query"],
    },
  },
];

/**
 * The tools this person may actually use — the list that gets sent to the model.
 * `search_knowledge_base` is always present; everything else has to be earned.
 */
export function ramboToolsFor(viewer: Viewer): RamboToolDef[] {
  return RAMBO_TOOLS.filter((t) => {
    if (!t.requiredTab) return true;
    return viewerCanReachTab(viewer, t.requiredTab, t.workspaceSlug).allowed;
  });
}

export function ramboToolByName(name: string): RamboToolDef | undefined {
  return RAMBO_TOOLS.find((t) => t.name === name);
}
