import { fundingAprPercent, type Metric } from "@ghost/domain";

/**
 * Display rules for the interface.
 *
 * Live rates read as the per-hour figure, because that is how perpetual venues
 * quote funding. Thresholds read as an annual rate, because that is how traders
 * set them. Both appear together wherever the distinction could mislead.
 */

const money = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const quantity = new Intl.NumberFormat("en-US", { maximumFractionDigits: 6 });
const compact = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

export function usd(value: number | string | null | undefined): string {
  if (value == null) return "--";
  return money.format(Number(value));
}

export function amount(value: number | string | null | undefined): string {
  if (value == null) return "--";
  return quantity.format(Number(value));
}

export function signedUsd(value: number | string | null | undefined): string {
  if (value == null) return "--";
  const number = Number(value);
  return `${number >= 0 ? "+" : "-"}${money.format(Math.abs(number))}`;
}

export function percent(ratio: number | string | null | undefined, digits = 2): string {
  if (ratio == null) return "--";
  const value = Number(ratio) * 100;
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}%`;
}

/** The live funding rate, per hour, with the annual figure as context. */
export function fundingHourly(ratio: string | null | undefined): string {
  if (ratio == null) return "--";
  return `${(Number(ratio) * 100).toFixed(4)}%`;
}

export function fundingApr(ratio: string | null | undefined): string {
  if (ratio == null) return "--";
  return `${fundingAprPercent(ratio)}% APR`;
}

export function dateTime(value: string): string {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

export function age(value: string | null | undefined): string {
  if (value == null) return "--";
  const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 2) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}

export function timeLeft(expiresAt: string): string {
  const hours = Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 3_600_000);
  if (hours <= 0) return "expired";
  if (hours < 24) return `${hours}h`;
  return `${Math.ceil(hours / 24)}d`;
}

/** Condition chips stay terse; the form spells the operator out. */
export function conditionChip(metric: Metric, operator: "GTE" | "LTE", target: string): string {
  const symbol = operator === "GTE" ? "≥" : "≤";
  if (metric === "PRICE") return `price ${symbol} ${compact.format(Number(target))}`;
  if (metric === "FUNDING") return `funding ${symbol} ${fundingAprPercent(target)}% APR`;
  return `p&l ${symbol} ${(Number(target) * 100).toFixed(1)}%`;
}

export const metricLabel: Record<Metric, string> = {
  PRICE: "SOL price",
  FUNDING: "Funding",
  PNL: "Position P&L",
};

/** Above and Below in the form; the stored values stay GTE and LTE. */
export const operatorLabel: Record<"GTE" | "LTE", string> = {
  GTE: "Above",
  LTE: "Below",
};

export function providerLabel(value: string): string {
  return value.replace(/^ghost-demo-feed$/i, "triggerlane-demo-feed");
}
