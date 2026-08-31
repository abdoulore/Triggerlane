import { describe, expect, it } from "vitest";
import {
  buildSandboxQuote,
  calculatePnlRatio,
  classifyFrameTiming,
  compileForTarget,
  compileGhostIR,
  evaluateCondition,
  evaluateGhost,
  evaluateReplay,
  ghostDraftSchema,
  ghostIntelligence,
  modeledSlippageBps,
  isObservationNewer,
  parseGhostPrompt,
  STRATEGY_TEMPLATES,
  type AdapterCapabilityMatrix,
} from "../src/index";

describe("Ghost domain", () => {
  it("validates the narrow MVP amount rules", () => {
    const result = ghostDraftSchema.safeParse({
      name: "Profit lock",
      side: "SELL",
      amount: "25",
      amountType: "POSITION_PERCENT",
      maxSlippageBps: 50,
      expiresInHours: 24,
      conditions: [
        { metric: "PRICE", operator: "GTE", target: "280" },
        { metric: "FUNDING", operator: "GTE", target: "0.0005" },
        { metric: "PNL", operator: "GTE", target: "0.1" },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("supports one to three unique active conditions", () => {
    const base = {
      name: "Price only exit",
      side: "SELL" as const,
      amount: "25",
      amountType: "POSITION_PERCENT" as const,
      maxSlippageBps: 50,
      expiresInHours: 24,
    };
    const priceOnly = ghostDraftSchema.parse({ ...base, conditions: [{ metric: "PRICE", operator: "GTE", target: "280" }] });
    expect(compileGhostIR(priceOnly).predicate.conditions).toHaveLength(1);
    expect(ghostDraftSchema.safeParse({ ...base, conditions: [] }).success).toBe(false);
    expect(ghostDraftSchema.safeParse({ ...base, conditions: [{ metric: "PRICE", operator: "GTE", target: "280" }, { metric: "PRICE", operator: "LTE", target: "300" }] }).success).toBe(false);
  });

  it("evaluates ratios without floating-point drift", () => {
    expect(calculatePnlRatio("40", "10000", "275")).toBe("0.1");
    expect(evaluateCondition({ metric: "PNL", operator: "GTE", target: "0.1" }, "0.10").satisfied).toBe(true);
  });

  it("produces a deterministic sell quote", () => {
    expect(modeledSlippageBps("2500")).toBe(16);
    expect(buildSandboxQuote({ side: "SELL", reservedAmount: "10", referencePrice: "250" })).toMatchObject({
      executionPrice: "249.6",
      amountOut: "2496",
      modeledSlippageBps: 16,
    });
  });

  it("uses the exact live evaluator for Replay snapshots", () => {
    const conditions = [
      { metric: "PRICE" as const, operator: "GTE" as const, target: "280" },
      { metric: "FUNDING" as const, operator: "GTE" as const, target: "0.0005" },
      { metric: "PNL" as const, operator: "GTE" as const, target: "0.1" },
    ];
    const timestamp = "2026-08-01T00:00:00.000Z";
    const frame = {
      id: "replay-frame",
      market: "SOL/USDC" as const,
      cutoffAt: timestamp,
      assembledAt: timestamp,
      mode: "DEMO" as const,
      completeness: "COMPLETE" as const,
      executionEligible: false,
      observations: {
        PRICE: { id: "p", metric: "PRICE" as const, value: "284.6", unit: "USDC_PER_SOL" as const, provider: "fixture", sourceTimestamp: timestamp, receivedAt: timestamp, provenance: "DEMO" as const },
        FUNDING: { id: "f", metric: "FUNDING" as const, value: "0.00055", unit: "RATIO" as const, provider: "fixture", sourceTimestamp: timestamp, receivedAt: timestamp, provenance: "DEMO" as const },
        PNL: { id: "l", metric: "PNL" as const, value: "0.138", unit: "RATIO" as const, provider: "fixture", sourceTimestamp: timestamp, receivedAt: timestamp, provenance: "DEMO" as const },
      },
    };
    expect(evaluateReplay(conditions, [frame]).points[0]?.evaluations).toEqual(evaluateGhost(conditions, frame));
    expect(evaluateReplay(conditions, [frame]).triggerFrameIds).toEqual(["replay-frame"]);
  });

  it("ships only schema-valid strategies supported by the current metric contract", () => {
    expect(STRATEGY_TEMPLATES).toHaveLength(4);
    for (const strategy of STRATEGY_TEMPLATES) {
      expect(ghostDraftSchema.safeParse(strategy.draft).success).toBe(true);
      expect(new Set(strategy.metrics)).toEqual(new Set(["PRICE", "FUNDING", "PNL"]));
    }
  });

  it("parses a supported natural-language Ghost into strict domain units", () => {
    const result = parseGhostPrompt(
      "Sell half my SOL if it reaches $300, funding is above 0.05%, and my profit is at least 40%. Maximum 0.5% slippage for 7 days.",
      STRATEGY_TEMPLATES[1]!.draft,
    );
    expect(result.draft).toMatchObject({ side: "SELL", amount: "50", amountType: "POSITION_PERCENT", maxSlippageBps: 50, expiresInHours: 168 });
    expect(result.draft.conditions).toEqual([
      { metric: "PRICE", operator: "GTE", target: "300" },
      { metric: "FUNDING", operator: "GTE", target: "0.0005" },
      { metric: "PNL", operator: "GTE", target: "0.4" },
    ]);
    expect(result.unsupported).toEqual([]);
  });

  it("reports unsupported metrics and produces configuration-only intelligence", () => {
    const parsed = parseGhostPrompt("Sell 25% of my SOL below $220 if liquidity is under $500M and whale concentration rises.", STRATEGY_TEMPLATES[2]!.draft);
    expect(parsed.unsupported).toEqual(["whale concentration", "liquidity"]);
    expect(parsed.draft.conditions.find((condition) => condition.metric === "PRICE")).toMatchObject({ operator: "LTE", target: "220" });
    const insights = ghostIntelligence(parsed.draft, { PRICE: { value: "246" }, FUNDING: { value: "0.00031" }, PNL: { value: "-0.016" } });
    expect(insights[0]).toMatchObject({ kind: "CONFIGURATION_WARNING", action: "ADJUST" });
  });

  it("analyzes a non-price Ghost without assuming a price condition exists", () => {
    const draft = ghostDraftSchema.parse({ name: "Funding exit", side: "SELL", amount: "25", amountType: "POSITION_PERCENT", maxSlippageBps: 50, expiresInHours: 24, conditions: [{ metric: "FUNDING", operator: "GTE", target: "0.0005" }] });
    expect(ghostIntelligence(draft, { PRICE: { value: "246" }, FUNDING: { value: "0.00031" }, PNL: { value: "-0.016" } })).toEqual(expect.arrayContaining([expect.objectContaining({ title: "Configuration is internally valid" })]));
  });

  it("compiles stable units, operators, expiration, and one-shot semantics into GhostIR", () => {
    const compiledAt = new Date("2026-08-29T12:00:00.000Z");
    const ir = compileGhostIR(STRATEGY_TEMPLATES[1]!.draft, compiledAt);
    expect(ir).toMatchObject({
      version: 1,
      semantics: { oneShot: true, evaluationMode: "COMPLETE_FRAME", maxCrossMetricSkewMs: 5000 },
      action: { type: "SELL", assetIn: "SOL", assetOut: "USDC", amount: { type: "POSITION_PERCENT", value: "25" } },
      constraints: { maxSlippageBps: 50, expiresAt: "2026-09-05T12:00:00.000Z" },
    });
    expect(ir.predicate.conditions).toEqual(STRATEGY_TEMPLATES[1]!.draft.conditions);
    expect(ir.dataRequirements.map(({ metric, unit }) => [metric, unit])).toEqual([
      ["PRICE", "USDC_PER_SOL"], ["FUNDING", "RATIO"], ["PNL", "RATIO"],
    ]);
  });

  it("returns every unsupported target requirement without fabricating a workflow", () => {
    const unavailable: AdapterCapabilityMatrix = { target: "RIALO", configured: false, predicates: [], provenance: [], actions: [], assets: [], semantics: [], accountPermissions: "UNAVAILABLE", retry: "UNAVAILABLE", cancellation: "UNAVAILABLE", executionVenue: "UNAVAILABLE" };
    const result = compileForTarget(compileGhostIR(STRATEGY_TEMPLATES[0]!.draft), unavailable);
    expect(result.status).toBe("NOT_CONFIGURED");
    expect(result.deployable).toBe(false);
    expect(result.workflow).toBeNull();
    expect(result.unsupported.map((item) => item.code)).toEqual(expect.arrayContaining(["TARGET_NOT_CONFIGURED", "PREDICATE_UNSUPPORTED", "PROVENANCE_UNSUPPORTED", "ACTION_UNSUPPORTED", "ASSET_UNSUPPORTED", "SEMANTIC_UNSUPPORTED", "EXECUTION_VENUE_UNAVAILABLE"]));
  });

  it("classifies stale and cross-metric-skewed frames deterministically", () => {
    const timestamp = "2026-08-30T12:00:00.000Z";
    const observation = (id: string, metric: "PRICE" | "FUNDING" | "PNL", at = timestamp) => ({ id, metric, value: "1", unit: metric === "PRICE" ? "USDC_PER_SOL" as const : "RATIO" as const, provider: "fixture", providerSequence: 1, sourceTimestamp: at, receivedAt: at, provenance: "DEMO" as const });
    const frame = { id: "timing", market: "SOL/USDC" as const, cutoffAt: timestamp, assembledAt: timestamp, mode: "DEMO" as const, completeness: "COMPLETE" as const, executionEligible: true, observations: { PRICE: observation("p", "PRICE"), FUNDING: observation("f", "FUNDING"), PNL: observation("l", "PNL") } };
    expect(classifyFrameTiming(frame, new Date(timestamp).getTime() + 10_000)).toBe("COMPLETE");
    expect(classifyFrameTiming(frame, new Date(timestamp).getTime() + 20_000)).toBe("STALE");
    const skewed = structuredClone(frame);
    skewed.observations.FUNDING.sourceTimestamp = "2026-08-30T12:00:06.000Z";
    expect(classifyFrameTiming(skewed, new Date("2026-08-30T12:00:10.000Z").getTime())).toBe("INCOMPLETE");
  });

  it("deduplicates and orders provider observations by stable sequence", () => {
    const base = { id: "one", metric: "PRICE" as const, value: "246", unit: "USDC_PER_SOL" as const, provider: "fixture", providerSequence: 4, sourceTimestamp: "2026-08-30T12:00:00.000Z", receivedAt: "2026-08-30T12:00:01.000Z", provenance: "DEMO" as const };
    expect(isObservationNewer(base, base)).toBe(false);
    expect(isObservationNewer({ ...base, id: "old", providerSequence: 3, receivedAt: "2026-08-30T12:00:02.000Z" }, base)).toBe(false);
    expect(isObservationNewer({ ...base, id: "new", providerSequence: 5 }, base)).toBe(true);
  });
});
