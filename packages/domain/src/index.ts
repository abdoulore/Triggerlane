import Decimal from "decimal.js";
import { z } from "zod";

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export const ghostStatuses = [
  "DRAFT",
  "ARMED",
  "WATCHING",
  "TRIGGERED",
  "EXECUTING",
  "FILLED",
  "PAUSED",
  "EXPIRED",
  "CANCELLED",
  "FAILED",
] as const;

export type GhostStatus = (typeof ghostStatuses)[number];
export type DataMode = "DEMO" | "LIVE";
export type Side = "BUY" | "SELL";
export type Metric = "PRICE" | "FUNDING" | "PNL";
export type Operator = "GTE" | "LTE";
export type StrategyCategory = "Accumulation" | "Profit Taking" | "Protection";

export const conditionSchema = z.object({
  metric: z.enum(["PRICE", "FUNDING", "PNL"]),
  operator: z.enum(["GTE", "LTE"]),
  target: z.string().refine((value) => new Decimal(value).isFinite(), "Invalid decimal target"),
});

export const ghostDraftSchema = z
  .object({
    name: z.string().trim().min(3).max(48),
    side: z.enum(["BUY", "SELL"]),
    amount: z.string().refine((value) => new Decimal(value).gt(0), "Amount must be positive"),
    amountType: z.enum(["USDC", "POSITION_PERCENT"]),
    maxSlippageBps: z.number().int().min(1).max(500),
    expiresInHours: z.number().min(1 / 12).max(720),
    conditions: z.array(conditionSchema).min(1, "Choose at least one condition").max(3),
  })
  .superRefine((value, ctx) => {
    if (value.side === "BUY" && value.amountType !== "USDC") {
      ctx.addIssue({ code: "custom", path: ["amountType"], message: "BUY uses a fixed USDC amount" });
    }
    if (value.side === "SELL" && value.amountType !== "POSITION_PERCENT") {
      ctx.addIssue({ code: "custom", path: ["amountType"], message: "SELL uses a percentage of the SOL position" });
    }
    if (value.amountType === "POSITION_PERCENT" && new Decimal(value.amount).gt(100)) {
      ctx.addIssue({ code: "custom", path: ["amount"], message: "Position percentage cannot exceed 100" });
    }
    const metrics = new Set(value.conditions.map((condition) => condition.metric));
    if (metrics.size !== value.conditions.length) {
      ctx.addIssue({ code: "custom", path: ["conditions"], message: "Use each active condition only once" });
    }
  });

export type GhostDraft = z.infer<typeof ghostDraftSchema>;

export const ghostIrSchema = z.object({
  version: z.literal(1),
  market: z.literal("SOL/USDC"),
  semantics: z.object({
    oneShot: z.literal(true),
    evaluationMode: z.literal("COMPLETE_FRAME"),
    maxCrossMetricSkewMs: z.number().int().positive(),
  }),
  action: z.object({
    type: z.enum(["BUY", "SELL"]),
    assetIn: z.enum(["SOL", "USDC"]),
    assetOut: z.enum(["SOL", "USDC"]),
    amount: z.object({ type: z.enum(["FIXED", "POSITION_PERCENT"]), value: z.string() }),
  }),
  predicate: z.object({
    type: z.literal("ALL"),
    conditions: z.array(conditionSchema).min(1).max(3),
  }),
  dataRequirements: z.array(z.object({
    metric: z.enum(["PRICE", "FUNDING", "PNL"]),
    unit: z.enum(["USDC_PER_SOL", "RATIO"]),
    maxAgeMs: z.number().int().positive(),
    allowedProvenance: z.array(z.enum(["DEMO", "LIVE"])).min(1),
  })).min(1).max(3),
  constraints: z.object({
    maxSlippageBps: z.number().int().positive(),
    expiresAt: z.string().datetime(),
  }),
});

export type GhostIR = z.infer<typeof ghostIrSchema>;

