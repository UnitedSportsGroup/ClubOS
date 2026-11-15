// What an e-Sign agreement TEMPLATE may contain — the ONE decider for the
// template builder, Rambo's drafts, and the server's save.
//
// Daniel, 2026-11-04: "I'm the bottleneck. I have to build all the stuff … they
// shouldn't have access to completely rebuild ClubOS, but they should be able to
// build the stuff they need to do the work day to day." A template is CONTENT,
// not code: staff (and Rambo) write the words, the fields a signer fills in and
// the brand it wears; the signing page and the PDF engine stay ours.
//
// 🔴 Every save is REBUILT field by field from this shape. `content`, `form`,
// `variables` and `settings` are jsonb, so without this the request body IS the
// stored document — and the signing page renders it to strangers.
// 🔴 A template is a DRAFT until a person publishes it (`settings.published`).
// Only published templates can be sent or opened by link. Templates that predate
// the builder carry no flag and count as published, so nothing live changed.
// 🔴 The text is plain text. `{{key}}` placeholders must name a variable or a
// form field; an unknown one is a problem, never silently printed.

export const ESIGN_FORM_TYPES = ["text", "date", "dob", "phone", "email", "bank", "address"] as const;
export const ESIGN_VARIABLE_TYPES = ["text", "select", "date", "money"] as const;
export const ESIGN_ITEM_KINDS = ["p", "bullet", "numbered"] as const;

export type EsignFormType = (typeof ESIGN_FORM_TYPES)[number];
export type EsignVariableType = (typeof ESIGN_VARIABLE_TYPES)[number];

export interface EsignFormField { key: string; label: string; type: EsignFormType; required: boolean; placeholder?: string; help?: string }
export interface EsignVariable { key: string; label: string; type: EsignVariableType; required: boolean; default?: string; options?: string[] }
export interface EsignItem { kind: (typeof ESIGN_ITEM_KINDS)[number]; text: string }
export interface EsignSection { heading: string; items: EsignItem[] }
export interface EsignContent { docTitle: string; partiesIntro: string[]; sections: EsignSection[]; signAck?: string }
export interface EsignBrand { orgLabel: string; logoUrl: string; bg: string; panel: string; border: string; accent: string; accentDeep: string; paper: string; ink: string }
export interface EsignSettings {
  published: boolean;
  counterSignerRole: string;
  primarySignerRole: string;
  detailsHeading: string;
  adviceNotice: string;
  guardianUnder18: boolean;
  clubSignsFirst: boolean;
  /** One link anyone can open to fill in their details and sign. */
  openLink?: { enabled: boolean; token: string; clubSignature?: { name: string; image: string | null; userId: number; email: string; adoptedAt: string } | null } | null;
  /** Who made it — shown in the list; the open link's club signatory. */
  createdByName?: string | null;
}

export interface EsignTemplateInput {
  name: string;
  description: string | null;
  brand: EsignBrand;
  content: EsignContent;
  variables: EsignVariable[];
  form: EsignFormField[];
  settings: EsignSettings;
}

// ── Brands ─────────────────────────────────────────────────────────────────
// Read off the templates already live (MFL, CIC, CUFC) and the brand packs for
// the rest. A template picks one by key; the colours are never typed by hand.
export const ESIGN_BRANDS: Record<string, EsignBrand> = {
  cufc: { orgLabel: "Christchurch United Football Club", logoUrl: "/logos/christchurch-united.png", bg: "#0b1330", panel: "#121c40", border: "#24305a", accent: "#C9A43E", accentDeep: "#a8862c", paper: "#faf8f2", ink: "#0b1330" },
  siu: { orgLabel: "South Island United", logoUrl: "/logos/south-island-united.png", bg: "#0b0b0a", panel: "#151513", border: "#2a2925", accent: "#C59949", accentDeep: "#9c7535", paper: "#faf8f2", ink: "#141311" },
  mfl: { orgLabel: "Mini Football Leagues", logoUrl: "/logos/mini-football-leagues.png", bg: "#0a0a0a", panel: "#141414", border: "#2a2a2a", accent: "#d1b96e", accentDeep: "#a8915a", paper: "#faf8f2", ink: "#17150e" },
  cic: { orgLabel: "Christchurch International Cup", logoUrl: "/logos/christchurch-international-cup.png", bg: "#141511", panel: "#1c1d18", border: "#2c2d26", accent: "#C9A43E", accentDeep: "#a8862c", paper: "#faf8f2", ink: "#141511" },
  usg: { orgLabel: "United Sports Group", logoUrl: "/logos/united-sports-group.png", bg: "#0b1330", panel: "#121c40", border: "#24305a", accent: "#C9A43E", accentDeep: "#a8862c", paper: "#faf8f2", ink: "#0b1330" },
  usc: { orgLabel: "United Sports Centre", logoUrl: "/logos/united-sports-group.png", bg: "#0b1330", panel: "#121c40", border: "#24305a", accent: "#C9A43E", accentDeep: "#a8862c", paper: "#faf8f2", ink: "#0b1330" },
  prints: { orgLabel: "United Prints", logoUrl: "/logos/united-prints.png", bg: "#111111", panel: "#1a1a1a", border: "#2c2c2c", accent: "#E2B33C", accentDeep: "#b48a22", paper: "#faf8f2", ink: "#141414" },
  cugc: { orgLabel: "United Gymnastics", logoUrl: "/logos/united-gymnastics.png", bg: "#121025", panel: "#1b1834", border: "#2e2a4e", accent: "#C9A43E", accentDeep: "#a8862c", paper: "#faf8f2", ink: "#121025" },
};

