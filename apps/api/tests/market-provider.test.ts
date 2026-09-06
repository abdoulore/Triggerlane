import { describe, expect, it, vi } from "vitest";
import { HyperliquidMarketProvider } from "../src/integrations/hyperliquid-market-provider";

const contextPayload = [
  { universe: [{ name: "BTC" }, { name: "SOL" }] },
  [
    { markPx: "60000", oraclePx: "59990", midPx: null, funding: "0.00001", prevDayPx: "59000" },
    { markPx: "250.50", oraclePx: "250.25", midPx: "250.45", funding: "0.000031", prevDayPx: "245.00" },
  ],
];

const candlePayload = [
  { t: 1_700_000_300_000, T: 1_700_000_599_999, s: "SOL", i: "5m", c: "250.50" },
  { t: 1_700_000_000_000, T: 1_700_000_299_999, s: "SOL", i: "5m", c: "249.25" },
  { t: 1_700_000_300_000, T: 1_700_000_599_999, s: "SOL", i: "5m", c: "250.50" },
];

function providerFetch() {
  return vi.fn(async (_url: string | URL | Request, options?: RequestInit) => {
    const body = JSON.parse(String(options?.body)) as { type: string };
    return Response.json(body.type === "metaAndAssetCtxs" ? contextPayload : candlePayload);
  }) as unknown as typeof fetch;
}

describe("Hyperliquid market provider", () => {
  it("normalizes the SOL perpetual mark, hourly funding, 24H change, and candle history", async () => {
    const request = providerFetch();
    const provider = new HyperliquidMarketProvider(request, () => 1_700_000_600_000);
    const view = await provider.view("5m");

    expect(view).toMatchObject({
      mode: "LIVE",
      status: "FRESH",
      instrument: { symbol: "SOL-PERP", priceType: "MARK_PRICE" },
      price: { value: "250.50", unit: "USDC_PER_SOL" },
      funding: { value: "0.000031", unit: "RATIO", period: "1H" },
      change: { label: "24H" },
      sourceTimestamp: null,
      receivedAt: "2023-11-14T22:23:20.000Z",
      executionEligible: false,
      history: { status: "AVAILABLE", interval: "5m" },
    });
    expect(view.change.value).toBe("0.02244898");
    expect(view.history.points.map((point) => point.value)).toEqual(["249.25", "250.50"]);
    expect(vi.mocked(request)).toHaveBeenCalledTimes(2);
  });

  it("coalesces concurrent requests and serves the shared fresh cache", async () => {
    const request = providerFetch();
    const provider = new HyperliquidMarketProvider(request, () => 1_700_000_600_000);
    const [first, second] = await Promise.all([provider.view("5m"), provider.view("5m")]);
    const third = await provider.view("5m");

    expect(first.snapshotId).toBe(second.snapshotId);
    expect(third.snapshotId).toBe(first.snapshotId);
    expect(vi.mocked(request)).toHaveBeenCalledTimes(2);
  });

  it("never substitutes Demo data when the first Live request fails", async () => {
    const request = vi.fn(async () => { throw new Error("provider offline"); }) as unknown as typeof fetch;
    const view = await new HyperliquidMarketProvider(request, () => 1_700_000_600_000).view("1m");

    expect(view).toMatchObject({ mode: "LIVE", status: "UNAVAILABLE", price: { value: null }, funding: { value: null } });
    expect(view.history.points).toEqual([]);
  });

  it("marks cached Live data stale when refresh fails and backs off retries", async () => {
    let timestamp = 1_700_000_600_000;
    let offline = false;
    const successful = providerFetch();
    const request = vi.fn(async (url: string | URL | Request, options?: RequestInit) => {
      if (offline) throw new Error("provider offline");
      return successful(url, options);
    }) as unknown as typeof fetch;
    const provider = new HyperliquidMarketProvider(request, () => timestamp, 5_000, 10_000);
    const fresh = await provider.view("5m");
    timestamp += 6_000;
    offline = true;
    const stale = await provider.view("5m");
    const backedOff = await provider.view("5m");

    expect(stale).toMatchObject({ status: "STALE", price: fresh.price });
    expect(backedOff.status).toBe("STALE");
    expect(vi.mocked(request)).toHaveBeenCalledTimes(3);
  });

  it("recovers from a cached failure with a fresh provider snapshot", async () => {
    let timestamp = 1_700_000_600_000;
    let offline = false;
    const successful = providerFetch();
    const request = vi.fn(async (url: string | URL | Request, options?: RequestInit) => {
      if (offline) throw new Error("provider offline");
      return successful(url, options);
    }) as unknown as typeof fetch;
    const provider = new HyperliquidMarketProvider(request, () => timestamp, 5_000, 5_000);
    await provider.view("5m");
    timestamp += 6_000;
    offline = true;
    expect((await provider.view("5m")).status).toBe("STALE");
    timestamp += 6_000;
    offline = false;
    const recovered = await provider.view("5m");

    expect(recovered.status).toBe("FRESH");
    expect(recovered.receivedAt).toBe(new Date(timestamp).toISOString());
  });
});