export type AdapterCapabilityMatrix = {
  target: "SANDBOX" | "RIALO";
  configured: boolean;
  predicates: Metric[];
  provenance: Array<"DEMO" | "LIVE">;
  actions: Side[];
  assets: Array<"SOL" | "USDC">;
  semantics: Array<"ONE_SHOT" | "COMPLETE_FRAME" | "EXPIRATION" | "MAX_SLIPPAGE">;
  accountPermissions: "ANONYMOUS_SANDBOX" | "UNAVAILABLE";
  retry: "IDEMPOTENT" | "UNAVAILABLE";
  cancellation: "SUPPORTED" | "UNAVAILABLE";
  executionVenue: "SANDBOX_LEDGER" | "UNAVAILABLE";
};

export type UnsupportedCapability = {
  code: string;
  field: string;
  message: string;
};

export type TargetCompilation = {
  target: AdapterCapabilityMatrix["target"];
  status: "DEPLOYABLE" | "NOT_CONFIGURED" | "UNSUPPORTED";
  deployable: boolean;
  unsupported: UnsupportedCapability[];
  workflow: GhostIR | null;
};

export function compileGhostIR(draftInput: GhostDraft, compiledAt = new Date()): GhostIR {
  const draft = ghostDraftSchema.parse(draftInput);
  const ir: GhostIR = {
    version: 1,
    market: "SOL/USDC",
    semantics: { oneShot: true, evaluationMode: "COMPLETE_FRAME", maxCrossMetricSkewMs: 5_000 },
    action: {
      type: draft.side,
      assetIn: draft.side === "BUY" ? "USDC" : "SOL",
      assetOut: draft.side === "BUY" ? "SOL" : "USDC",
      amount: { type: draft.amountType === "USDC" ? "FIXED" : "POSITION_PERCENT", value: new Decimal(draft.amount).toFixed() },
    },
    predicate: { type: "ALL", conditions: draft.conditions.map((condition) => ({ ...condition, target: new Decimal(condition.target).toFixed() })) },
    dataRequirements: draft.conditions.map((condition) => ({
      metric: condition.metric,
      unit: condition.metric === "PRICE" ? "USDC_PER_SOL" : "RATIO",
      maxAgeMs: 15_000,
      allowedProvenance: ["DEMO"],
    })),
    constraints: {
      maxSlippageBps: draft.maxSlippageBps,
      expiresAt: new Date(compiledAt.getTime() + draft.expiresInHours * 60 * 60 * 1000).toISOString(),
    },
  };
  return ghostIrSchema.parse(ir);
}

export function compileForTarget(ir: GhostIR, capability: AdapterCapabilityMatrix): TargetCompilation {
  const unsupported: UnsupportedCapability[] = [];
  if (!capability.configured) unsupported.push({ code: "TARGET_NOT_CONFIGURED", field: "target", message: `${capability.target} access and toolchain are not configured.` });
  for (const requirement of ir.dataRequirements) {
    if (!capability.predicates.includes(requirement.metric)) unsupported.push({ code: "PREDICATE_UNSUPPORTED", field: `predicate.${requirement.metric}`, message: `${requirement.metric} predicates are unavailable on ${capability.target}.` });
    if (!requirement.allowedProvenance.some((item) => capability.provenance.includes(item))) unsupported.push({ code: "PROVENANCE_UNSUPPORTED", field: `dataRequirements.${requirement.metric}.allowedProvenance`, message: `${capability.target} has no qualified ${requirement.metric} feed with allowed provenance.` });
  }
  if (!capability.actions.includes(ir.action.type)) unsupported.push({ code: "ACTION_UNSUPPORTED", field: "action.type", message: `${ir.action.type} is unavailable on ${capability.target}.` });
  for (const asset of [ir.action.assetIn, ir.action.assetOut]) if (!capability.assets.includes(asset)) unsupported.push({ code: "ASSET_UNSUPPORTED", field: "action", message: `${asset} is unavailable on ${capability.target}.` });
  for (const semantic of ["ONE_SHOT", "COMPLETE_FRAME", "EXPIRATION", "MAX_SLIPPAGE"] as const) if (!capability.semantics.includes(semantic)) unsupported.push({ code: "SEMANTIC_UNSUPPORTED", field: "semantics", message: `${semantic} semantics are unverified on ${capability.target}.` });
  if (capability.executionVenue === "UNAVAILABLE") unsupported.push({ code: "EXECUTION_VENUE_UNAVAILABLE", field: "executionVenue", message: `No qualified ${capability.target} execution venue is available.` });
  const deployable = capability.configured && unsupported.length === 0;
  return { target: capability.target, status: deployable ? "DEPLOYABLE" : capability.configured ? "UNSUPPORTED" : "NOT_CONFIGURED", deployable, unsupported, workflow: deployable ? ir : null };
}

