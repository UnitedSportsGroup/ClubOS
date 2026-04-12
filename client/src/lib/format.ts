export function formatCurrency(
  amount: number | string,
  options?: { decimals?: number; fromCents?: boolean }
): string {
  let value = typeof amount === "string" ? parseFloat(amount) : amount;
  if (isNaN(value)) value = 0;
  if (options?.fromCents) value = value / 100;
  const decimals = options?.decimals ?? 2;
  return `$${value.toLocaleString("en-NZ", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
}

export function formatNumber(value: number | string): string {
  const n = typeof value === "string" ? parseFloat(value) : value;
  if (isNaN(n)) return "0";
  return n.toLocaleString("en-NZ");
}

export function formatCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}
