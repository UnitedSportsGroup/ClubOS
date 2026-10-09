// A full Xero contact for every academy player — "(A U12) Daksh Khanna".
//
// Olga raises one invoice per child against a contact named for the child and
// filed in an age-group contact group. Those contacts carried a parent's name and
// email and nothing else: no phone, no address, no second parent. ClubOS holds
// all three. This fills them in.
//
// 🔴 FILL BLANKS ONLY. Olga edits these contacts by hand; a field that already
// holds something is hers and is never overwritten. Nothing is ever deleted.
//
// 🔴 A Xero contact is matched to a ClubOS child by the child's name AND a
// confirmed academy registration, and — when the Xero contact has an email — that
// email must belong to one of the child's guardians. Two ClubOS children with
// the same name and no email to separate them = no match, reported, untouched.
// Writing one family's phone number onto another family's invoice contact is the
// failure that matters here.

import { db } from "./db";
import { sql } from "drizzle-orm";
import { getXeroForOrg } from "./xero";
import { REAL_REGISTRATION_STATUSES } from "@shared/registrations";

export interface Guardian {
  id: number; first: string; last: string; email: string | null; phone: string | null;
  street: string | null; suburb: string | null; city: string | null; region: string | null;
  postcode: string | null; country: string | null; address: string | null; primary: boolean;
}
export interface PlayerProfile { childId: number; child: string; guardians: Guardian[] }