export const aiComposeRequestSchema = z.object({
  prompt: z.string().trim().min(12, "Describe the trigger in a little more detail.").max(600),
  baseDraft: ghostDraftSchema,
});

export type GhostInsight = {
  kind: "INSIGHT" | "CONFIGURATION_WARNING" | "DATA_WARNING";
  title: string;
  message: string;
  action: "ADJUST" | "REPLAY" | "IGNORE";
};

export type AiComposeResult = {
  draft: GhostDraft;
  interpretation: string[];
  retained: string[];
  unsupported: string[];
  insights: GhostInsight[];
  disclaimer: string;
};

const numeric = "([0-9]+(?:[,.][0-9]+)?)";

function firstNumber(input: string, patterns: RegExp[]): number | null {
  for (const pattern of patterns) {
    const match = input.match(pattern);
    if (match?.[1]) return Number(match[1].replaceAll(",", ""));
  }
  return null;
}

function inferredOperator(input: string, subject: string): Operator | null {
  const relevant = input.match(new RegExp(`${subject}[^.!?]{0,55}`, "i"))?.[0] ?? input;
  if (/\b(below|under|drops? to|falls? to|at most|less than|no more than)\b/i.test(relevant)) return "LTE";
  if (/\b(above|over|reaches?|hits?|rises? to|at least|exceeds?|greater than)\b/i.test(relevant)) return "GTE";
  return null;
}

