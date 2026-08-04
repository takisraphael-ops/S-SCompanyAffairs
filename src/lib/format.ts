/**
 * Display formatting. Values arrive from Postgres `numeric` as strings; they
 * are parsed here, at the last possible moment, and never fed back into
 * arithmetic that gets persisted.
 */

export function toNumber(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export function formatPrice(v: string | number | null | undefined): string {
  const n = toNumber(v);
  if (n === null) return "—";
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatSignedPct(v: string | number | null | undefined): string {
  const n = toNumber(v);
  if (n === null) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

export function formatSigned(v: string | number | null | undefined): string {
  const n = toNumber(v);
  if (n === null) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}`;
}

export function formatRelativeTime(d: Date | string | null | undefined): string {
  if (!d) return "never";
  const date = typeof d === "string" ? new Date(d) : d;
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);

  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

/** Sign bucket for colouring gains and losses. */
export function direction(v: string | number | null | undefined): "up" | "down" | "flat" {
  const n = toNumber(v);
  if (n === null || n === 0) return "flat";
  return n > 0 ? "up" : "down";
}
