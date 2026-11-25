// Sponsorship ASSETS — the one place that decides how positions are grouped,
// ordered and added up (Partners → By asset, and the "Asset" sort on the list).
// Daniel, 2026-11-25: "sort sponsors by asset like here view" — the budget
// sheet's Sponsorship tab: CLUB → Kit sponsorship / Digital & programme /
// Physical → each position and who holds it.

export const ASSET_CLUBS = [
  { key: "cufc", label: "Christchurch United" },
  { key: "siu", label: "South Island United" },
  { key: "cic", label: "Christchurch International Cup" },
  { key: "mfl", label: "Mini Football Leagues" },
  { key: "usc", label: "United Sports Centre" },
  { key: "academy", label: "Academy" },
  { key: "usg", label: "United Sports Group" },
] as const;

export const ASSET_GROUPS = [
  { key: "kit", label: "Kit sponsorship" },
  { key: "digital", label: "Digital / programme assets" },
  { key: "physical", label: "Physical assets" },
  { key: "other", label: "Other" },
] as const;

export const clubLabel = (k: string) => ASSET_CLUBS.find(c => c.key === k)?.label ?? k.toUpperCase();
export const groupLabel = (k: string) => ASSET_GROUPS.find(g => g.key === k)?.label ?? k;

const clubRank = (k: string) => { const i = ASSET_CLUBS.findIndex(c => c.key === k); return i < 0 ? 99 : i; };
const groupRank = (k: string) => { const i = ASSET_GROUPS.findIndex(g => g.key === k); return i < 0 ? 99 : i; };

export interface AssetLike {
  id: number; club: string; assetGroup: string; name: string; displayOrder: number;
  partnerId: number | null; businessName: string | null;
  targetCents: number | null; contraCents: number | null; actualCents: number | null;
}

/** Sheet order: club, then group, then the position's own order. */
export function compareAssets(a: AssetLike, b: AssetLike): number {
  return clubRank(a.club) - clubRank(b.club)
    || groupRank(a.assetGroup) - groupRank(b.assetGroup)
    || a.displayOrder - b.displayOrder
    || a.id - b.id;
}

/** A position is SOLD when somebody holds it (a partner, or a business named on
 *  the sheet); otherwise it is still for sale. */
export const isHeld = (a: AssetLike) => a.partnerId != null || !!(a.businessName && a.businessName.trim());

/** A partner's place in "sort by asset": its first position in sheet order.
 *  A partner with no position sorts LAST in both directions — no asset
 *  recorded is an unanswered question, not the first or last asset. */
export function assetRank(a: AssetLike): number {
  return clubRank(a.club) * 1_000_000 + groupRank(a.assetGroup) * 10_000 + Math.min(a.displayOrder, 9_999);
}

export interface AssetTotals { positions: number; held: number; targetCents: number; contraCents: number; actualCents: number }
export function assetTotals(rows: AssetLike[]): AssetTotals {
  return {
    positions: rows.length,
    held: rows.filter(isHeld).length,
    targetCents: rows.reduce((s, r) => s + (r.targetCents ?? 0), 0),
    contraCents: rows.reduce((s, r) => s + (r.contraCents ?? 0), 0),
    actualCents: rows.reduce((s, r) => s + (r.actualCents ?? 0), 0),
  };
}