export function parseGhostPrompt(rawPrompt: string, baseDraft: GhostDraft): Omit<AiComposeResult, "insights"> {
  const prompt = rawPrompt.trim();
  const lower = prompt.toLowerCase();
  const next: GhostDraft = structuredClone(baseDraft);
  const interpretation: string[] = [];
  const retained: string[] = [];
  const unsupported = [
    ["whale concentration", /\b(whale|holder concentration)\b/i],
    ["liquidity", /\bliquidity\b/i],
    ["TVL", /\btvl\b|total value locked/i],
    ["volume", /\bvolume\b/i],
    ["volatility", /\bvolatility\b/i],
  ].filter(([, pattern]) => (pattern as RegExp).test(prompt)).map(([label]) => label as string);

  if (/\b(sell|exit|take profit|scale out|reduce)\b/i.test(prompt)) {
    next.side = "SELL";
    next.amountType = "POSITION_PERCENT";
    next.name = "AI SOL exit";
    interpretation.push("Action: sell SOL");
  } else if (/\b(buy|accumulate|enter|add)\b/i.test(prompt)) {
    next.side = "BUY";
    next.amountType = "USDC";
    next.name = "AI SOL entry";
    interpretation.push("Action: buy SOL");
  } else retained.push("Action was not specified; current Composer action retained.");

  const percentAmount = firstNumber(prompt, [new RegExp(`(?:sell|exit|reduce|scale out)(?:\\s+of)?[^.!?]{0,18}?${numeric}\\s*%`, "i"), new RegExp(`${numeric}\\s*%(?:\\s+of)?\\s+(?:my\\s+)?sol`, "i")]);
  const fixedBuyAmount = firstNumber(prompt, [new RegExp(`(?:buy|spend|use|with)[^.!?]{0,20}?(?:\\$|usdc\\s*)${numeric}`, "i"), new RegExp(`(?:buy|spend|use|with)[^.!?]{0,20}?${numeric}\\s*usdc`, "i")]);
  if (next.side === "SELL" && /\b(all|everything|entire)\b/i.test(prompt)) next.amount = "100";
  else if (next.side === "SELL" && /\bhalf\b/i.test(prompt)) next.amount = "50";
  else if (next.side === "SELL" && /\bquarter\b/i.test(prompt)) next.amount = "25";
  else if (next.side === "SELL" && percentAmount != null) next.amount = String(percentAmount);
  else if (next.side === "BUY" && fixedBuyAmount != null) next.amount = String(fixedBuyAmount);
  else retained.push("Amount was not specified; current Composer amount retained.");
  interpretation.push(`Amount: ${next.side === "SELL" ? `${next.amount}% of the SOL position` : `${next.amount} USDC`}`);

  const updateCondition = (metric: Metric, value: number | null, operator: Operator | null, ratio = false) => {
    const existing = next.conditions.find((condition) => condition.metric === metric);
    if (value == null) {
      if (existing) retained.push(`${metric === "PNL" ? "Position P&L" : metric.toLowerCase()} condition retained.`);
      return;
    }
    if (existing) next.conditions = next.conditions.map((condition) => condition.metric === metric ? { ...condition, operator: operator ?? condition.operator, target: String(ratio ? value / 100 : value) } : condition);
    else next.conditions.push({ metric, operator: operator ?? "GTE", target: String(ratio ? value / 100 : value) });
    const condition = next.conditions.find((item) => item.metric === metric)!;
    interpretation.push(`${metric === "PNL" ? "Position P&L" : metric}: ${condition.operator === "GTE" ? "at least" : "at most"} ${metric === "PRICE" ? `$${value}` : `${value}%`}`);
  };

  const price = firstNumber(prompt, [new RegExp(`(?:sol|price|it)[^.!?]{0,30}?(?:reaches?|hits?|above|over|below|under|at least|at most|exceeds?|drops? to|falls? to)\\s*\\$?${numeric}`, "i"), new RegExp(`(?:reaches?|hits?|above|over|below|under)\\s*\\$${numeric}`, "i")]);
  const funding = firstNumber(prompt, [new RegExp(`funding[^.!?]{0,35}?${numeric}\\s*%`, "i")]);
  const pnl = firstNumber(prompt, [new RegExp(`(?:profit|p&l|pnl|position)[^.!?]{0,45}?${numeric}\\s*%`, "i")]);
  updateCondition("PRICE", price, inferredOperator(prompt, "(?:sol|price|it)"));
  updateCondition("FUNDING", funding, inferredOperator(prompt, "funding"), true);
  updateCondition("PNL", pnl, inferredOperator(prompt, "(?:profit|p&l|pnl|position)"), true);

  const slippage = firstNumber(prompt, [new RegExp(`slippage[^.!?]{0,20}?${numeric}\\s*%`, "i")]);
  if (slippage != null) {
    next.maxSlippageBps = Math.round(slippage * 100);
    interpretation.push(`Maximum slippage: ${slippage}%`);
  } else retained.push("Maximum slippage retained.");

  const expiry = prompt.match(new RegExp(`(?:expire|expires|expiry|for|within)[^.!?]{0,12}?${numeric}\\s*(hours?|hrs?|days?)`, "i"));
  if (expiry?.[1] && expiry[2]) {
    const count = Number(expiry[1].replaceAll(",", ""));
    next.expiresInHours = /day/i.test(expiry[2]) ? count * 24 : count;
    interpretation.push(`Expiry: ${count} ${expiry[2].toLowerCase()}`);
  } else retained.push("Expiry retained.");

  if (unsupported.length) interpretation.push(`Unsupported requests omitted: ${unsupported.join(", ")}`);
  const draft = ghostDraftSchema.parse(next);
  return { draft, interpretation, retained, unsupported, disclaimer: "Triggerlane analyzes configuration and historical conditions. It does not provide investment advice." };
}