const clean = (v: unknown) => { const s = String(v ?? "").trim(); return s ? s : null; };
const normName = (s: string) => s.toLowerCase().replace(/\([^)]*\)/g, " ").replace(/[^a-z0-9' -]/g, " ").replace(/\s+/g, " ").trim();

/**
 * Every guardian of every player, keyed by the
 * child's normalised name. Guardians come from both link mechanisms the Families
 * view unions: the registration's guardian_id and contact_relationships.
 */
export async function academyProfiles(): Promise<Map<string, PlayerProfile[]>> {
  const statuses = sql.join(REAL_REGISTRATION_STATUSES.map((s) => sql`${s}`), sql`, `);
  const r = await db.execute(sql`
    -- Every PLAYER ClubOS knows: this year's paid registrations, ten years of
    -- Friendly Manager history, and anyone linked to a guardian as a child. Olga's
    -- contacts go back years; a current-registrations-only pool left 340 unmatched.
    WITH kids AS (
      SELECT DISTINCT c.id, btrim(c.first_name) first_name, btrim(c.last_name) last_name
        FROM contacts c
       WHERE c.merged_into_contact_id IS NULL AND (
             c.type = 'player'
          OR EXISTS (SELECT 1 FROM registrations r WHERE r.contact_id = c.id AND r.status IN (${statuses}))
          OR EXISTS (SELECT 1 FROM contact_relationships cr WHERE cr.player_id = c.id))
    ), links AS (
      SELECT DISTINCT r.contact_id kid, r.guardian_id g, true via_reg
        FROM registrations r JOIN kids k ON k.id = r.contact_id
       WHERE r.guardian_id IS NOT NULL AND r.status IN (${statuses})
      UNION
      SELECT cr.player_id, cr.guardian_id, coalesce(cr.is_primary_contact, false)
        FROM contact_relationships cr JOIN kids k ON k.id = cr.player_id
    )
    SELECT k.id kid, k.first_name kf, k.last_name kl,
           g.id gid, g.first_name gf, g.last_name gl, g.email, g.phone, g.alternate_phone,
           g.address, g.address_street, g.address_suburb, g.address_city, g.address_region,
           g.address_postcode, g.address_country, bool_or(l.via_reg) prim
      FROM kids k
      LEFT JOIN links l ON l.kid = k.id
      LEFT JOIN contacts g ON g.id = l.g AND g.merged_into_contact_id IS NULL AND g.id <> k.id
     GROUP BY k.id, k.first_name, k.last_name, g.id`);
  const byKid = new Map<number, PlayerProfile>();
  for (const x of r.rows as any[]) {
    const kid = Number(x.kid);
    const p = byKid.get(kid) ?? { childId: kid, child: `${x.kf ?? ""} ${x.kl ?? ""}`.trim(), guardians: [] };
    if (x.gid != null && !p.guardians.some((g) => g.id === Number(x.gid))) {
      p.guardians.push({
        id: Number(x.gid), first: clean(x.gf) ?? "", last: clean(x.gl) ?? "",
        email: clean(x.email)?.toLowerCase() ?? null, phone: clean(x.phone) ?? clean(x.alternate_phone),
        street: clean(x.address_street), suburb: clean(x.address_suburb), city: clean(x.address_city),
        region: clean(x.address_region), postcode: clean(x.address_postcode), country: clean(x.address_country),
        address: clean(x.address), primary: !!x.prim,
      });
    }
    byKid.set(kid, p);
  }
  const out = new Map<string, PlayerProfile[]>();
  for (const p of Array.from(byKid.values())) {
    // The guardian the registration names first, then whoever has an email.
    p.guardians.sort((a, b) => Number(b.primary) - Number(a.primary) || Number(!!b.email) - Number(!!a.email) || a.id - b.id);
    const k = normName(p.child);
    if (!k) continue;
    out.set(k, [...(out.get(k) ?? []), p]);
  }
  return out;
}

/** "(A U12) Daksh Khanna" → the ClubOS child, or why not. */
export function matchContact(xeroName: string, xeroEmail: string | null, profiles: Map<string, PlayerProfile[]>):
  { profile: PlayerProfile } | { reason: string } {
  const cands = profiles.get(normName(xeroName)) ?? [];
  if (!cands.length) return { reason: "no academy player in ClubOS with this name" };
  const email = clean(xeroEmail)?.toLowerCase() ?? null;
  if (email) {
    const hit = cands.filter((p) => p.guardians.some((g) => g.email === email));
    if (hit.length === 1) return { profile: hit[0] };
    // The same child entered twice in ClubOS (a duplicate record, same parent
    // email) is ONE family: pool their guardians. Two different children cannot
    // share a full name and a parent.
    if (hit.length > 1) {
      const guardians: Guardian[] = [];
      for (const p of hit) for (const g of p.guardians) if (!guardians.some((x) => x.id === g.id)) guardians.push(g);
      guardians.sort((a, b) => Number(b.email === email) - Number(a.email === email) || Number(b.primary) - Number(a.primary) || Number(!!b.phone) - Number(!!a.phone));
      return { profile: { childId: hit[0].childId, child: hit[0].child, guardians } };
    }
    // An email we don't hold: the name alone is only trusted when it is unique.
    if (cands.length === 1) return { profile: cands[0] };
    return { reason: `email ${email} belongs to none of the ${cands.length} ClubOS players with this name` };
  }
  if (cands.length === 1) return { profile: cands[0] };
  return { reason: `${cands.length} ClubOS players share this name and the Xero contact has no email to tell them apart` };
}

/**
 * The fields to add to a Xero contact — only where Xero holds nothing. Returns
 * null when there is nothing to add. Pure, so a dry run shows exactly the write.
 */
export function profilePatch(xc: any, p: PlayerProfile): { patch: Record<string, any>; changes: string[] } | null {
  // The parent the Xero contact is already named for comes first — their phone and
  // address go on it, and they are never re-added as the "other" parent.
  const xEmail = clean(xc.emailAddress)?.toLowerCase() ?? null;
  const xName = `${clean(xc.firstName) ?? ""} ${clean(xc.lastName) ?? ""}`.trim().toLowerCase();
  const isNamed = (o: Guardian) => (!!xEmail && o.email === xEmail) || (!!xName && `${o.first} ${o.last}`.trim().toLowerCase() === xName);
  const ordered = [...p.guardians].sort((a, b) => Number(isNamed(b)) - Number(isNamed(a)));
  const g = ordered[0];
  if (!g) return null;
  const patch: Record<string, any> = {};
  const changes: string[] = [];

  if (!clean(xc.firstName) && !clean(xc.lastName) && (g.first || g.last)) {
    patch.firstName = g.first || undefined; patch.lastName = g.last || undefined;
    changes.push(`parent name ${g.first} ${g.last}`.trim());
  }
  if (!clean(xc.emailAddress) && g.email) { patch.emailAddress = g.email; changes.push(`email ${g.email}`); }

  const hasPhone = (xc.phones ?? []).some((ph: any) => clean(ph.phoneNumber));
  if (!hasPhone && g.phone) {
    patch.phones = [{ phoneType: "MOBILE", phoneNumber: g.phone }];
    changes.push(`mobile ${g.phone}`);
  }

  const hasAddress = (xc.addresses ?? []).some((a: any) => clean(a.addressLine1) || clean(a.city));
  const line1 = g.street ?? g.address;
  if (!hasAddress && line1) {
    // Structured parts when the checkout captured them; the legacy one-line
    // address otherwise, as written — never split on a guess.
    const a = {
      addressLine1: line1, addressLine2: g.street && g.suburb && g.suburb.toLowerCase() !== (g.city ?? "").toLowerCase() ? g.suburb : undefined,
      city: g.street ? g.city ?? undefined : undefined, region: g.street ? g.region ?? undefined : undefined,
      postalCode: g.street ? g.postcode ?? undefined : undefined,
      country: g.street ? g.country ?? "New Zealand" : undefined,
    };
    // POBOX is the address an invoice prints; STREET is where they live. Same here.
    patch.addresses = [{ addressType: "POBOX", ...a }, { addressType: "STREET", ...a }];
    changes.push(`address ${[line1, a.addressLine2, a.city, a.postalCode].filter(Boolean).join(", ")}`);
  }

  const hasPersons = (xc.contactPersons ?? []).length > 0;
  const others = ordered.slice(1).filter((o) => (o.first || o.last || o.email) && !isNamed(o)).slice(0, 5);
  if (!hasPersons && others.length) {
    patch.contactPersons = others.map((o) => ({
      firstName: o.first || undefined, lastName: o.last || undefined,
      emailAddress: o.email ?? undefined, includeInEmails: !!o.email,
    }));
    changes.push(`other parent${others.length > 1 ? "s" : ""} ${others.map((o) => `${o.first} ${o.last}`.trim()).join(", ")}`);
  }

  return changes.length ? { patch, changes } : null;
}

async function call<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e: any) {
    const h = e?.response?.headers ?? {};
    if (e?.response?.statusCode === 429 && h["x-rate-limit-problem"] === "minute") {
      await new Promise((r) => setTimeout(r, Math.min(60, Number(h["retry-after"] ?? 10)) * 1000 + 500));
      return await fn();
    }
    throw e;
  }
}