export const ESIGN_BRAND_LABELS: Record<string, string> = {
  cufc: "Christchurch United", siu: "South Island United", mfl: "Mini Football Leagues", cic: "Christchurch International Cup",
  usg: "United Sports Group", usc: "United Sports Centre", prints: "United Prints", cugc: "United Gymnastics",
};

/** The brand a workspace's templates start in. */
export const ESIGN_BRAND_FOR_ORG_SLUG: Record<string, string> = {
  "christchurch-united": "cufc", "south-island-united": "siu", "mini-football-leagues": "mfl",
  "christchurch-international-cup": "cic", "united-sports-group": "usg", "united-sports-centre": "usc",
  "united-prints": "prints", "united-gymnastics": "cugc", sandbox: "usg",
};

/** Which preset a stored brand is (by logo + accent), or null if hand-made. */
export function brandKeyOf(b: Partial<EsignBrand> | null | undefined): string | null {
  if (!b) return null;
  for (const [k, v] of Object.entries(ESIGN_BRANDS)) if (v.orgLabel === b.orgLabel && v.logoUrl === b.logoUrl) return k;
  return null;
}

// ── Cleaning ───────────────────────────────────────────────────────────────
const s = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const para = (v: unknown, max: number) => String(v ?? "").replace(/\r/g, "").replace(/[ \t]+/g, " ").trim().slice(0, max);

export function keyOf(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "field";
}

/** Template slug from its name (made unique by the caller). */
export function slugOf(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "agreement";
}

export function isPublished(settings: unknown): boolean {
  const st = (settings ?? {}) as Record<string, any>;
  return st.published !== false; // pre-builder templates carry no flag = published
}

export interface CleanResult { template: EsignTemplateInput; problems: string[] }

/**
 * Rebuild a template from untrusted input. `problems` are reasons it cannot be
 * PUBLISHED (a draft may be saved with problems so work is never lost).
 */