export function ghostIntelligence(draft: GhostDraft, observations: Record<Metric, { value: string }>): GhostInsight[] {
  const insights: GhostInsight[] = [];
  const price = new Decimal(observations.PRICE.value);
  const priceCondition = draft.conditions.find((condition) => condition.metric === "PRICE");
  if (priceCondition) {
    const priceDistance = new Decimal(priceCondition.target).minus(price).div(price).mul(100);
    if (priceDistance.abs().gte(10)) insights.push({ kind: "CONFIGURATION_WARNING", title: "Distant price condition", message: `Your $${priceCondition.target} SOL condition is ${priceDistance.abs().toDecimalPlaces(1).toString()}% ${priceDistance.isPositive() ? "above" : "below"} the current frame.`, action: "ADJUST" });
  }
  if (draft.maxSlippageBps >= 100) insights.push({ kind: "CONFIGURATION_WARNING", title: "Wide slippage limit", message: `Maximum slippage is ${(draft.maxSlippageBps / 100).toFixed(2)}%. Review the commitment before arming.`, action: "ADJUST" });
  if (draft.expiresInHours >= 168) insights.push({ kind: "INSIGHT", title: "Long monitoring window", message: `This trigger can remain active for ${Math.round(draft.expiresInHours / 24)} days. Replay can show how often the configuration aligned historically.`, action: "REPLAY" });
  if (!insights.length) insights.push({ kind: "INSIGHT", title: "Configuration is internally valid", message: "All supported conditions have explicit units, an expiry, and a maximum slippage limit.", action: "REPLAY" });
  return insights.slice(0, 3);
}

export interface StrategyTemplate {
  id: string;
  name: string;
  category: StrategyCategory;
  description: string;
  thesis: string;
  featured: boolean;
  metrics: Metric[];
  draft: GhostDraft;
}

export const STRATEGY_TEMPLATES: StrategyTemplate[] = [
  {
    id: "buy-the-fear",
    name: "Buy the Fear",
    category: "Accumulation",
    description: "Accumulate a deep SOL correction only while funding and portfolio conditions confirm stress.",
    thesis: "Correction entry",
    featured: true,
    metrics: ["PRICE", "FUNDING", "PNL"],
    draft: { name: "Buy the Fear", side: "BUY", amount: "1000", amountType: "USDC", maxSlippageBps: 50, expiresInHours: 168, conditions: [{ metric: "PRICE", operator: "LTE", target: "230" }, { metric: "FUNDING", operator: "LTE", target: "0" }, { metric: "PNL", operator: "LTE", target: "-0.08" }] },
  },
  {
    id: "euphoria-exit",
    name: "Euphoria Exit",
    category: "Profit Taking",
    description: "Scale out when SOL price, position profit, and perpetual funding indicate an overheated market.",
    thesis: "Overheating exit",
    featured: true,
    metrics: ["PRICE", "PNL", "FUNDING"],
    draft: { name: "Euphoria Exit", side: "SELL", amount: "25", amountType: "POSITION_PERCENT", maxSlippageBps: 50, expiresInHours: 168, conditions: [{ metric: "PRICE", operator: "GTE", target: "280" }, { metric: "FUNDING", operator: "GTE", target: "0.0005" }, { metric: "PNL", operator: "GTE", target: "0.1" }] },
  },
  {
    id: "downside-break",
    name: "Downside Break",
    category: "Protection",
    description: "Reduce SOL exposure when price, funding, and portfolio performance weaken together.",
    thesis: "Loss containment",
    featured: true,
    metrics: ["PRICE", "FUNDING", "PNL"],
    draft: { name: "Downside Break", side: "SELL", amount: "50", amountType: "POSITION_PERCENT", maxSlippageBps: 75, expiresInHours: 24, conditions: [{ metric: "PRICE", operator: "LTE", target: "230" }, { metric: "FUNDING", operator: "LTE", target: "-0.0002" }, { metric: "PNL", operator: "LTE", target: "-0.08" }] },
  },
  {
    id: "calm-recovery",
    name: "Calm Recovery",
    category: "Accumulation",
    description: "Enter a recovering SOL market only before funding becomes crowded and portfolio P&L stretches.",
    thesis: "Measured re-entry",
    featured: false,
    metrics: ["PRICE", "FUNDING", "PNL"],
    draft: { name: "Calm Recovery", side: "BUY", amount: "750", amountType: "USDC", maxSlippageBps: 40, expiresInHours: 72, conditions: [{ metric: "PRICE", operator: "GTE", target: "255" }, { metric: "FUNDING", operator: "LTE", target: "0.0003" }, { metric: "PNL", operator: "LTE", target: "0.05" }] },
  },
];

