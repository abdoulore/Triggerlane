import { createHash } from "node:crypto";
import Decimal from "decimal.js";
import { z } from "zod";
import type { MarketHistoryInterval, MarketView } from "@ghost/domain";

const decimalString = z.string().refine((value) => {
  try {
    return new Decimal(value).isFinite();
  } catch {
    return false;
  }
}, "Expected a finite decimal string.");

const contextEnvelopeSchema = z.tuple([
  z.object({ universe: z.array(z.object({ name: z.string() })) }),
  z.array(z.object({
    markPx: decimalString,
    funding: decimalString,
    prevDayPx: decimalString.optional(),
  })),
]);

const candleSchema = z.object({
  t: z.number().int().nonnegative(),
  T: z.number().int().nonnegative(),
  s: z.string(),
  i: z.string(),
  c: decimalString,
});

export type LiveHistoryInterval = Exclude<MarketHistoryInterval, "DEMO_STEP">;
type FetchLike = typeof fetch;

const HISTORY_WINDOWS_MS: Record<LiveHistoryInterval, number> = {
  "1m": 6 * 60 * 60 * 1000,
  "5m": 24 * 60 * 60 * 1000,
  "1h": 7 * 24 * 60 * 60 * 1000,
};

function unavailable(interval: LiveHistoryInterval, reason: string): MarketView {
  return {
    mode: "LIVE",
    instrument: { symbol: "SOL-PERP", displayName: "SOL perpetual", quoteAsset: "USDC", priceType: "MARK_PRICE" },
    provider: "Hyperliquid",
    snapshotId: null,
    price: { value: null, unit: "USDC_PER_SOL" },
    funding: { value: null, unit: "RATIO", period: "1H" },
    sourceTimestamp: null,
    receivedAt: null,
    status: "UNAVAILABLE",
    executionEligible: false,
    eligibilityReason: "Hyperliquid does not provide a source timestamp in this asset-context response.",
    change: { value: null, label: null },
    history: { status: "UNAVAILABLE", interval, points: [], reason },
  };
}

export class HyperliquidMarketProvider {
  private readonly cache = new Map<LiveHistoryInterval, { value: MarketView; fetchedAt: number }>();
  private readonly inFlight = new Map<LiveHistoryInterval, Promise<MarketView>>();
  private retryAfter = 0;

  constructor(
    private readonly request: FetchLike = fetch,
    private readonly clock: () => number = Date.now,
    private readonly cacheTtlMs = 5_000,
    private readonly failureBackoffMs = 5_000,
    private readonly maxConcurrentViews = 3,
  ) {}

  async view(interval: LiveHistoryInterval = "5m"): Promise<MarketView> {
    const current = this.cache.get(interval);
    const timestamp = this.clock();
    if (current && timestamp - current.fetchedAt <= this.cacheTtlMs) return current.value;
    const pending = this.inFlight.get(interval);
    if (pending) return pending;
    if (this.inFlight.size >= this.maxConcurrentViews) return current ? this.asStale(current.value, "Provider request capacity is busy.") : unavailable(interval, "Provider request capacity is busy.");
    if (timestamp < this.retryAfter) return current ? this.asStale(current.value, "Provider retry is backing off.") : unavailable(interval, "Provider retry is backing off.");

    const load = this.fetchView(interval).catch((error: unknown) => {
      this.retryAfter = this.clock() + this.failureBackoffMs;
      const reason = error instanceof Error ? error.message : "Live market data is unavailable.";
      return current ? this.asStale(current.value, reason) : unavailable(interval, reason);
    }).finally(() => this.inFlight.delete(interval));
    this.inFlight.set(interval, load);
    return load;
  }

  private asStale(value: MarketView, reason: string): MarketView {
    return { ...value, status: "STALE", history: { ...value.history, reason } };
  }

  private async fetchView(interval: LiveHistoryInterval): Promise<MarketView> {
    const contextResponse = await this.request("https://api.hyperliquid.xyz/info", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "metaAndAssetCtxs" }),
      signal: AbortSignal.timeout(6_000),
    });
    if (!contextResponse.ok) throw new Error(`Hyperliquid context request failed (${contextResponse.status}).`);
    const envelope = contextEnvelopeSchema.parse(await contextResponse.json());
    const receivedAtMs = this.clock();
    const index = envelope[0].universe.findIndex((asset) => asset.name === "SOL");
    const context = envelope[1][index];
    if (index < 0 || !context) throw new Error("SOL perpetual was not found in the provider response.");

    const history = await this.fetchHistory(interval, receivedAtMs);
    const previous = context.prevDayPx ? new Decimal(context.prevDayPx) : null;
    const mark = new Decimal(context.markPx);
    const change = previous?.gt(0) ? mark.minus(previous).div(previous).toDecimalPlaces(8).toFixed() : null;
    const receivedAt = new Date(receivedAtMs).toISOString();
    const value: MarketView = {
      mode: "LIVE",
      instrument: { symbol: "SOL-PERP", displayName: "SOL perpetual", quoteAsset: "USDC", priceType: "MARK_PRICE" },
      provider: "Hyperliquid",
      snapshotId: `hl:${createHash("sha256").update(`${context.markPx}:${context.funding}:${receivedAt}`).digest("hex").slice(0, 16)}`,
      price: { value: context.markPx, unit: "USDC_PER_SOL" },
      funding: { value: context.funding, unit: "RATIO", period: "1H" },
      sourceTimestamp: null,
      receivedAt,
      status: "FRESH",
      executionEligible: true,
      eligibilityReason: "Fresh Hyperliquid observations can drive virtual execution. Real execution remains unavailable.",
      change: { value: change, label: change == null ? null : "24H" },
      history,
    };
    this.cache.set(interval, { value, fetchedAt: receivedAtMs });
    this.retryAfter = 0;
    return value;
  }

  private async fetchHistory(interval: LiveHistoryInterval, endTime: number): Promise<MarketView["history"]> {
    try {
      const response = await this.request("https://api.hyperliquid.xyz/info", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "candleSnapshot", req: { coin: "SOL", interval, startTime: endTime - HISTORY_WINDOWS_MS[interval], endTime } }),
        signal: AbortSignal.timeout(6_000),
      });
      if (!response.ok) throw new Error(`Hyperliquid history request failed (${response.status}).`);
      const candles = z.array(candleSchema).parse(await response.json());
      const points = candles
        .filter((candle) => candle.s === "SOL" && candle.i === interval)
        .sort((a, b) => a.t - b.t)
        .filter((candle, index, all) => index === 0 || candle.t !== all[index - 1]?.t)
        .map((candle) => ({ id: `hl:${interval}:${candle.t}`, at: new Date(candle.t).toISOString(), value: candle.c }));
      return points.length > 0
        ? { status: "AVAILABLE", interval, points, reason: null }
        : { status: "UNAVAILABLE", interval, points: [], reason: "No candles were returned for this interval." };
    } catch (error) {
      return { status: "UNAVAILABLE", interval, points: [], reason: error instanceof Error ? error.message : "Live history is unavailable." };
    }
  }
}
