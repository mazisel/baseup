const DEFAULT_CURRENCY = "USD";

export function toMinorUnit(amount: number) {
  if (!Number.isFinite(amount)) return 0;
  return Math.max(0, Math.round(amount * 100));
}

export function fromMinorUnit(amount: number | null | undefined) {
  return (amount ?? 0) / 100;
}

export function formatMoney(amountMinor: number | null | undefined, currency = DEFAULT_CURRENCY) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency || DEFAULT_CURRENCY,
    maximumFractionDigits: 2
  }).format(fromMinorUnit(amountMinor));
}