export interface MetricObservation {
  id: string;
  metric: Metric;
  value: string;
  unit: "USDC_PER_SOL" | "RATIO";
  provider: string;
  providerSequence?: number;
  sourceTimestamp: string | null;
  receivedAt: string;
  provenance: "DEMO" | "LIVE";
  portfolioVersion?: number;
  derivedFromObservationIds?: string[];
}

export interface EvaluationFrame {
  id: string;
  market: "SOL/USDC";
  cutoffAt: string;
  assembledAt: string;
  mode: DataMode;
  completeness: "COMPLETE" | "INCOMPLETE" | "STALE";
  executionEligible: boolean;
  observations: Record<Metric, MetricObservation>;
}

export function classifyFrameTiming(frame: EvaluationFrame, nowMs = Date.now(), maxAgeMs = 15_000, maxSkewMs = 5_000): EvaluationFrame["completeness"] {
  const timestamps = Object.values(frame.observations).map((observation) => new Date(observation.sourceTimestamp ?? observation.receivedAt).getTime());
  if (timestamps.some((timestamp) => !Number.isFinite(timestamp))) return "INCOMPLETE";
  if (timestamps.some((timestamp) => nowMs - timestamp > maxAgeMs)) return "STALE";
  if (Math.max(...timestamps) - Math.min(...timestamps) > maxSkewMs) return "INCOMPLETE";
  return "COMPLETE";
}

export function isObservationNewer(incoming: MetricObservation, previous?: MetricObservation): boolean {
  if (!previous) return true;
  if (incoming.id === previous.id) return false;
  if (incoming.provider === previous.provider && incoming.providerSequence != null && previous.providerSequence != null) {
    return incoming.providerSequence > previous.providerSequence;
  }
  return new Date(incoming.receivedAt).getTime() > new Date(previous.receivedAt).getTime();
}

export interface ConditionResult {
  metric: Metric;
  operator: Operator;
  target: string;
  current: string;
  satisfied: boolean;
  distanceRatio: string;
}

export interface QuoteResult {
  referencePrice: string;
  executionPrice: string;
  amountIn: string;
  amountOut: string;
  modeledSlippageBps: number;
  modelVersion: "sandbox-v1";
}

export interface ReplayPoint {
  frame: EvaluationFrame;
  evaluations: ConditionResult[];
  readyCount: number;
  triggered: boolean;
}

export interface ReplayEvaluation {
  points: ReplayPoint[];
  triggerFrameIds: string[];
}

export const DEMO_FRAMES = [
  { price: "246.00", funding: "0.00031" },
  { price: "258.40", funding: "0.00038" },
  { price: "274.80", funding: "0.00047" },
  { price: "281.20", funding: "0.00049" },
  { price: "284.60", funding: "0.00055" },
  { price: "288.10", funding: "0.00058" },
] as const;

export function decimal(value: Decimal.Value): Decimal {
  return new Decimal(value);
}

export function toFixed(value: Decimal.Value, places = 6): string {
  return new Decimal(value).toDecimalPlaces(places).toFixed();
}