/** Fill one Xero contact (by id) from ClubOS. Used right after an invoice is raised. */
export async function fillContact(orgId: number, contactID: string, profile: PlayerProfile): Promise<string[]> {
  const { xero, tenantId } = await getXeroForOrg(orgId);
  const xc = (await call(() => xero.accountingApi.getContact(tenantId, contactID))).body.contacts?.[0];
  if (!xc) return [];
  const p = profilePatch(xc, profile);
  if (!p) return [];
  await call(() => xero.accountingApi.updateContact(tenantId, contactID, { contacts: [{ contactID, ...p.patch }] }));
  return p.changes;
}

export interface SyncRow { name: string; contactID: string; outcome: "filled" | "complete" | "unmatched" | "error"; detail: string }

/**
 * Every "(A U…)" contact in Xero. Dry run unless commit. One GET for the list
 * (Xero pages contacts at 100), one PUT per contact that actually changes.
 */
export async function syncAcademyContacts(orgId = 1, opts: { commit?: boolean; limit?: number } = {}): Promise<SyncRow[]> {
  const { xero, tenantId } = await getXeroForOrg(orgId);
  const profiles = await academyProfiles();
  const contacts: any[] = [];
  for (let page = 1; page <= 50; page++) {
    const r = await call(() => xero.accountingApi.getContacts(tenantId, undefined,
      `Name.StartsWith("(A ") AND ContactStatus=="ACTIVE"`, "Name", undefined, page));
    const got = r.body.contacts ?? [];
    contacts.push(...got);
    if (got.length < 100) break;
  }
  const out: SyncRow[] = [];
  for (const xc of contacts.slice(0, opts.limit ?? contacts.length)) {
    const name = String(xc.name ?? "");
    const m = matchContact(name, xc.emailAddress ?? null, profiles);
    if ("reason" in m) { out.push({ name, contactID: xc.contactID, outcome: "unmatched", detail: m.reason }); continue; }
    const p = profilePatch(xc, m.profile);
    if (!p) { out.push({ name, contactID: xc.contactID, outcome: "complete", detail: "" }); continue; }
    if (opts.commit) {
      // Xero allows 60 calls a minute per tenant, shared with the payout sweep.
      await new Promise((r) => setTimeout(r, 1100));
      try {
        await call(() => xero.accountingApi.updateContact(tenantId, xc.contactID, { contacts: [{ contactID: xc.contactID, ...p.patch }] }));
      } catch (e: any) {
        const msg = e?.response?.body?.Elements?.[0]?.ValidationErrors?.map((v: any) => v.Message).join("; ") ?? e?.message ?? String(e);
        out.push({ name, contactID: xc.contactID, outcome: "error", detail: String(msg).slice(0, 200) });
        continue;
      }
    }
    out.push({ name, contactID: xc.contactID, outcome: "filled", detail: p.changes.join(" · ") });
  }
  return out;
}