export function cleanTemplate(raw: any, opts: { brandKey?: string | null } = {}): CleanResult {
  const problems: string[] = [];
  const r = raw ?? {};

  const name = s(r.name, 120);
  if (!name) problems.push("Give the agreement a name.");

  const brandKey = opts.brandKey && ESIGN_BRANDS[opts.brandKey] ? opts.brandKey : (brandKeyOf(r.brand) ?? "usg");
  const brand = { ...ESIGN_BRANDS[brandKey] };

  // Signer-filled fields.
  const form: EsignFormField[] = [];
  const seen = new Set<string>();
  for (const f of Array.isArray(r.form) ? r.form.slice(0, 40) : []) {
    const label = s(f?.label, 120);
    if (!label) continue;
    let key = keyOf(s(f?.key, 40) || label);
    while (seen.has(key)) key = `${key}_2`;
    seen.add(key);
    const type = (ESIGN_FORM_TYPES as readonly string[]).includes(f?.type) ? f.type : "text";
    form.push({ key, label, type, required: f?.required !== false, ...(s(f?.placeholder, 120) ? { placeholder: s(f.placeholder, 120) } : {}), ...(s(f?.help, 200) ? { help: s(f.help, 200) } : {}) });
  }
  // The signing page names the signer from the first text field — make sure one exists.
  if (!form.some((f) => f.type === "text")) problems.push("Add at least one text field for the signer, e.g. their full name.");

  // Sender-set variables.
  const variables: EsignVariable[] = [];
  for (const v of Array.isArray(r.variables) ? r.variables.slice(0, 20) : []) {
    const label = s(v?.label, 120);
    if (!label) continue;
    let key = keyOf(s(v?.key, 40) || label);
    while (seen.has(key)) key = `${key}_2`;
    seen.add(key);
    const type = (ESIGN_VARIABLE_TYPES as readonly string[]).includes(v?.type) ? v.type : "text";
    const options = type === "select" ? (Array.isArray(v?.options) ? v.options.map((o: any) => s(o, 80)).filter(Boolean).slice(0, 20) : []) : undefined;
    if (type === "select" && !options?.length) problems.push(`"${label}" is a choice with no options.`);
    const def = s(v?.default, 200);
    variables.push({ key, label, type, required: v?.required !== false, ...(def ? { default: def } : {}), ...(options ? { options } : {}) });
  }

  // Content.
  const c = r.content ?? {};
  const docTitle = s(c.docTitle, 140) || name;
  const partiesIntro = (Array.isArray(c.partiesIntro) ? c.partiesIntro : []).map((x: any) => para(x, 600)).filter(Boolean).slice(0, 10);
  const sections: EsignSection[] = [];
  for (const sec of Array.isArray(c.sections) ? c.sections.slice(0, 60) : []) {
    const heading = s(sec?.heading, 140);
    const items: EsignItem[] = [];
    for (const it of Array.isArray(sec?.items) ? sec.items.slice(0, 60) : []) {
      const text = para(it?.text, 2000);
      if (!text) continue;
      const kind = (ESIGN_ITEM_KINDS as readonly string[]).includes(it?.kind) ? it.kind : "p";
      items.push({ kind, text });
    }
    if (heading || items.length) sections.push({ heading: heading || "Terms", items });
  }
  if (!sections.length) problems.push("Write at least one section of the agreement.");
  const signAck = para(c.signAck, 600) || undefined;

  // Placeholders must resolve.
  const known = new Set([...form.map((f) => f.key), ...variables.map((v) => v.key)]);
  const allText = [docTitle, ...partiesIntro, ...sections.flatMap((x) => [x.heading, ...x.items.map((i) => i.text)]), signAck ?? ""].join("\n");
  const unknown = new Set<string>();
  const re = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(allText))) if (!known.has(m[1])) unknown.add(m[1]);
  for (const k of Array.from(unknown)) problems.push(`{{${k}}} in the text isn't a field or a detail you set.`);

  // Settings.
  const st = r.settings ?? {};
  const ol = st.openLink;
  const settings: EsignSettings = {
    published: st.published === true,
    counterSignerRole: s(st.counterSignerRole, 80) || "The Club",
    primarySignerRole: s(st.primarySignerRole, 80) || "The Signer",
    detailsHeading: s(st.detailsHeading, 80) || "Your details",
    adviceNotice: para(st.adviceNotice, 400) || "Take your time. You're welcome to seek independent advice before signing — this page will still be here when you're ready.",
    guardianUnder18: st.guardianUnder18 === true,
    clubSignsFirst: st.clubSignsFirst !== false,
    openLink: ol && typeof ol === "object" && typeof ol.token === "string" && /^[A-Za-z0-9_-]{20,64}$/.test(ol.token)
      ? { enabled: ol.enabled === true, token: ol.token, clubSignature: ol.clubSignature ?? null }
      : null,
    createdByName: st.createdByName ? s(st.createdByName, 80) : null,
  };
  if (settings.guardianUnder18 && !form.some((f) => f.type === "dob")) problems.push("Under-18 co-signing needs a date of birth field.");

  return {
    template: { name, description: s(r.description, 300) || null, brand, content: { docTitle, partiesIntro, sections, ...(signAck ? { signAck } : {}) }, variables, form, settings },
    problems,
  };
}

/** Variables the open link fills from their defaults — all must have one. */
export function openLinkProblems(t: EsignTemplateInput): string[] {
  const p: string[] = [];
  for (const v of t.variables) if (v.required && !v.default) p.push(`"${v.label}" needs a default — an open link has nobody to set it.`);
  return p;
}