export function calculatePnlRatio(quantity: Decimal.Value, costBasisUsdc: Decimal.Value, price: Decimal.Value): string {
  const qty = new Decimal(quantity);
  const basis = new Decimal(costBasisUsdc);
  if (qty.lte(0) || basis.lte(0)) return "0";
  return qty.mul(price).minus(basis).div(basis).toDecimalPlaces(8).toFixed();
}

export function evaluateCondition(
  condition: Pick<z.infer<typeof conditionSchema>, "metric" | "operator" | "target">,
  current: Decimal.Value,
): ConditionResult {
  const value = new Decimal(current);
  const target = new Decimal(condition.target);
  const satisfied = condition.operator === "GTE" ? value.gte(target) : value.lte(target);
  const denominator = Decimal.max(target.abs(), new Decimal("0.00000001"));
  const distance = value.minus(target).abs().div(denominator);
  return {
    ...condition,
    current: value.toFixed(),
    satisfied,
    distanceRatio: distance.toDecimalPlaces(8).toFixed(),
  };
}

export function evaluateGhost(conditions: GhostDraft["conditions"], frame: EvaluationFrame): ConditionResult[] {
  return conditions.map((condition) =>
    evaluateCondition(condition, frame.observations[condition.metric].value),
  );
}

export function evaluateReplay(conditions: GhostDraft["conditions"], frames: EvaluationFrame[]): ReplayEvaluation {
  let wasQualified = false;
  const triggerFrameIds: string[] = [];
  const points = frames.map((frame) => {
    const evaluations = evaluateGhost(conditions, frame);
    const readyCount = evaluations.filter((evaluation) => evaluation.satisfied).length;
    const qualified = frame.completeness === "COMPLETE" && readyCount === evaluations.length;
    const triggered = qualified && !wasQualified;
    if (triggered) triggerFrameIds.push(frame.id);
    wasQualified = qualified;
    return { frame, evaluations, readyCount, triggered };
  });
  return { points, triggerFrameIds };
}

export function modeledSlippageBps(notionalUsdc: Decimal.Value): number {
  const sizeComponent = Decimal.min(90, new Decimal(notionalUsdc).div(1000).ceil().mul(2)).toNumber();
  return 10 + sizeComponent;
}

export function buildSandboxQuote(args: {
  side: Side;
  reservedAmount: Decimal.Value;
  referencePrice: Decimal.Value;
}): QuoteResult {
  const referencePrice = new Decimal(args.referencePrice);
  const reserved = new Decimal(args.reservedAmount);
  const notional = args.side === "BUY" ? reserved : reserved.mul(referencePrice);
  const slippageBps = modeledSlippageBps(notional);
  const multiplier = new Decimal(1).plus(
    new Decimal(slippageBps).div(10_000).mul(args.side === "BUY" ? 1 : -1),
  );
  const executionPrice = referencePrice.mul(multiplier);
  const amountOut = args.side === "BUY" ? reserved.div(executionPrice) : reserved.mul(executionPrice);
  return {
    referencePrice: referencePrice.toDecimalPlaces(6).toFixed(),
    executionPrice: executionPrice.toDecimalPlaces(6).toFixed(),
    amountIn: reserved.toDecimalPlaces(args.side === "BUY" ? 6 : 9).toFixed(),
    amountOut: amountOut.toDecimalPlaces(args.side === "BUY" ? 9 : 6).toFixed(),
    modeledSlippageBps: slippageBps,
    modelVersion: "sandbox-v1",
  };
}

export function isTerminal(status: GhostStatus): boolean {
  return ["FILLED", "CANCELLED", "EXPIRED", "FAILED"].includes(status);
}

export function formatMetric(metric: Metric, value: Decimal.Value): string {
  const decimalValue = new Decimal(value);
  if (metric === "PRICE") return `$${decimalValue.toFixed(2)}`;
  return `${decimalValue.mul(100).toFixed(metric === "FUNDING" ? 3 : 1)}%`;
}
