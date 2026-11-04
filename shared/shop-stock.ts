// The ONE rule for whether a shop variant can be sold (2026-11-04).
// Shopify's inventory policy, copied: an untracked variant never sells out; a
// tracked one sells while it has stock, or past zero when "Continue selling
// when out of stock" is on. The catalog's inStock flag and every checkout
// path call this, so the button the customer sees and the check that takes
// their money can never disagree.
export interface SellableVariant {
  stock: number;
  trackInventory?: boolean | null;
  continueSelling?: boolean | null;
}

/** Can `qty` more of this variant be sold right now? */
export function canSell(v: SellableVariant, qty = 1): boolean {
  if (v.trackInventory === false) return true;
  if (v.continueSelling === true) return true;
  return qty <= v.stock;
}

/** Shown as available on the storefront. */
export function inStock(v: SellableVariant): boolean {
  return canSell(v, 1);
}
