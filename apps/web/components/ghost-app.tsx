"use client";

import {
  ArrowRight,
  Broadcast,
  BracketsCurly,
  CaretLeft,
  CaretRight,
  ChartLineUp,
  Check,
  CheckCircle,
  ClockCounterClockwise,
  Copy,
  Crosshair,
  Database,
  DownloadSimple,
  Eye,
  Path as BrandIcon,
  Lightning,
  LockSimple,
  Pause,
  Play,
  Plus,
  Power,
  Printer,
  Pulse,
  Question,
  ShieldCheck,
  Sparkle,
  SlidersHorizontal,
  UserCircle,
  Warning,
  X,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useReducer, useState } from "react";
import { evaluateCondition, formatMetric, type AiComposeResult, type GhostDraft, type Metric } from "@ghost/domain";
import { API_URL, ApiError, api } from "@/lib/api";
import { GhostCoreScene, type GhostCoreSceneCondition } from "./ghost-detail/ghost-core-scene";
import { MarketChart } from "./market-chart";
import { AppShell, SandboxDisclaimer } from "./shells";
import { MetricValue, StatusBadge } from "./ui-foundation";

type AppView = "trade" | "ghosts" | "portfolio" | "history" | "discover" | "detail";

interface RuntimeCapabilities {
  environment: "development" | "preview" | "production-sandbox" | "production-rialo";
  executionMode: "SANDBOX" | "RIALO";
  features: { aiComposer: boolean; replay: boolean; multiStage: boolean; rialo: boolean; demoFeed: boolean; advancedConditions: boolean };
}

interface Balance {
  asset: "SOL" | "USDC";
  quantity: string;
  reserved: string;
  available: string;
  costBasisUsdc: string | null;
}

interface Evaluation {
  metric: Metric;
  operator: "GTE" | "LTE";
  target: string;
  current: string;
  satisfied: boolean;
  distanceRatio: string;
}

interface GhostRecord {
  id: string;
  name: string;
  side: "BUY" | "SELL";
  amount: string;
  amountType: "USDC" | "POSITION_PERCENT";
  maxSlippageBps: number;
  expiresAt: string;
  conditions: GhostDraft["conditions"];
  evaluations: Evaluation[];
  status: string;
  pauseReason: string | null;
  triggerProximity: string;
  createdAt: string;
  armedAt: string | null;
  executedAt: string | null;
  updatedAt: string;
  reservation?: { id: string; asset: string; amount: string; status: string } | null;
  activities?: Activity[];
  execution?: Execution | null;
}

interface Observation {
  id: string;
  metric: Metric;
  value: string;
  provider: string;
  sourceTimestamp: string | null;
  receivedAt: string;
  provenance: "DEMO" | "LIVE";
}

interface Frame {
  id: string;
  mode: "DEMO" | "LIVE";
  completeness: string;
  executionEligible: boolean;
  assembledAt: string;
  observations: Record<Metric, Observation>;
}

interface Activity {
  id: string;
  ghost_id: string | null;
  type: string;
  message: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

interface Execution {
  id: string;
  ghost_id: string;
  ghost_name: string;
  status: string;
  input_asset: string;
  input_amount: string;
  output_asset: string;
  output_amount: string;
  execution_price: string;
  modeled_slippage_bps: number;
  completed_at: string;
  receipt: Record<string, any>;
}

interface ExecutionAttempt {
  id: string;
  ghostId: string;
  ghostName: string;
  configurationVersion: number;
  status: "BLOCKED";
  side: "BUY" | "SELL";
  amount: string;
  amountType: "USDC" | "POSITION_PERCENT";
  maxSlippageBps: number;
  conditions: GhostDraft["conditions"];
  createdAt: string;
  updatedAt: string;
  reason: { message: string; metadata: { quote?: { modelVersion?: string; referencePrice?: string; executionPrice?: string; modeledSlippageBps?: number } }; createdAt: string } | null;
  reservation: { id: string; asset: string; amount: string; status: string } | null;
  frame: Frame;
}

interface LedgerEntry {
  id: string;
  asset: "SOL" | "USDC";
  amount: string;
  costBasisDeltaUsdc: string | null;
  unitPriceUsdc: string | null;
  type: string;
  createdAt: string;
}

interface LedgerTransaction {
  id: string;
  type: string;
  executionId: string | null;
  ghostId: string | null;
  ghostName: string | null;
  createdAt: string;
  entries: LedgerEntry[];
}

interface CapitalReservation {
  id: string;
  ghostId: string;
  ghostName: string;
  side: "BUY" | "SELL";
  asset: "SOL" | "USDC";
  amount: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

interface Workspace {
  identity: { id: string; label: string };
  portfolio: {
    id: string;
    dataMode: "DEMO" | "LIVE";
    demoStep: number;
    version: number;
    balances: { SOL: Balance; USDC: Balance };
  };
  frame: Frame;
  ghosts: GhostRecord[];
  activities: Activity[];
  executions: Execution[];
  executionAttempts: ExecutionAttempt[];
  ledger: LedgerTransaction[];
  reservations: CapitalReservation[];
}

interface LiveMarket {
  market: string;
  provider: string;
  price: string;
  oraclePrice: string;
  midPrice: string | null;
  funding: string;
  receivedAt: string;
  sourceTimestamp: null;
  executionEligible: false;
  eligibilityReason: string;
}

interface Diagnostics {
  ok: boolean;
  averageResponseMs: number;
  outboxPending: number;
  executionAttemptsInFlight: number;
  workerLease: { active: boolean; owner: string | null };
}

interface ReplayPoint {
  frameId: string;
  at: string;
  readyCount: number;
  triggered: boolean;
  values: Record<Metric, string>;
  evaluations: Evaluation[];
}

interface ReplayResult {
  id: string;
  status: "COMPLETE";
  label: string;
  provider: { name: string; mode: "HISTORICAL"; provenance: "DEMO"; liveHistory: false };
  disclaimer: string;
  summary: { period: "24H" | "7D" | "30D"; triggerCount: number; firstTriggerAt: string | null; latestTriggerAt: string | null; medianWatchingHours: number; simulatedOutcomePercent: string; frameCount: number; completeFrameCount: number };
  points: ReplayPoint[];
}

interface Strategy {
  id: string;
  name: string;
  category: "Accumulation" | "Profit Taking" | "Protection";
  description: string;
  thesis: string;
  featured: boolean;
  metrics: Metric[];
  draft: GhostDraft;
}

interface StrategyCatalog {
  title: string;
  categories: Array<"Popular" | "Accumulation" | "Profit Taking" | "Protection" | "Advanced">;
  capabilities: { market: string; metrics: Metric[]; unsupportedAdvancedMetrics: string[] };
  strategies: Strategy[];
}

const onboardingByView: Record<AppView, { title: string; intro: string; steps: [string, string, string] }> = {
  trade: { title: "Build one clear trigger", intro: "Choose the market moment first. Triggerlane will keep watching until every condition you add is true together.", steps: ["Choose one signal or combine several", "Review the capital commitment", "Save, then start monitoring"] },
  ghosts: { title: "Read triggers by attention", intro: "The closest trigger is the one whose current signals are nearest to agreeing.", steps: ["Check the plain-language state", "Compare current values with targets", "Pause, resume, or inspect safely"] },
  detail: { title: "Start with the answer", intro: "The current answer explains why this trigger is waiting, blocked, or complete before showing technical evidence.", steps: ["Read the current state", "See which signal still disagrees", "Open evidence only when needed"] },
  portfolio: { title: "Follow every virtual dollar", intro: "Available capital is free to use. Reserved capital belongs to a named active trigger.", steps: ["Reconcile available plus reserved", "Trace each reservation to its owner", "Open ledger evidence for movements"] },
  history: { title: "Read the outcome first", intro: "Every row begins with what happened to the trigger and its capital, then keeps the stored proof behind it.", steps: ["Identify the outcome", "Confirm the capital result", "Expand the receipt or attempt"] },
  discover: { title: "Learn before you build", intro: "Strategies here are teaching examples. Replay explores demo history; Composer lets you edit the idea yourself.", steps: ["Understand why the signals belong together", "Replay without changing your account", "Load an editable draft for review"] },
};

interface AiComposeResponse extends AiComposeResult {
  parser: { mode: "DETERMINISTIC"; modelProvider: null; supportedMarket: string; supportedMetrics: Metric[] };
}

interface CompilerPreview {
  ir: {
    version: 1;
    semantics: { oneShot: true; evaluationMode: "COMPLETE_FRAME"; maxCrossMetricSkewMs: number };
    action: { type: "BUY" | "SELL"; assetIn: string; assetOut: string; amount: { type: string; value: string } };
    predicate: { type: "ALL"; conditions: GhostDraft["conditions"] };
    dataRequirements: Array<{ metric: Metric; unit: string; maxAgeMs: number; allowedProvenance: string[] }>;
    constraints: { maxSlippageBps: number; expiresAt: string };
  };
  compilations: Array<{ target: "SANDBOX" | "RIALO"; status: string; deployable: boolean; unsupported: Array<{ code: string; field: string; message: string }> }>;
  networkArtifacts: null;
  notice: string;
}

type ComposerState = GhostDraft;
type ComposerAction =
  | { type: "field"; field: keyof Omit<ComposerState, "conditions">; value: string | number }
  | { type: "condition"; metric: Metric; field: "operator" | "target"; value: string }
  | { type: "toggle-condition"; metric: Metric }
  | { type: "side"; side: "BUY" | "SELL" }
  | { type: "load"; draft: GhostDraft }
  | { type: "reset" };

const conditionOrder: Metric[] = ["PRICE", "FUNDING", "PNL"];
const conditionDefaults: Record<Metric, GhostDraft["conditions"][number]> = {
  PRICE: { metric: "PRICE", operator: "GTE", target: "280" },
  FUNDING: { metric: "FUNDING", operator: "GTE", target: "0.0005" },
  PNL: { metric: "PNL", operator: "GTE", target: "0.1" },
};

const initialComposer: ComposerState = {
  name: "SOL profit lock",
  side: "SELL",
  amount: "25",
  amountType: "POSITION_PERCENT",
  maxSlippageBps: 50,
  expiresInHours: 24,
  conditions: [{ ...conditionDefaults.PRICE }],
};

function composerReducer(state: ComposerState, action: ComposerAction): ComposerState {
  if (action.type === "reset") return initialComposer;
  if (action.type === "load") return action.draft;
  if (action.type === "side") {
    return {
      ...state,
      side: action.side,
      amountType: action.side === "BUY" ? "USDC" : "POSITION_PERCENT",
      amount: action.side === "BUY" ? "1000" : "25",
      name: action.side === "BUY" ? "SOL conviction entry" : "SOL profit lock",
    };
  }
  if (action.type === "field") return { ...state, [action.field]: action.value } as ComposerState;
  if (action.type === "toggle-condition") {
    const active = state.conditions.some((condition) => condition.metric === action.metric);
    if (active && state.conditions.length === 1) return state;
    const conditions = active
      ? state.conditions.filter((condition) => condition.metric !== action.metric)
      : [...state.conditions, { ...conditionDefaults[action.metric] }].sort((left, right) => conditionOrder.indexOf(left.metric) - conditionOrder.indexOf(right.metric));
    return { ...state, conditions };
  }
  return {
    ...state,
    conditions: state.conditions.map((condition) =>
      condition.metric === action.metric ? { ...condition, [action.field]: action.value } : condition,
    ),
  };
}

const money = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
const quantity = new Intl.NumberFormat("en-US", { maximumFractionDigits: 5 });

function dateTime(value: string) {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function ageLabel(value: string) {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000));
  return seconds < 2 ? "JUST NOW" : seconds < 60 ? `${seconds}S AGO` : `${Math.floor(seconds / 60)}M AGO`;
}

function providerLabel(value: string) {
  return value.replace(/^ghost-demo-feed$/i, "triggerlane-demo-feed");
}

const metricLabels: Record<Metric, string> = { PRICE: "SOL price", FUNDING: "Perp funding", PNL: "Position P&L" };

function ghostStateSummary(ghost: GhostRecord, frame: Frame) {
  const ready = ghost.evaluations.filter((evaluation) => evaluation.satisfied).length;
  const total = ghost.evaluations.length;
  if (frame.completeness !== "COMPLETE") return { tone: "blocked", label: "SAFETY HOLD", headline: frame.completeness === "STALE" ? "Fresh market data is missing" : "One complete market frame is missing", reason: "No action can run until every selected signal is stored together in one complete frame.", ready, total };
  if (ghost.status === "DRAFT") return { tone: "draft", label: "NOT STARTED", headline: "Ready for your review", reason: "No capital is reserved until you start watching.", ready, total };
  if (ghost.status === "PAUSED") return { tone: "blocked", label: ghost.pauseReason === "USER" ? "PAUSED BY YOU" : "SAFETY HOLD", headline: ghost.pauseReason === "DATA_STALE" ? "Waiting for fresh market data" : ghost.pauseReason === "FRAME_INCOMPLETE" ? "Waiting for a complete market frame" : "Monitoring is paused", reason: "This trigger cannot act while paused. Reserved capital remains controlled.", ready, total };
  if (ghost.status === "FILLED") return { tone: "complete", label: "FINISHED", headline: "Executed once and settled", reason: "A qualifying frame, quote, reservation, receipt, and ledger movement were stored.", ready, total };
  if (ghost.status === "FAILED") return { tone: "blocked", label: "SETTLEMENT FAILED", headline: "The action did not settle", reason: "No ledger movement was committed. The failure and capital outcome remain in the audit trail.", ready, total };
  if (ghost.status === "CANCELLED") return { tone: "terminal", label: "STOPPED", headline: "Cancelled before execution", reason: "Monitoring ended and reserved capital was released without a trade.", ready, total };
  if (ghost.status === "EXPIRED") return { tone: "terminal", label: "DEADLINE PASSED", headline: "Expired before execution", reason: "The full moment did not arrive before the deadline, so capital was released.", ready, total };
  const waiting = [...ghost.evaluations].filter((evaluation) => !evaluation.satisfied).sort((left, right) => Number(left.distanceRatio) - Number(right.distanceRatio));
  if (!waiting.length) return { tone: "ready", label: "ALL SIGNALS READY", headline: "The whole moment is here", reason: "Every selected signal is true in this complete frame. The one-shot action can continue.", ready, total };
  const next = waiting[0]!;
  const direction = next.operator === "GTE" ? "reach at least" : "fall to at most";
  const otherCount = waiting.length - 1;
  return { tone: "watching", label: `${ready} OF ${total} READY`, headline: `${metricLabels[next.metric]} is the next missing signal`, reason: `Current ${formatMetric(next.metric, next.current)}; it must ${direction} ${formatMetric(next.metric, next.target)}${otherCount ? `, with ${otherCount} other signal${otherCount === 1 ? "" : "s"} still waiting` : ""}.`, ready, total };
}

function ghostWaitingReason(ghost: GhostRecord | undefined, evaluations: Evaluation[], frame: Frame) {
  if (frame.completeness !== "COMPLETE") return frame.completeness === "STALE" ? "Waiting for fresh market data" : "Waiting for one complete observation frame";
  if (!ghost) return "Choose the moment on the right, then save your trigger";
  if (ghost.status === "DRAFT") return "Ready when you are · start watching to reserve capital";
  if (ghost.status === "PAUSED") return ghost.pauseReason === "DATA_STALE" ? "Paused until market data is fresh" : "Monitoring is paused";
  if (ghost.status === "FILLED") return "Executed once · settlement is final";
  if (["CANCELLED", "EXPIRED", "FAILED"].includes(ghost.status)) return `${ghost.status.toLowerCase()} · no longer monitoring`;
  const waiting = evaluations.filter((evaluation) => !evaluation.satisfied).map((evaluation) => evaluation.metric === "PNL" ? "position P&L" : evaluation.metric.toLowerCase());
  return waiting.length ? `Waiting for ${waiting.join(" + ")}` : "All conditions ready · execution boundary reached";
}

function Logo() {
  return (
    <a className="brand" href="/" aria-label="Go to Triggerlane home">
      <span className="brand-mark"><BrandIcon weight="duotone" size={19} /></span>
      <span><b>TRIGGERLANE</b><small>CONDITIONAL TRADING</small></span>
    </a>
  );
}

function ConditionStrip({ evaluations, frame }: { evaluations: Evaluation[]; frame: Frame }) {
  return (
    <div className="condition-strip">
      {evaluations.map((evaluation, index) => (
        <motion.div
          layout
          className={`condition-cell ${evaluation.satisfied ? "condition-ready" : ""}`}
          key={evaluation.metric}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: index * 0.06 }}
        >
          <div className="condition-cell-top">
            <span>{metricLabels[evaluation.metric]}</span>
            {evaluation.satisfied ? <CheckCircle size={17} weight="fill" /> : <span className="condition-index">0{index + 1}</span>}
          </div>
          <div className="condition-values">
            <div><small>CURRENT</small><MetricValue metric={evaluation.metric} value={evaluation.current} /></div>
            <div className="condition-target"><small>TARGET</small><span>{evaluation.operator === "GTE" ? "AT LEAST" : "AT MOST"} {formatMetric(evaluation.metric, evaluation.target)}</span></div>
          </div>
          <div className="condition-track"><span style={{ width: evaluation.satisfied ? "100%" : `${Math.max(12, 100 - Number(evaluation.distanceRatio) * 100)}%` }} /></div>
          <small>{providerLabel(frame.observations[evaluation.metric].provider)} · {dateTime(frame.observations[evaluation.metric].sourceTimestamp ?? frame.observations[evaluation.metric].receivedAt)}</small>
        </motion.div>
      ))}
    </div>
  );
}

function CompactSignalEngine({ evaluations, ghost }: { evaluations: Evaluation[]; ghost?: GhostRecord }) {
  const ready = evaluations.filter((evaluation) => evaluation.satisfied).length;
  const complete = ready === evaluations.length;
  const action = ghost
    ? `${ghost.side} ${ghost.amountType === "USDC" ? `${quantity.format(Number(ghost.amount))} USDC` : `${quantity.format(Number(ghost.amount))}% SOL`}`
    : "SELL 25% SOL";
  return <section className={`compact-signal-engine ${complete ? "ready" : ""}`} aria-label="Compact Signal Engine state">
    <header><span>SIGNAL ENGINE</span><b>{ready} OF {evaluations.length} SIGNAL{evaluations.length === 1 ? "" : "S"} READY</b></header>
    <div className="compact-engine-flow">
      <div className="compact-engine-signals">{evaluations.map((evaluation, index) => <div className={evaluation.satisfied ? "ready" : ""} key={evaluation.metric}><i>{evaluation.satisfied ? <Check size={11} weight="bold" /> : index + 1}</i><span><b>{metricLabels[evaluation.metric]}</b><small>{evaluation.satisfied ? "RULE IS TRUE" : "STILL WATCHING"}</small></span></div>)}</div>
      <div className="compact-engine-core"><motion.i animate={complete ? { scale: [1, 1.14, 1] } : { scale: 1 }} transition={{ duration: .4 }} /><small>ALL ACTIVE<br />RULES</small></div>
      <ArrowRight size={18} />
      <div className="compact-engine-action"><span>{complete ? "READY TO EXECUTE" : "ACTION IF READY"}</span><b>{action}</b><small>{ghost ? "FIRES ONCE" : "PREVIEW ONLY"}</small></div>
    </div>
  </section>;
}

function GhostLifecycle({ ghost }: { ghost?: GhostRecord }) {
  const steps = ["DRAFT", "ARMED", "WATCHING", "TRIGGERED", "EXECUTING", "FILLED"];
  const status = ghost?.status ?? "DRAFT";
  const mapped = status === "PAUSED" ? "WATCHING" : status;
  const activeIndex = Math.max(0, steps.indexOf(mapped));
  return <div className="ghost-lifecycle" aria-label={`Trigger lifecycle: ${status}`}>
    {steps.map((step, index) => <div key={step} className={`${index <= activeIndex ? "reached" : ""} ${step === mapped ? "current" : ""}`}><i>{index < activeIndex ? <Check size={9} weight="bold" /> : index + 1}</i><span>{step}</span></div>)}
  </div>;
}

function Composer({ workspace, capabilities, onCreated }: { workspace: Workspace; capabilities: RuntimeCapabilities; onCreated: (ghost: GhostRecord) => void }) {
  const queryClient = useQueryClient();
  const [state, dispatch] = useReducer(composerReducer, initialComposer);
  const [draft, setDraft] = useState<GhostRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [replay, setReplay] = useState<ReplayResult | null>(null);
  const [replayPeriod, setReplayPeriod] = useState<"24H" | "7D" | "30D">("7D");
  const [loadedStrategy, setLoadedStrategy] = useState<Strategy | null>(null);
  const [composerMode, setComposerMode] = useState<"QUICK" | "AI">("QUICK");
  const [aiApplied, setAiApplied] = useState(false);
  const [compiler, setCompiler] = useState<CompilerPreview | null>(null);
  const strategies = useQuery({ queryKey: ["strategies"], queryFn: () => api<StrategyCatalog>("/api/strategies") });

  useEffect(() => {
    if (!strategies.data || loadedStrategy) return;
    const strategyId = new URLSearchParams(window.location.search).get("strategy");
    const strategy = strategies.data.strategies.find((item) => item.id === strategyId);
    if (strategy) {
      dispatch({ type: "load", draft: strategy.draft });
      setLoadedStrategy(strategy);
    }
  }, [loadedStrategy, strategies.data]);

  const create = useMutation({
    mutationFn: () => api<GhostRecord>("/api/ghosts", { method: "POST", body: JSON.stringify(state) }),
    onSuccess: (ghost) => {
      setDraft(ghost);
      setError(null);
      onCreated(ghost);
      void queryClient.invalidateQueries({ queryKey: ["workspace"] });
    },
    onError: (caught) => setError(caught instanceof Error ? caught.message : "Trigger could not be created."),
  });
  const arm = useMutation({
    mutationFn: (id: string) => api<GhostRecord>(`/api/ghosts/${id}/arm`, { method: "POST" }),
    onSuccess: (ghost) => {
      setDraft(ghost);
      setError(null);
      onCreated(ghost);
      void queryClient.invalidateQueries({ queryKey: ["workspace"] });
    },
    onError: (caught) => setError(caught instanceof Error ? caught.message : "Trigger could not start watching."),
  });
  const shownDraft = draft ? workspace.ghosts.find((ghost) => ghost.id === draft.id) ?? draft : null;
  const runReplay = useMutation({
    mutationFn: (period: "24H" | "7D" | "30D") => api<ReplayResult>("/api/replay", { method: "POST", body: JSON.stringify({ period, draft: state }) }),
    onSuccess: (result) => { setReplay(result); setError(null); },
    onError: (caught) => setError(caught instanceof Error ? caught.message : "Replay could not run."),
  });
  const previewCompiler = useMutation({
    mutationFn: () => api<CompilerPreview>("/api/compiler/preview", { method: "POST", body: JSON.stringify(state) }),
    onSuccess: (result) => { setCompiler(result); setError(null); },
    onError: (caught) => setError(caught instanceof Error ? caught.message : "The execution contract could not be compiled."),
  });

  const current = workspace.frame.observations;
  const previewEvaluations = state.conditions.map((condition) => evaluateCondition(condition, current[condition.metric].value));
  const conditionSummary = state.conditions.map((condition) => {
    const relation = condition.operator === "GTE" ? "at least" : "at most";
    if (condition.metric === "PRICE") return `SOL price is ${relation} $${condition.target}`;
    if (condition.metric === "FUNDING") return `funding is ${relation} ${Number(condition.target) * 100}%`;
    return `position P&L is ${relation} ${Number(condition.target) * 100}%`;
  }).join(state.conditions.length === 2 ? " and " : ", ").replace(/, ([^,]*)$/, ", and $1");
  const summary = `${state.side === "SELL" ? `Sell ${state.amount}% of SOL` : `Buy SOL with ${money.format(Number(state.amount))} USDC`} when ${conditionSummary}.`;
  const price = Number(current.PRICE.value);
  const commitmentAmount = state.side === "BUY" ? Number(state.amount) : Number(workspace.portfolio.balances.SOL.quantity) * Number(state.amount) / 100;
  const commitmentValue = state.side === "BUY" ? commitmentAmount : commitmentAmount * price;
  const commitmentAsset = state.side === "BUY" ? "USDC" : "SOL";
  const canCommit = commitmentAmount > 0 && commitmentAmount <= Number(state.side === "BUY" ? workspace.portfolio.balances.USDC.available : workspace.portfolio.balances.SOL.available);
  const actionConsequence = state.side === "BUY" ? `Buy SOL with ${money.format(Number(state.amount))} USDC` : `Sell ${state.amount}% of the SOL position`;

  return (
    <aside className="composer-panel">
      <div className="panel-heading">
        <div><span className="eyebrow">{composerMode === "AI" ? "DESCRIBE IT" : "BUILD A TRIGGER"}</span><h2>{composerMode === "AI" ? "Describe your trigger" : "Choose the moment"}</h2><p className="composer-intro">Use one signal or combine several. The trigger acts when every active condition is true.</p></div>
        {composerMode === "AI" ? <Sparkle size={20} /> : <SlidersHorizontal size={20} />}
      </div>
      <div className={`composer-modes ${!capabilities.features.aiComposer ? "single" : ""}`} role="tablist" aria-label="Composer mode"><button role="tab" aria-label="Build manually" aria-selected={composerMode === "QUICK"} className={composerMode === "QUICK" ? "active" : ""} onClick={() => setComposerMode("QUICK")}>BUILD</button>{capabilities.features.aiComposer && <button role="tab" aria-label="AI" aria-selected={composerMode === "AI"} className={composerMode === "AI" ? "active" : ""} onClick={() => setComposerMode("AI")}>DESCRIBE</button>}</div>
      {composerMode === "AI" ? <AiComposer baseDraft={state} onApply={(result) => { dispatch({ type: "load", draft: result.draft }); setLoadedStrategy(null); setAiApplied(true); setDraft(null); setComposerMode("QUICK"); window.history.replaceState({}, "", "/trade"); }} /> : <>
      {loadedStrategy && <div className="strategy-loaded"><CheckCircle size={16} weight="fill" /><div><span>STRATEGY LOADED</span><b>{loadedStrategy.name}</b></div><button title="Clear strategy" onClick={() => { dispatch({ type: "reset" }); setLoadedStrategy(null); window.history.replaceState({}, "", "/trade"); }}><X size={14} /></button></div>}
      {aiApplied && <div className="strategy-loaded"><Sparkle size={16} weight="fill" /><div><span>AI DRAFT APPLIED</span><b>Review every field before creating</b></div><button title="Dismiss AI notice" onClick={() => setAiApplied(false)}><X size={14} /></button></div>}

      <div className="side-switch" role="group" aria-label="Order side">
        <button aria-pressed={state.side === "BUY"} className={state.side === "BUY" ? "active" : ""} onClick={() => dispatch({ type: "side", side: "BUY" })}>BUY</button>
        <button aria-pressed={state.side === "SELL"} className={state.side === "SELL" ? "active sell" : ""} onClick={() => dispatch({ type: "side", side: "SELL" })}>SELL</button>
      </div>

      <label className="field-label">Trigger name<input value={state.name} onChange={(event) => dispatch({ type: "field", field: "name", value: event.target.value })} /></label>

      <div className="amount-field">
        <label className="field-label">{state.side === "BUY" ? "USDC to spend" : "SOL position to sell"}
          <div className="input-with-unit"><input type="number" min="0" value={state.amount} onChange={(event) => dispatch({ type: "field", field: "amount", value: event.target.value })} /><span>{state.side === "BUY" ? "USDC" : "%"}</span></div>
        </label>
        <div className="available-note">Available: {state.side === "BUY" ? `${quantity.format(Number(workspace.portfolio.balances.USDC.available))} USDC` : `${quantity.format(Number(workspace.portfolio.balances.SOL.available))} SOL`}</div>
      </div>

      <div className="condition-builder-heading"><span>ACTIVE CONDITIONS</span><span>{previewEvaluations.filter((item) => item.satisfied).length} of {state.conditions.length} true now</span></div>
      <div className="condition-builder">
        {conditionOrder.map((metric) => {
          const active = state.conditions.some((condition) => condition.metric === metric);
          const condition = state.conditions.find((item) => item.metric === metric) ?? conditionDefaults[metric];
          const onlyActive = active && state.conditions.length === 1;
          return <div className={`builder-row ${active ? "active" : "inactive"}`} key={metric}>
            <label className="builder-toggle" title={onlyActive ? "At least one condition is required" : active ? `Remove ${metricLabels[metric]}` : `Add ${metricLabels[metric]}`}><input type="checkbox" aria-label={`Use ${metricLabels[metric]} condition`} checked={active} disabled={onlyActive} onChange={() => dispatch({ type: "toggle-condition", metric })} /><span><Check size={10} weight="bold" /></span></label>
            <div className="builder-metric"><span>{metricLabels[metric]}</span><small>CURRENT {formatMetric(metric, current[metric].value)}</small></div>
            <label className="builder-operator"><span>RULE</span><select aria-label={`${metric} operator`} disabled={!active} value={condition.operator} onChange={(event) => dispatch({ type: "condition", metric, field: "operator", value: event.target.value })}>
              <option value="GTE">at least</option><option value="LTE">at most</option>
            </select></label>
            <label className="builder-target-field"><span>TARGET</span><div className="builder-target"><input aria-label={`${metric} target`} disabled={!active} value={metric === "PRICE" ? condition.target : String(Number(condition.target) * 100)} onChange={(event) => dispatch({ type: "condition", metric, field: "target", value: metric === "PRICE" ? event.target.value : String(Number(event.target.value) / 100) })} /><span>{metric === "PRICE" ? "$" : "%"}</span></div></label>
          </div>;
        })}
      </div>

      <div className="constraint-row">
        <label>Max slippage<div className="compact-input"><input type="number" min="1" max="500" value={state.maxSlippageBps} onChange={(event) => dispatch({ type: "field", field: "maxSlippageBps", value: Number(event.target.value) })} /><span>bps</span></div></label>
        <label>Expires<select value={state.expiresInHours} onChange={(event) => dispatch({ type: "field", field: "expiresInHours", value: Number(event.target.value) })}><option value={1}>1 hour</option><option value={24}>24 hours</option><option value={168}>7 days</option><option value={720}>30 days</option></select></label>
      </div>

      <div className="intent-summary"><ShieldCheck size={18} /><p>{summary}</p></div>
      <section className={`commitment-summary ${canCommit ? "" : "invalid"}`} aria-label="Capital commitment preview">
        <div><LockSimple size={18} weight="duotone" /><span>RESERVED WHEN ACTIVE</span><b>{quantity.format(commitmentAmount)} {commitmentAsset}</b></div>
        <dl><div><dt>EST. VALUE</dt><dd>${money.format(commitmentValue)}</dd></div><div><dt>REMAINS AVAILABLE</dt><dd>${money.format(Math.max(0, Number(state.side === "BUY" ? workspace.portfolio.balances.USDC.available : workspace.portfolio.balances.SOL.available) * (state.side === "BUY" ? 1 : price) - commitmentValue))}</dd></div></dl>
        <p>{canCommit ? "Reserved only after arming. Released on cancel or expiry." : "Commitment exceeds currently available virtual funds."}</p>
      </section>
      <section className="action-consequence" aria-label="What happens when this trigger starts">
        <header><Lightning size={17} weight="duotone" /><span>WHAT HAPPENS WHEN YOU START</span></header>
        <ol><li><i>1</i><span><b>Reserve virtual capital</b><small>{quantity.format(commitmentAmount)} {commitmentAsset} is set aside before monitoring.</small></span></li><li><i>2</i><span><b>Wait for every active rule</b><small>{state.conditions.length === 1 ? "One selected signal must qualify." : `All ${state.conditions.length} selected signals must qualify in one frame.`}</small></span></li><li><i>3</i><span><b>{actionConsequence} once</b><small>A receipt is stored. Cancel or expiry releases unused capital.</small></span></li></ol>
      </section>
      <button className="compiler-action" onClick={() => previewCompiler.mutate()} disabled={previewCompiler.isPending}><BracketsCurly size={17} />{previewCompiler.isPending ? "CHECKING..." : "VIEW TECHNICAL CONTRACT"}<span>Advanced · Simulation ready</span></button>
      {error && <div className="inline-error safety-error" role="alert"><Warning size={17} /><div><b>{error}</b><small>No capital moved. Your editable Composer values remain in place.</small></div></div>}

      {shownDraft?.status === "DRAFT" ? (
        <button className="primary-action" onClick={() => arm.mutate(shownDraft.id)} disabled={arm.isPending || workspace.portfolio.dataMode !== "DEMO" || !canCommit}>
          {workspace.portfolio.dataMode !== "DEMO" ? "LIVE DATA CANNOT EXECUTE" : arm.isPending ? "STARTING..." : "START WATCHING"}<Lightning size={18} weight="fill" />
        </button>
      ) : (
        <button className="primary-action" onClick={() => create.mutate()} disabled={create.isPending}>
          {create.isPending ? "SAVING..." : "SAVE TRIGGER"}<ArrowRight size={18} />
        </button>
      )}
      {shownDraft && <a className="draft-link" href={`/ghost/${shownDraft.id}`}><StatusBadge status={shownDraft.status} /><span>{shownDraft.name}</span><CaretRight size={15} /></a>}
      {capabilities.features.replay && <button className="replay-action" onClick={() => runReplay.mutate(replayPeriod)} disabled={runReplay.isPending}><ClockCounterClockwise size={17} />{runReplay.isPending ? "REPLAYING..." : "TRY PAST MARKET DATA"}</button>}
      <AnimatePresence>{replay && <motion.div className="modal-backdrop replay-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setReplay(null)}><motion.div className="replay-modal" role="dialog" aria-modal="true" aria-label={`${state.name} historical Replay`} initial={{ y: 24, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 24, opacity: 0 }} onClick={(event) => event.stopPropagation()}><ReplayPanel result={replay} period={replayPeriod} onPeriod={(period) => { setReplayPeriod(period); runReplay.mutate(period); }} close={() => setReplay(null)} loading={runReplay.isPending} /></motion.div></motion.div>}</AnimatePresence>
      <AnimatePresence>{compiler && <motion.div className="modal-backdrop replay-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setCompiler(null)}><motion.div className="replay-modal compiler-modal" role="dialog" aria-modal="true" aria-labelledby="compiler-title" initial={{ y: 24, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 24, opacity: 0 }} onClick={(event) => event.stopPropagation()}><CompilerPanel preview={compiler} close={() => setCompiler(null)} /></motion.div></motion.div>}</AnimatePresence>
      </>}
    </aside>
  );
}

function CompilerPanel({ preview, close }: { preview: CompilerPreview; close: () => void }) {
  const sandbox = preview.compilations.find((item) => item.target === "SANDBOX")!;
  const rialo = preview.compilations.find((item) => item.target === "RIALO")!;
  return <section className="compiler-panel">
    <header className="replay-header"><div><span className="eyebrow">TRIGGER CONTRACT · IR V{preview.ir.version}</span><h2 id="compiler-title">Execution contract</h2><p>One intent, checked independently against each execution target.</p></div><button className="icon-button" title="Close compiler" onClick={close}><X size={18} /></button></header>
    <div className="compiler-targets"><div className="ready"><span>SIMULATION</span><b>{sandbox.status}</b><small>Ledger-backed execution venue</small></div><div><span>RIALO</span><b>{rialo.status.replaceAll("_", " ")}</b><small>No network or toolchain configured</small></div></div>
    <div className="compiler-grid">
      <section><span className="eyebrow">SEMANTICS</span><dl><div><dt>Evaluation</dt><dd>{preview.ir.semantics.evaluationMode.replace("_", " ")}</dd></div><div><dt>Lifecycle</dt><dd>{preview.ir.semantics.oneShot ? "ONE SHOT" : "RECURRING"}</dd></div><div><dt>Frame skew</dt><dd>{preview.ir.semantics.maxCrossMetricSkewMs / 1000}s max</dd></div><div><dt>Expires</dt><dd>{dateTime(preview.ir.constraints.expiresAt)}</dd></div></dl></section>
      <section><span className="eyebrow">ACTION</span><div className="compiler-action-flow"><b>{preview.ir.action.assetIn}</b><ArrowRight size={16} /><b>{preview.ir.action.assetOut}</b></div><p>{preview.ir.action.type} · {preview.ir.action.amount.value} {preview.ir.action.amount.type.replace("_", " ")} · {preview.ir.constraints.maxSlippageBps} bps max slippage</p></section>
    </div>
    <section className="compiler-requirements"><span className="eyebrow">DATA CONTRACT</span>{preview.ir.dataRequirements.map((item) => <div key={item.metric}><b>{item.metric}</b><span>{item.unit}</span><span>≤ {item.maxAgeMs / 1000}s old</span><span>{item.allowedProvenance.join(", ")}</span></div>)}</section>
    <details className="compiler-blockers"><summary>Why Rialo cannot compile yet · {rialo.unsupported.length} blockers</summary>{rialo.unsupported.map((item, index) => <div key={`${item.code}-${item.field}-${index}`}><code>{item.code}</code><p>{item.message}</p></div>)}</details>
    <div className="compiler-notice"><Warning size={17} /><p>{preview.notice}</p></div>
  </section>;
}

function AiComposer({ baseDraft, onApply }: { baseDraft: GhostDraft; onApply: (result: AiComposeResponse) => void }) {
  const [prompt, setPrompt] = useState("Sell half my SOL when it reaches $300, but only if funding exceeds 0.05% and my profit is at least 40%. Maximum 0.5% slippage for 7 days.");
  const [result, setResult] = useState<AiComposeResponse | null>(null);
  const compose = useMutation({
    mutationFn: () => api<AiComposeResponse>("/api/ai/compose", { method: "POST", body: JSON.stringify({ prompt, baseDraft }) }),
    onSuccess: setResult,
  });
  return <div className="ai-composer">
    <label className="field-label" htmlFor="ghost-prompt">Describe your trigger</label>
    <textarea id="ghost-prompt" value={prompt} onChange={(event) => { setPrompt(event.target.value); setResult(null); }} maxLength={600} />
    <div className="ai-prompt-foot"><span>{prompt.length}/600</span><small>Supports SOL price, funding, position P&amp;L, amount, slippage, and expiry.</small></div>
    {compose.error && <div className="inline-error safety-error" role="alert"><Warning size={17} /><div><b>{compose.error instanceof Error ? compose.error.message : "Triggerlane could not interpret that request."}</b><small>No draft was changed. Edit the request and generate again.</small></div></div>}
    {!result && <button className="primary-action" onClick={() => compose.mutate()} disabled={compose.isPending || prompt.trim().length < 12}>{compose.isPending ? "GENERATING..." : "GENERATE TRIGGER"}<Sparkle size={17} weight="fill" /></button>}
    {result && <div className="ai-review">
      <div className="ai-review-head"><span className="eyebrow">STRUCTURED PROPOSAL</span><b>{result.draft.name}</b><small>{result.draft.side} · {result.draft.side === "SELL" ? `${result.draft.amount}% POSITION` : `${result.draft.amount} USDC`}</small></div>
      <div className="ai-interpretation">{result.interpretation.map((item) => <div key={item}><Check size={13} />{item}</div>)}</div>
      {result.unsupported.length > 0 && <div className="ai-warning"><Warning size={16} /><div><b>Not available yet</b><p>{result.unsupported.join(", ")} were omitted. Supported conditions remain editable.</p></div></div>}
      {result.retained.length > 0 && <details><summary>Retained Composer values ({result.retained.length})</summary>{result.retained.map((item) => <p key={item}>{item}</p>)}</details>}
      <div className="ai-insights"><span className="eyebrow">TRIGGER REVIEW</span>{result.insights.map((insight) => <article key={insight.title}><b>{insight.title}</b><p>{insight.message}</p><span>{insight.action}</span></article>)}</div>
      <p className="ai-disclaimer">{result.disclaimer}</p>
      <button className="primary-action" onClick={() => onApply(result)}>APPLY TO COMPOSER<ArrowRight size={17} /></button>
      <button className="replay-action" onClick={() => setResult(null)}>EDIT REQUEST</button>
    </div>}
  </div>;
}

function ReplayPanel({ result, period, onPeriod, close, loading }: { result: ReplayResult; period: "24H" | "7D" | "30D"; onPeriod: (period: "24H" | "7D" | "30D") => void; close: () => void; loading: boolean }) {
  const [index, setIndex] = useState(result.points.length - 1);
  useEffect(() => setIndex(result.points.length - 1), [result]);
  const point = result.points[index] ?? result.points[0]!;
  const triggerIndexes = result.points.map((item, pointIndex) => item.triggered ? pointIndex : -1).filter((item) => item >= 0);
  return <div className="replay-panel">
    <div className="replay-header"><div><span className="eyebrow">HISTORICAL SIMULATION</span><h2>Replay trigger</h2><p>{providerLabel(result.provider.name)} · complete price, funding, and portfolio P&amp;L frames</p></div><button className="icon-button" title="Close Replay" onClick={close}><X size={18} /></button></div>
    <div className="replay-periods" role="group" aria-label="Replay period">{(["24H", "7D", "30D"] as const).map((value) => <button aria-pressed={period === value} className={period === value ? "active" : ""} key={value} onClick={() => onPeriod(value)} disabled={loading}>{value}</button>)}</div>
    <div className="replay-summary"><div><span>WOULD TRIGGER</span><b>{result.summary.triggerCount}</b><small>crossings</small></div><div><span>FIRST TRIGGER</span><b>{result.summary.firstTriggerAt ? dateTime(result.summary.firstTriggerAt) : "Never"}</b></div><div><span>MEDIAN WATCH</span><b>{result.summary.medianWatchingHours}h</b></div><div><span>SIMULATED OUTCOME</span><b className={Number(result.summary.simulatedOutcomePercent) >= 0 ? "positive" : "negative"}>{Number(result.summary.simulatedOutcomePercent) >= 0 ? "+" : ""}{result.summary.simulatedOutcomePercent}%</b></div></div>
    <div className="replay-stage">
      <div className="replay-stage-head"><div><span className="eyebrow">FRAME {index + 1} / {result.points.length}</span><h3>{dateTime(point.at)}</h3></div><div className={point.triggered ? "replay-trigger active" : "replay-trigger"}>{point.triggered ? <><Lightning size={15} weight="fill" /> TRIGGER</> : `${point.readyCount}/${point.evaluations.length} READY`}</div></div>
      <div className="replay-values"><div><span>SOL PRICE</span><b>{formatMetric("PRICE", point.values.PRICE)}</b></div><div><span>FUNDING</span><b>{formatMetric("FUNDING", point.values.FUNDING)}</b></div><div><span>POSITION P&amp;L</span><b>{formatMetric("PNL", point.values.PNL)}</b></div></div>
      <div className="replay-track"><input aria-label="Replay timeline" type="range" min="0" max={result.points.length - 1} value={index} onChange={(event) => setIndex(Number(event.target.value))} /><div className="replay-markers">{triggerIndexes.map((triggerIndex) => <button aria-label={`Inspect trigger ${triggerIndexes.indexOf(triggerIndex) + 1}`} title={dateTime(result.points[triggerIndex]!.at)} style={{ left: `${(triggerIndex / Math.max(1, result.points.length - 1)) * 100}%` }} key={triggerIndex} onClick={() => setIndex(triggerIndex)}><Lightning size={10} weight="fill" /></button>)}</div></div>
      <div className="replay-evaluations">{point.evaluations.map((evaluation) => <div className={evaluation.satisfied ? "ready" : ""} key={evaluation.metric}>{evaluation.satisfied ? <CheckCircle size={15} weight="fill" /> : <span /> }<b>{evaluation.metric}</b><small>{formatMetric(evaluation.metric, evaluation.current)} {evaluation.operator === "GTE" ? ">=" : "<="} {formatMetric(evaluation.metric, evaluation.target)}</small></div>)}</div>
    </div>
    <div className="replay-foot"><span>{result.summary.completeFrameCount}/{result.summary.frameCount} COMPLETE FRAMES · DEMO PROVENANCE</span><p>{result.disclaimer}</p></div>
  </div>;
}

function strategyPattern(strategy: Strategy) {
  if (strategy.category === "Accumulation") return { key: "accumulation", name: "Stress alignment", explanation: "Price weakness matters more when funding cools and your position confirms a real drawdown.", paths: ["M160 62 C300 62 320 165 475 165", "M160 165 H475", "M160 268 C300 268 320 165 475 165"] };
  if (strategy.category === "Profit Taking") return { key: "profit", name: "Heat alignment", explanation: "A high price becomes more meaningful when market optimism and your position profit rise with it.", paths: ["M160 62 C270 62 335 110 475 165", "M160 165 C300 165 360 142 475 165", "M160 268 C285 268 355 210 475 165"] };
  return { key: "protection", name: "Risk alignment", explanation: "The action waits for independent signs of weakness so one noisy move cannot decide alone.", paths: ["M160 62 L285 62 L390 165 H475", "M160 165 H475", "M160 268 L285 268 L390 165 H475"] };
}

function StrategyLattice({ strategy }: { strategy: Strategy }) {
  const pattern = strategyPattern(strategy);
  return <div className={`strategy-lattice strategy-pattern-${pattern.key}`} role="img" aria-label={`${strategy.name}, ${pattern.name}: ${strategy.draft.conditions.length} conditions converge on one ${strategy.draft.side.toLowerCase()} action`}>
    <div className="strategy-pattern-label"><span>VISUAL PATTERN</span><b>{pattern.name}</b><small>{pattern.explanation}</small></div>
    <svg className="strategy-lattice-desktop" viewBox="0 0 680 330" preserveAspectRatio="xMidYMid meet" aria-hidden="true"><g className="lattice-paths">{pattern.paths.map((path) => <path d={path} key={path} />)}<path className="action-path" d="M475 165 H606" /></g>{strategy.draft.conditions.map((condition, index) => { const y = [62, 165, 268][index]!; return <g className="lattice-condition" transform={`translate(22 ${y - 31})`} key={condition.metric}><rect width="138" height="62" /><text x="13" y="22">{condition.metric === "PNL" ? "POSITION P&L" : condition.metric}</text><text className="lattice-value" x="13" y="45">{condition.operator === "GTE" ? "AT LEAST" : "AT MOST"} {formatMetric(condition.metric, condition.target)}</text></g>; })}<g className="lattice-core"><circle cx="475" cy="165" r="34" /><circle cx="475" cy="165" r="8" /><text x="475" y="220">ALL TRUE</text></g><g className={`lattice-action action-${strategy.draft.side.toLowerCase()}`} transform="translate(606 133)"><rect width="60" height="64" /><text x="30" y="27">{strategy.draft.side}</text><text x="30" y="45">SOL</text></g></svg>
    <div className="strategy-lattice-mobile" aria-hidden="true">
      <div className="mobile-lattice-heading"><span>{pattern.name.toUpperCase()}</span><b>{strategy.draft.conditions.length} SIGNALS WATCHING</b></div>
      <div className="mobile-lattice-signals">{strategy.draft.conditions.map((condition, index) => <div className="mobile-lattice-signal" key={condition.metric}><i>{String(index + 1).padStart(2, "0")}</i><div><span>{condition.metric === "PNL" ? "POSITION P&L" : condition.metric}</span><b>{condition.operator === "GTE" ? "AT LEAST" : "AT MOST"} {formatMetric(condition.metric, condition.target)}</b></div><em /></div>)}</div>
      <div className="mobile-lattice-core"><span>ALL {strategy.draft.conditions.length} SIGNALS</span><b>TRUE TOGETHER</b></div>
      <div className={`mobile-lattice-action action-${strategy.draft.side.toLowerCase()}`}><small>THEN, ONCE</small><strong>{strategy.draft.side} SOL</strong></div>
    </div>
    <div className="lattice-caption"><span>ONE COMPLETE FRAME</span><b>{strategy.draft.conditions.length} CONDITIONS → 1 ACTION</b></div>
  </div>;
}

function DiscoverBeginnerGuide() {
  return <section className="discover-beginner" aria-labelledby="multi-signal-guide-title"><div className="beginner-question"><Question size={24} /><div><span>NEW TO CONDITIONAL TRIGGERS?</span><h2 id="multi-signal-guide-title">Why watch several signals?</h2></div></div><p>A price can look attractive for many reasons. Adding funding and position P&amp;L lets you describe the fuller market moment you actually care about.</p><ol><li><i>1</i><div><b>Observe independently</b><span>Each signal keeps its own target.</span></div></li><li><i>2</i><div><b>Agree in one frame</b><span>Every chosen signal must be true together.</span></div></li><li><i>3</i><div><b>Act only once</b><span>The reviewed action runs a single time.</span></div></li></ol></section>;
}

function DiscoverReplay({ result, strategy, onContinue, loading }: { result: ReplayResult; strategy: Strategy; onContinue: () => void; loading: boolean }) {
  const prices = result.points.map((point) => Number(point.values.PRICE));
  const minimum = Math.min(...prices);
  const range = Math.max(1, Math.max(...prices) - minimum);
  return <section className="discover-replay-result" aria-label="24 hour deterministic Replay result"><header><div><span className="eyebrow">WHAT DEMO HISTORY SHOWED</span><h3>{result.summary.triggerCount ? `${result.summary.triggerCount} qualifying crossing${result.summary.triggerCount === 1 ? "" : "s"}` : "No qualifying crossing"}</h3><p>This explains how the signals behaved. It does not predict what happens next.</p></div><span>DEMO HISTORY · NOT A FORECAST</span></header><div className="discover-replay-stats"><div><span>FRAMES CHECKED</span><b>{result.summary.completeFrameCount}</b></div><div><span>FIRST CROSSING</span><b>{result.summary.firstTriggerAt ? dateTime(result.summary.firstTriggerAt) : "Never"}</b></div><div><span>MEDIAN WATCH</span><b>{result.summary.medianWatchingHours}h</b></div></div><div className="discover-replay-track" aria-label={`${result.points.length} historical frames`}>{result.points.map((point, index) => <i className={point.triggered ? "triggered" : ""} style={{ height: `${24 + (Number(point.values.PRICE) - minimum) / range * 68}%` }} title={`${dateTime(point.at)} · ${point.readyCount}/${point.evaluations.length} ready`} key={point.frameId}><span>{point.triggered ? <Lightning size={9} weight="fill" /> : index + 1}</span></i>)}</div><div className="replay-next-step"><div><ShieldCheck size={18} /><span><b>Your Simulation did not change</b><small>{result.disclaimer} No trigger was created and no capital was reserved.</small></span></div><button onClick={onContinue} disabled={loading}>{loading ? "OPENING COMPOSER..." : `REVIEW ${strategy.name.toUpperCase()} IN COMPOSER`}<ArrowRight size={15} /></button></div></section>;
}

function DiscoverView({ workspace }: { workspace: Workspace }) {
  const catalog = useQuery({ queryKey: ["strategies"], queryFn: () => api<StrategyCatalog>("/api/strategies") });
  const [category, setCategory] = useState<StrategyCatalog["categories"][number]>("Popular");
  const [metric, setMetric] = useState<"ALL" | Metric>("ALL");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [replayResult, setReplayResult] = useState<{ strategyId: string; result: ReplayResult } | null>(null);
  const useStrategy = useMutation({ mutationFn: (id: string) => api<Strategy>(`/api/strategies/${id}/use`, { method: "POST" }), onSuccess: (strategy) => { window.location.href = `/trade?strategy=${strategy.id}`; } });
  const replay = useMutation({ mutationFn: (strategy: Strategy) => api<ReplayResult>("/api/replay", { method: "POST", body: JSON.stringify({ period: "24H", draft: strategy.draft }) }), onSuccess: (result, strategy) => setReplayResult({ strategyId: strategy.id, result }) });
  if (!catalog.data) return <LoadingView />;
  const categoryStrategies = catalog.data.strategies.filter((strategy) => category === "Popular" ? strategy.featured : category === "Advanced" ? false : strategy.category === category);
  const visible = categoryStrategies.filter((strategy) => metric === "ALL" || strategy.metrics.includes(metric));
  const selected = visible.find((strategy) => strategy.id === selectedId) ?? visible[0] ?? null;
  const chooseCategory = (next: StrategyCatalog["categories"][number]) => { setCategory(next); setMetric("ALL"); setSelectedId(null); setReplayResult(null); };
  const chooseStrategy = (strategy: Strategy) => { setSelectedId(strategy.id); setReplayResult(null); document.getElementById("strategy-preview")?.scrollIntoView({ behavior: "smooth", block: "start" }); };
  const price = Number(workspace.frame.observations.PRICE.value);
  const commitmentAmount = selected ? selected.draft.side === "BUY" ? Number(selected.draft.amount) : Number(workspace.portfolio.balances.SOL.quantity) * Number(selected.draft.amount) / 100 : 0;
  const commitmentAsset = selected?.draft.side === "BUY" ? "USDC" : "SOL";
  const commitmentValue = selected?.draft.side === "BUY" ? commitmentAmount : commitmentAmount * price;
  return <main className="page-view discover-editorial">
    <div className="page-title discover-title"><div><span className="eyebrow">CURATED TRIGGER STRATEGIES</span><h1>Start with a moment worth watching</h1><p>Explore a small set of tested ideas, understand every condition, then load one into Composer for your own review.</p></div><div className="discover-market"><span>SUPPORTED SIMULATION</span><b>SOL / USDC</b><small>PRICE · FUNDING · POSITION P&amp;L</small></div></div>
    <DiscoverBeginnerGuide />
    <nav className="discover-navigation" aria-label="Strategy catalog navigation"><div className="strategy-tabs" role="tablist" aria-label="Strategy categories">{catalog.data.categories.map((item) => <button role="tab" aria-selected={category === item} className={category === item ? "active" : ""} key={item} onClick={() => chooseCategory(item)}>{item}</button>)}</div><div className="metric-filters" role="group" aria-label="Supported metric filter"><span>FILTER BY SIGNAL</span>{(["ALL", ...catalog.data.capabilities.metrics] as const).map((item) => <button aria-pressed={metric === item} className={metric === item ? "active" : ""} key={item} onClick={() => { setMetric(item); setSelectedId(null); setReplayResult(null); }}>{item === "ALL" ? "All three" : item === "PNL" ? "Position P&L" : item}</button>)}</div></nav>
    {category === "Advanced" ? <section className="strategy-unavailable advanced-boundary"><SlidersHorizontal size={35} /><span className="eyebrow">OUTSIDE THE CURRENT CATALOG</span><h2>Advanced signals need qualified data first</h2><p>Liquidity, TVL, and volume are not available to the execution engine, so strategies that depend on them stay outside the selectable catalog.</p><div>{catalog.data.capabilities.unsupportedAdvancedMetrics.map((item) => <span key={item}>{item} · UNSUPPORTED</span>)}</div><button onClick={() => chooseCategory("Popular")}>RETURN TO CURATED STRATEGIES</button></section> : selected ? <>
      <section id="strategy-preview" className="strategy-feature" aria-labelledby="strategy-preview-title"><div className="strategy-feature-copy"><div className="feature-index"><span>{String(catalog.data.strategies.indexOf(selected) + 1).padStart(2, "0")}</span><b>{selected.category.toUpperCase()}</b></div><span className="eyebrow">{selected.thesis}</span><h2 id="strategy-preview-title">{selected.name}</h2><p>{selected.description}</p><div className="strategy-nonpromise"><ShieldCheck size={17} /><span>This is a configurable monitoring idea, not a recommendation or promise of an outcome.</span></div><dl><div><dt>ACTION</dt><dd>{selected.draft.side} SOL</dd></div><div><dt>CAPITAL IF ARMED</dt><dd>{quantity.format(commitmentAmount)} {commitmentAsset}<small>${money.format(commitmentValue)} at the current frame</small></dd></div><div><dt>EXPIRES</dt><dd>{selected.draft.expiresInHours < 24 ? `${selected.draft.expiresInHours} hour` : `${selected.draft.expiresInHours / 24} days`}</dd></div><div><dt>MAX SLIPPAGE</dt><dd>{selected.draft.maxSlippageBps} bps</dd></div></dl><div className="feature-actions"><div><span>1 · EXPLORE SAFELY</span><button className="preview-replay" onClick={() => replay.mutate(selected)} disabled={replay.isPending}>{replay.isPending ? "CHECKING 24H..." : "REPLAY LAST 24H"}<Play size={15} weight="fill" /></button><small>Uses demo history. Changes nothing.</small></div><div><span>2 · MAKE IT YOURS</span><button className="load-strategy" onClick={() => useStrategy.mutate(selected.id)} disabled={useStrategy.isPending}>{useStrategy.isPending ? "LOADING..." : "LOAD INTO COMPOSER FOR REVIEW"}<ArrowRight size={15} /></button><small>Opens an editable, unsaved draft.</small></div></div><small className="review-boundary">Only you can save or start the trigger after reviewing it in Composer.</small></div><div className="strategy-feature-visual"><StrategyLattice strategy={selected} /><div className="condition-manifest"><span>ALL MUST BE TRUE IN ONE FRAME</span>{selected.draft.conditions.map((condition, index) => <div key={condition.metric}><i>{index + 1}</i><b>{condition.metric === "PNL" ? "POSITION P&L" : condition.metric}</b><small>{condition.operator === "GTE" ? "AT LEAST" : "AT MOST"} {formatMetric(condition.metric, condition.target)}</small></div>)}</div></div></section>
      {replayResult?.strategyId === selected.id && <DiscoverReplay result={replayResult.result} strategy={selected} onContinue={() => useStrategy.mutate(selected.id)} loading={useStrategy.isPending} />}
      <section className="curated-index" aria-labelledby="curated-index-title"><header><div><span className="eyebrow">CURATED INDEX</span><h2 id="curated-index-title">Compare the supported ideas</h2></div><p>{visible.length} {visible.length === 1 ? "strategy uses" : "strategies use"} only schema-valid Price, Funding, and Position P&amp;L conditions.</p></header><div>{visible.map((strategy, index) => <motion.article className={strategy.id === selected.id ? "selected" : ""} key={strategy.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * .04 }}><button className="strategy-index-main" onClick={() => chooseStrategy(strategy)} aria-label={`Preview ${strategy.name}`}><span>{String(catalog.data!.strategies.indexOf(strategy) + 1).padStart(2, "0")}</span><div><small>{strategy.category.toUpperCase()} · {strategy.thesis.toUpperCase()}</small><h3>{strategy.name}</h3><p>{strategy.description}</p></div><div><span>{strategy.draft.side}</span><b>{strategy.draft.side === "BUY" ? `${strategy.draft.amount} USDC` : `${strategy.draft.amount}% SOL`}</b><small>{strategy.draft.expiresInHours / 24}D EXPIRY</small></div><CaretRight size={19} /></button></motion.article>)}</div></section>
    </> : <section className="strategy-unavailable"><Database size={35} /><h2>No strategy uses that supported signal</h2><p>Clear the signal filter to return to the complete curated catalog.</p><button onClick={() => setMetric("ALL")}>SHOW ALL STRATEGIES</button></section>}
  </main>;
}

function PortfolioRail({ workspace, price }: { workspace: Workspace; price: number }) {
  const sol = workspace.portfolio.balances.SOL;
  const usdc = workspace.portfolio.balances.USDC;
  const value = Number(usdc.quantity) + Number(sol.quantity) * price;
  const reservedValue = Number(usdc.reserved) + Number(sol.reserved) * price;
  return (
    <aside className="portfolio-rail">
      <div className="rail-section portfolio-total"><span className="eyebrow">VIRTUAL EQUITY</span><strong>${money.format(value)}</strong><small>SIMULATED USDC VALUE</small></div>
      <div className="rail-section"><div className="rail-label"><span>Available</span><span>${money.format(value - reservedValue)}</span></div><div className="rail-meter"><span style={{ width: `${value ? ((value - reservedValue) / value) * 100 : 0}%` }} /></div></div>
      <div className="rail-section assets">
        <span className="eyebrow">POSITIONS</span>
        <div className="asset-row"><span className="asset-symbol sol-symbol">S</span><div><b>SOL</b><small>{quantity.format(Number(sol.quantity))} SOL</small></div><strong>${money.format(Number(sol.quantity) * price)}</strong></div>
        <div className="asset-row"><span className="asset-symbol usdc-symbol">$</span><div><b>USDC</b><small>{quantity.format(Number(usdc.quantity))} USDC</small></div><strong>${money.format(Number(usdc.quantity))}</strong></div>
      </div>
      <div className="rail-section armed-capital"><span className="eyebrow">ARMED CAPITAL</span><strong>${money.format(reservedValue)}</strong><small>{workspace.ghosts.filter((ghost) => ["WATCHING", "PAUSED"].includes(ghost.status)).length} ACTIVE TRIGGERS</small></div>
      <div className="rail-section rialo-note"><span className="rail-icon"><Pulse size={18} /></span><div><b>Rialo target</b><small>Reactive adapter not configured</small></div></div>
    </aside>
  );
}

function FeedControls({ workspace, step, stepping }: { workspace: Workspace; step: () => void; stepping: boolean }) {
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (!playing || workspace.portfolio.dataMode !== "DEMO") return;
    const timer = window.setInterval(step, 2400);
    return () => window.clearInterval(timer);
  }, [playing, step, workspace.portfolio.dataMode]);
  useEffect(() => { if (workspace.portfolio.dataMode !== "DEMO") setPlaying(false); }, [workspace.portfolio.dataMode]);
  return (
    <div className="feed-controls">
      <div className="feed-sequence"><span>SCENARIO</span>{[0, 1, 2, 3, 4, 5].map((index) => <i key={index} className={index <= workspace.portfolio.demoStep ? "passed" : ""} />)}</div>
      <button className="icon-button" title={playing ? "Pause Demo Feed" : "Play Demo Feed"} onClick={() => setPlaying((value) => !value)} disabled={workspace.portfolio.dataMode !== "DEMO"}>{playing ? <Pause size={17} weight="fill" /> : <Play size={17} weight="fill" />}</button>
      <button className="step-button" onClick={step} disabled={stepping || workspace.portfolio.dataMode !== "DEMO"}>ADVANCE FEED<ArrowRight size={16} /></button>
    </div>
  );
}

function TradeView({ workspace, live, capabilities }: { workspace: Workspace; live?: LiveMarket; capabilities: RuntimeCapabilities }) {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [marketDetailsOpen, setMarketDetailsOpen] = useState(false);
  useEffect(() => {
    if (!composerOpen) return;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setComposerOpen(false);
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [composerOpen]);
  const selected = workspace.ghosts.find((ghost) => ghost.id === selectedId) ?? workspace.ghosts.find((ghost) => ["WATCHING", "PAUSED", "DRAFT"].includes(ghost.status)) ?? workspace.ghosts[0];
  const modeIsLive = workspace.portfolio.dataMode === "LIVE";
  const price = Number(modeIsLive && live ? live.price : workspace.frame.observations.PRICE.value);
  const funding = modeIsLive && live ? live.funding : workspace.frame.observations.FUNDING.value;
  const pnl = workspace.frame.observations.PNL.value;
  const observedAt = modeIsLive ? workspace.frame.assembledAt : workspace.frame.observations.PRICE.sourceTimestamp ?? workspace.frame.observations.PRICE.receivedAt;
  const evaluations = selected?.evaluations?.length ? selected.evaluations : initialComposer.conditions.map((condition) => evaluateCondition(condition, workspace.frame.observations[condition.metric].value));
  const ready = evaluations.filter((item) => item.satisfied).length;
  const conditionCount = evaluations.length;
  const waitingReason = ghostWaitingReason(selected, evaluations, workspace.frame);
  const step = useMutation({ mutationFn: () => api("/api/demo/step", { method: "POST" }), onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["workspace"] }) });

  return (
    <div className="trade-layout phase-25-trade">
      <div id="portfolio"><PortfolioRail workspace={workspace} price={price} /></div>
      <main className="market-workspace">
        <section className="market-header" aria-label="Market overview">
          <div className="market-title"><span className="asset-emblem">S</span><div><span className="eyebrow">MARKET YOU'RE WATCHING</span><h1>SOL <i>/</i> USDC</h1></div></div>
          <div className="market-price"><span>CURRENT MARKET PRICE</span><motion.strong key={price} initial={{ opacity: .45, y: -3 }} animate={{ opacity: 1, y: 0 }}>${money.format(price)}</motion.strong><small className="positive">+4.84% TODAY</small></div>
          <div className={`market-context ${marketDetailsOpen ? "open" : ""}`}>
            <div className="market-context-funding"><span>FUNDING</span><b>{Number(funding) >= 0 ? "+" : ""}{(Number(funding) * 100).toFixed(3)}%</b><small>8H ESTIMATE</small></div>
            <div className="market-context-pnl"><span>POSITION P&amp;L</span><b className={Number(pnl) >= 0 ? "positive" : "negative"}>{(Number(pnl) * 100).toFixed(1)}%</b><small>FRAME DERIVED</small></div>
            <div className="market-context-updated"><span>UPDATED</span><b>{ageLabel(observedAt)}</b><small>{modeIsLive ? "LIVE OBSERVATION" : "DEMO FRAME"}</small></div>
          </div>
          <button className="market-details-toggle" aria-expanded={marketDetailsOpen} onClick={() => setMarketDetailsOpen((value) => !value)}>MARKET DETAILS<CaretRight size={14} /></button>
        </section>
        <section className="chart-zone">
          <div className="chart-toolbar"><div><button className="active">1M</button><button>5M</button><button>1H</button></div><div><Crosshair size={16} /><span>{modeIsLive ? "HYPERLIQUID MARK" : "DETERMINISTIC PATH"}</span></div></div>
          <MarketChart price={price} />
          <div className="chart-watermark"><BrandIcon size={56} weight="duotone" /><span>TRIGGERLANE FEED</span></div>
        </section>
        <section className="watch-zone">
          <div className="watch-heading">
            <div><span className="eyebrow">WHAT THIS TRIGGER IS WAITING FOR</span><h2>{selected ? selected.name : "Your first trigger"}</h2><p className="waiting-reason"><Pulse size={13} />{waitingReason}</p></div>
            <div className="readiness"><span>{ready} / {conditionCount} READY</span><strong>{Math.round((ready / conditionCount) * 100)}%</strong></div>
          </div>
          <CompactSignalEngine evaluations={evaluations} ghost={selected} />
          <ConditionStrip evaluations={evaluations} frame={workspace.frame} />
          <GhostLifecycle ghost={selected} />
        </section>
        <section className="activity-tape">
          <div className="tape-label"><Broadcast size={16} /><span>ACTIVITY</span></div>
          <div className="tape-events"><AnimatePresence initial={false}>{workspace.activities.slice(0, 3).map((activity) => <motion.span key={activity.id} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}><i />{activity.message}<time>{dateTime(activity.created_at)}</time></motion.span>)}</AnimatePresence></div>
        </section>
        <FeedControls workspace={workspace} step={() => step.mutate()} stepping={step.isPending} />
        <AnimatePresence>{selected?.status === "FILLED" && <motion.div className="execution-flash" role="status" initial={{ opacity: 0, scale: .94 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}><span><Check size={24} weight="bold" /></span><div><b>TRIGGER FILLED</b><small>Simulated settlement committed exactly once</small></div></motion.div>}</AnimatePresence>
      </main>
      <button className="mobile-compose-trigger" aria-expanded={composerOpen} aria-controls="trigger-composer-sheet" onClick={() => setComposerOpen(true)}><Plus size={17} weight="bold" />BUILD A TRIGGER</button>
      <div id="trigger-composer-sheet" className={`composer-shell ${composerOpen ? "open" : ""}`}><button className="composer-sheet-close" title="Close Composer" onClick={() => setComposerOpen(false)}><X size={19} /></button><Composer workspace={workspace} capabilities={capabilities} onCreated={(ghost) => { setSelectedId(ghost.id); setComposerOpen(false); }} /></div>
    </div>
  );
}

function GhostActions({ ghost }: { ghost: GhostRecord }) {
  const queryClient = useQueryClient();
  const mutate = useMutation({
    mutationFn: (action: "pause" | "resume" | "cancel" | "arm") => api(`/api/ghosts/${ghost.id}/${action}`, { method: "POST" }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["workspace"] });
      void queryClient.invalidateQueries({ queryKey: ["ghost", ghost.id] });
    },
  });
  const terminal = ["FILLED", "CANCELLED", "EXPIRED", "FAILED"].includes(ghost.status);
  const pending = mutate.isPending;
  const error = mutate.error instanceof Error ? mutate.error.message : null;
  return (
    <div className="ghost-action-wrap">
      <div className="row-actions">
        <button aria-label={ghost.status === "DRAFT" ? "Start trigger" : `Start unavailable while ${ghost.status.toLowerCase()}`} title={ghost.status === "DRAFT" ? "Start Trigger" : `Start unavailable while status is ${ghost.status}`} disabled={ghost.status !== "DRAFT" || pending} onClick={() => mutate.mutate("arm")}><Lightning size={17} /></button>
        {ghost.status === "PAUSED" ? <button aria-label="Resume trigger" title="Resume Trigger" disabled={pending} onClick={() => mutate.mutate("resume")}><Play size={17} /></button> : <button aria-label={ghost.status === "WATCHING" ? "Pause trigger" : `Pause unavailable while ${ghost.status.toLowerCase()}`} title={ghost.status === "WATCHING" ? "Pause Trigger" : `Pause unavailable while status is ${ghost.status}`} disabled={ghost.status !== "WATCHING" || pending} onClick={() => mutate.mutate("pause")}><Pause size={17} /></button>}
        <button aria-label={terminal ? `Cancel unavailable while ${ghost.status.toLowerCase()}` : "Cancel trigger"} title={terminal ? `Cancel unavailable while status is ${ghost.status}` : "Cancel Trigger"} disabled={terminal || pending} onClick={() => mutate.mutate("cancel")}><X size={17} /></button>
        <a aria-label={`Open ${ghost.name}`} title="Open Trigger" href={`/ghost/${ghost.id}`}><ArrowRight size={17} /></a>
      </div>
      {error && <small className="row-action-error" role="alert">{error}</small>}
    </div>
  );
}

function GhostSignalTrace({ evaluations }: { evaluations: Evaluation[] }) {
  const ordered = (["PRICE", "FUNDING", "PNL"] as Metric[]).map((metric) => evaluations.find((evaluation) => evaluation.metric === metric)).filter((evaluation): evaluation is Evaluation => Boolean(evaluation));
  const points = ordered.map((evaluation, index) => {
    const distance = Math.min(Math.max(Number(evaluation.distanceRatio), 0), 1);
    const x = ordered.length === 1 ? 34 : 4 + index * (60 / (ordered.length - 1));
    return { x, y: 28 - (1 - distance) * 22, ready: evaluation.satisfied };
  });
  const ready = evaluations.filter((evaluation) => evaluation.satisfied).length;
  return <div className={`ghost-signal-trace ${ready === evaluations.length ? "ready" : ""}`} role="img" aria-label={`${ready} of ${evaluations.length} conditions ready in the current stored frame`}>
    <svg viewBox="0 0 68 34" aria-hidden="true"><polyline points={points.map((point) => `${point.x},${point.y}`).join(" ")} />{points.map((point, index) => <circle className={point.ready ? "ready" : ""} cx={point.x} cy={point.y} r="2.8" key={index} />)}</svg>
    <span><b>{ready}/{evaluations.length}</b><small>CURRENT FRAME</small></span>
  </div>;
}

function expiryDistance(value: string) {
  const hours = Math.ceil((new Date(value).getTime() - Date.now()) / 3_600_000);
  if (hours <= 0) return "Deadline passed";
  if (hours < 24) return `${hours}h remaining`;
  const days = Math.ceil(hours / 24);
  return `${days}d remaining`;
}

function GhostsView({ workspace }: { workspace: Workspace }) {
  const [statusFilter, setStatusFilter] = useState<"ALL" | "WATCHING" | "PAUSED" | "DRAFT" | "TERMINAL">("ALL");
  const [actionFilter, setActionFilter] = useState<"ALL" | "BUY" | "SELL">("ALL");
  const [proximityFilter, setProximityFilter] = useState<"ALL" | "NEAR" | "BUILDING" | "FAR">("ALL");
  const [sortBy, setSortBy] = useState<"READINESS" | "CAPITAL" | "EXPIRY" | "RECENT">("READINESS");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 24;
  const price = Number(workspace.frame.observations.PRICE.value);
  const terminalStatuses = ["FILLED", "CANCELLED", "EXPIRED", "FAILED"];
  const capitalValue = (ghost: GhostRecord) => ghost.reservation ? Number(ghost.reservation.amount) * (ghost.reservation.asset === "SOL" ? price : 1) : 0;
  const reasonFor = (ghost: GhostRecord) => { const summary = ghostStateSummary(ghost, workspace.frame); return `${summary.headline}. ${summary.reason}`; };
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    const rows = workspace.ghosts.filter((ghost) => {
      const terminal = terminalStatuses.includes(ghost.status);
      if (statusFilter !== "ALL" && (statusFilter === "TERMINAL" ? !terminal : ghost.status !== statusFilter)) return false;
      if (actionFilter !== "ALL" && ghost.side !== actionFilter) return false;
      const ready = ghost.evaluations.filter((evaluation) => evaluation.satisfied).length;
      if (proximityFilter === "NEAR" && ready < 2) return false;
      if (proximityFilter === "BUILDING" && ready !== 1) return false;
      if (proximityFilter === "FAR" && ready !== 0) return false;
      if (query && !`${ghost.name} ${ghost.side} ${reasonFor(ghost)}`.toLowerCase().includes(query)) return false;
      return true;
    });
    return rows.sort((left, right) => {
      if (sortBy === "CAPITAL") return capitalValue(right) - capitalValue(left);
      if (sortBy === "EXPIRY") return new Date(left.expiresAt).getTime() - new Date(right.expiresAt).getTime();
      if (sortBy === "RECENT") return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
      return Number(right.triggerProximity) - Number(left.triggerProximity) || new Date(left.expiresAt).getTime() - new Date(right.expiresAt).getTime();
    });
  }, [actionFilter, proximityFilter, search, sortBy, statusFilter, workspace.frame, workspace.ghosts]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  useEffect(() => setPage(1), [actionFilter, proximityFilter, search, sortBy, statusFilter]);
  useEffect(() => { if (page > totalPages) setPage(totalPages); }, [page, totalPages]);
  const visible = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const groups = [
    { id: "WATCHING", title: "Watching now", description: "Evaluating every complete frame", ghosts: visible.filter((ghost) => ghost.status === "WATCHING") },
    { id: "PAUSED", title: "Paused safely", description: "Capital stays controlled while monitoring is stopped", ghosts: visible.filter((ghost) => ghost.status === "PAUSED") },
    { id: "DRAFT", title: "Ready to start", description: "Reviewed drafts with no capital reserved", ghosts: visible.filter((ghost) => ghost.status === "DRAFT") },
    { id: "TERMINAL", title: "Finished", description: "Filled, cancelled, expired, or failed outcomes", ghosts: visible.filter((ghost) => terminalStatuses.includes(ghost.status)) },
  ];
  const active = workspace.ghosts.filter((ghost) => ["WATCHING", "PAUSED"].includes(ghost.status));
  const closest = [...active].sort((left, right) => Number(right.triggerProximity) - Number(left.triggerProximity))[0];
  const reservedValue = workspace.ghosts.reduce((total, ghost) => total + capitalValue(ghost), 0);
  const nextExpiry = [...workspace.ghosts.filter((ghost) => !terminalStatuses.includes(ghost.status))].sort((left, right) => new Date(left.expiresAt).getTime() - new Date(right.expiresAt).getTime())[0];
  const filtersActive = statusFilter !== "ALL" || actionFilter !== "ALL" || proximityFilter !== "ALL" || search.length > 0;

  return (
    <main className="page-view ghosts-command-page">
      <div className="page-title"><div><span className="eyebrow">AUTOMATION COMMAND CENTER</span><h1>Your triggers</h1><p>See what is closest to acting, why each trigger is waiting, and exactly how much virtual capital it controls.</p></div><a className="new-ghost" href="/trade"><Plus size={17} />BUILD A TRIGGER</a></div>

      {workspace.frame.completeness !== "COMPLETE" && <div className="ghosts-stale-warning" role="alert"><Warning size={19} /><div><b>Fresh evaluation is paused</b><span>{workspace.frame.completeness === "STALE" ? "The current market frame is stale." : "The current market frame is incomplete."} Triggers will not act until one complete frame is stored.</span></div></div>}

      <section className="ghost-command-summary" aria-label="Trigger command summary">
        <div className="closest-ghost"><span>CLOSEST TO ACTING</span>{closest ? <><a href={`/ghost/${closest.id}`}>{closest.name}<ArrowRight size={17} /></a><p>{reasonFor(closest)}</p></> : <><b>No trigger is watching</b><p>Start a draft when you are ready.</p></>}</div>
        <div><span>WATCHING</span><b>{workspace.ghosts.filter((ghost) => ghost.status === "WATCHING").length}</b><small>evaluating now</small></div>
        <div><span>RESERVED VALUE</span><b>${money.format(reservedValue)}</b><small>simulated USDC</small></div>
        <div><span>NEXT DEADLINE</span><b>{nextExpiry ? expiryDistance(nextExpiry.expiresAt) : "None"}</b><small>{nextExpiry ? nextExpiry.name : "no active triggers"}</small></div>
      </section>

      <section className="ghost-command-controls" aria-label="Filter and sort triggers">
        <label className="ghost-search">Search<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name or waiting reason" /></label>
        <div className="status-filter" role="group" aria-label="Status filter">{(["ALL", "WATCHING", "PAUSED", "DRAFT", "TERMINAL"] as const).map((status) => <button aria-pressed={statusFilter === status} className={statusFilter === status ? "active" : ""} key={status} onClick={() => setStatusFilter(status)}>{status === "ALL" ? "All states" : status.charAt(0) + status.slice(1).toLowerCase()}</button>)}</div>
        <label>Action<select value={actionFilter} onChange={(event) => setActionFilter(event.target.value as typeof actionFilter)}><option value="ALL">All actions</option><option value="BUY">Buy</option><option value="SELL">Sell</option></select></label>
        <label>Trigger distance<select value={proximityFilter} onChange={(event) => setProximityFilter(event.target.value as typeof proximityFilter)}><option value="ALL">Any distance</option><option value="NEAR">Near, 2+ ready</option><option value="BUILDING">Building, 1 ready</option><option value="FAR">Far, 0 ready</option></select></label>
        <label>Sort<select value={sortBy} onChange={(event) => setSortBy(event.target.value as typeof sortBy)}><option value="READINESS">Closest first</option><option value="CAPITAL">Most capital</option><option value="EXPIRY">Soonest deadline</option><option value="RECENT">Recently changed</option></select></label>
        {filtersActive && <button className="reset-filters" onClick={() => { setStatusFilter("ALL"); setActionFilter("ALL"); setProximityFilter("ALL"); setSearch(""); }}><X size={15} />RESET</button>}
      </section>

      {workspace.ghosts.length === 0 ? <div className="empty-state ghost-command-empty"><BrandIcon size={42} weight="duotone" /><h2>Your first trigger starts with a moment</h2><p>Choose what must be true, decide how much virtual capital it may use, then let Triggerlane watch.</p><a href="/trade">BUILD YOUR FIRST TRIGGER<ArrowRight size={15} /></a></div> : filtered.length === 0 ? <div className="empty-state ghost-command-empty"><SlidersHorizontal size={38} /><h2>No triggers match these filters</h2><p>Try another state, action, trigger distance, or search term.</p><button onClick={() => { setStatusFilter("ALL"); setActionFilter("ALL"); setProximityFilter("ALL"); setSearch(""); }}>SHOW ALL TRIGGERS</button></div> : <div className="ghost-state-groups">{groups.filter((group) => group.ghosts.length > 0).map((group) => <section className={`ghost-state-band state-${group.id.toLowerCase()}`} aria-labelledby={`state-${group.id}`} key={group.id}><header><div><span>{group.ghosts.length}</span><div><h2 id={`state-${group.id}`}>{group.title}</h2><p>{group.description}</p></div></div><b>{group.id}</b></header><div className="ghost-command-rows">{group.ghosts.map((ghost) => {
        const summary = ghostStateSummary(ghost, workspace.frame);
        const action = `${ghost.side} ${ghost.amountType === "USDC" ? `${quantity.format(Number(ghost.amount))} USDC` : `${quantity.format(Number(ghost.amount))}% SOL`}`;
        const evidence = ghost.status === "FILLED" ? "Receipt stored" : ["CANCELLED", "EXPIRED", "FAILED"].includes(ghost.status) ? "Outcome stored" : expiryDistance(ghost.expiresAt);
        return <article className={`ghost-command-row answer-${summary.tone}`} key={ghost.id}>
          <div className="ghost-command-identity"><span className="mini-ghost"><BrandIcon size={17} weight="duotone" /></span><div><div><a href={`/ghost/${ghost.id}`}>{ghost.name}</a><StatusBadge status={ghost.status} /></div><small>{ghost.side} · ONE SHOT · SOL/USDC</small></div></div>
          <div className="ghost-command-answer"><span>{summary.label}</span><b>{summary.headline}</b><p>{summary.reason}</p></div>
          <GhostSignalTrace evaluations={ghost.evaluations} />
          <div className="ghost-command-intent"><span>ACTION IF READY</span><b>{action}</b><small>{ghost.reservation ? `${quantity.format(Number(ghost.reservation.amount))} ${ghost.reservation.asset} set aside` : "capital starts when armed"}</small></div>
          <div className="ghost-command-expiry"><span>{["FILLED", "CANCELLED", "EXPIRED", "FAILED"].includes(ghost.status) ? "AUDIT EVIDENCE" : "DEADLINE"}</span><b>{evidence}</b><small>{dateTime(["FILLED", "CANCELLED", "EXPIRED", "FAILED"].includes(ghost.status) ? ghost.updatedAt : ghost.expiresAt)}</small></div>
          <GhostActions ghost={ghost} />
        </article>;
      })}</div></section>)}</div>}

      {filtered.length > pageSize && <nav className="ghost-pagination" aria-label="Trigger list pages"><span>Showing {(currentPage - 1) * pageSize + 1}-{Math.min(currentPage * pageSize, filtered.length)} of {filtered.length}</span><div><button title="Previous page" disabled={currentPage === 1} onClick={() => setPage((value) => Math.max(1, value - 1))}><CaretLeft size={17} /></button><b>PAGE {currentPage} OF {totalPages}</b><button title="Next page" disabled={currentPage === totalPages} onClick={() => setPage((value) => Math.min(totalPages, value + 1))}><CaretRight size={17} /></button></div></nav>}
    </main>
  );
}

function PortfolioView({ workspace }: { workspace: Workspace }) {
  const [ledgerAsset, setLedgerAsset] = useState<"ALL" | "SOL" | "USDC">("ALL");
  const [ledgerPage, setLedgerPage] = useState(1);
  const pageSize = 10;
  const price = Number(workspace.frame.observations.PRICE.value);
  const sol = workspace.portfolio.balances.SOL;
  const usdc = workspace.portfolio.balances.USDC;
  const solValue = Number(sol.quantity) * price;
  const usdcValue = Number(usdc.quantity);
  const equity = solValue + usdcValue;
  const reservedSolValue = Number(sol.reserved) * price;
  const reservedUsdcValue = Number(usdc.reserved);
  const reservedValue = reservedSolValue + reservedUsdcValue;
  const availableValue = equity - reservedValue;
  const activeReservations = workspace.reservations.filter((reservation) => ["ACTIVE", "LOCKED"].includes(reservation.status));
  const coverage = equity ? reservedValue / equity * 100 : 0;
  const rebuilt = workspace.ledger.flatMap((transaction) => transaction.entries).reduce((totals, entry) => ({ ...totals, [entry.asset]: totals[entry.asset] + Number(entry.amount) }), { SOL: 0, USDC: 0 });
  const reconciled = Math.abs(rebuilt.SOL - Number(sol.quantity)) < .000000001 && Math.abs(rebuilt.USDC - Number(usdc.quantity)) < .000001;
  const filteredLedger = workspace.ledger.filter((transaction) => ledgerAsset === "ALL" || transaction.entries.some((entry) => entry.asset === ledgerAsset));
  const ledgerPages = Math.max(1, Math.ceil(filteredLedger.length / pageSize));
  const currentLedgerPage = Math.min(ledgerPage, ledgerPages);
  const visibleLedger = filteredLedger.slice((currentLedgerPage - 1) * pageSize, currentLedgerPage * pageSize);
  const solShare = equity ? solValue / equity * 100 : 0;
  const usdcShare = 100 - solShare;
  const lockedCount = activeReservations.filter((reservation) => reservation.status === "LOCKED").length;

  return (
    <main className="page-view portfolio-page">
      <div className="page-title portfolio-title"><div><span className="eyebrow">CAPITAL CONTROL</span><h1>Your virtual portfolio</h1><p>See what you own, what remains available, and exactly which trigger controls every reserved amount.</p></div><a className="new-ghost" href="/trade"><Plus size={17} />BUILD A TRIGGER</a></div>

      <section className="portfolio-provenance" aria-label="Portfolio data provenance"><span><i />{workspace.portfolio.dataMode} PORTFOLIO</span><b>SIMULATED CAPITAL</b><small>Valued from stored frame {workspace.frame.id.slice(0, 8)} at ${money.format(price)} / SOL</small></section>

      <section className="portfolio-overview" aria-label="Portfolio overview">
        <div className="equity-statement"><span>TOTAL SIMULATED EQUITY</span><strong>${money.format(equity)}</strong><p>{quantity.format(Number(sol.quantity))} SOL plus {quantity.format(Number(usdc.quantity))} USDC, valued on the current stored frame.</p><div className="capital-equation" aria-label="Capital reconciliation equation"><span><small>AVAILABLE</small><b>${money.format(availableValue)}</b></span><i>+</i><span><small>RESERVED</small><b>${money.format(reservedValue)}</b></span><i>=</i><span><small>TOTAL</small><b>${money.format(equity)}</b></span></div></div>
        <dl className="capital-totals">
          <div><dt>AVAILABLE</dt><dd><b>${money.format(availableValue)}</b><small>free for new triggers</small></dd></div>
          <div><dt>RESERVED</dt><dd><b>${money.format(reservedValue)}</b><small>{activeReservations.length} capital assignment{activeReservations.length === 1 ? "" : "s"}</small></dd></div>
          <div><dt>AUTOMATION COVERAGE</dt><dd><b>{coverage.toFixed(1)}%</b><small>of equity controlled</small></dd></div>
          <div><dt>LOCKED</dt><dd><b>{lockedCount ? `${lockedCount} settling` : "$0.00"}</b><small>{lockedCount ? "settlement in progress" : "nothing in flight"}</small></dd></div>
        </dl>
      </section>

      <section className="capital-map-section" aria-labelledby="capital-map-title">
        <header><div><span className="eyebrow">OWNED CAPITAL</span><h2 id="capital-map-title">Where every simulated dollar sits</h2><p>Solid color is available. The hatched edge is already assigned to a trigger.</p></div><div className={`reconciliation-mark ${reconciled ? "verified" : "mismatch"}`}><CheckCircle size={20} weight="fill" /><span><b>{reconciled ? "LEDGER RECONCILED" : "RECONCILIATION MISMATCH"}</b><small>{workspace.ledger.length} immutable transaction{workspace.ledger.length === 1 ? "" : "s"}</small></span></div></header>
        <div className="capital-map" style={{ gridTemplateColumns: `${Math.max(solShare, 18)}fr ${Math.max(usdcShare, 18)}fr` }}>
          <article className="capital-asset sol-capital">
            <div><span className="asset-symbol sol-symbol">S</span><span><b>SOL</b><small>{solShare.toFixed(1)}% OF EQUITY</small></span></div>
            <strong>${money.format(solValue)}</strong>
            <dl><div><dt>Owned</dt><dd>{quantity.format(Number(sol.quantity))} SOL</dd></div><div><dt>Available</dt><dd>{quantity.format(Number(sol.available))} SOL</dd></div><div><dt>Reserved</dt><dd>{quantity.format(Number(sol.reserved))} SOL</dd></div></dl>
            <div className="asset-reservation-meter"><span style={{ width: `${Number(sol.quantity) ? Number(sol.reserved) / Number(sol.quantity) * 100 : 0}%` }} /></div>
          </article>
          <article className="capital-asset usdc-capital">
            <div><span className="asset-symbol usdc-symbol">$</span><span><b>USDC</b><small>{usdcShare.toFixed(1)}% OF EQUITY</small></span></div>
            <strong>${money.format(usdcValue)}</strong>
            <dl><div><dt>Owned</dt><dd>{quantity.format(Number(usdc.quantity))} USDC</dd></div><div><dt>Available</dt><dd>{quantity.format(Number(usdc.available))} USDC</dd></div><div><dt>Reserved</dt><dd>{quantity.format(Number(usdc.reserved))} USDC</dd></div></dl>
            <div className="asset-reservation-meter"><span style={{ width: `${Number(usdc.quantity) ? Number(usdc.reserved) / Number(usdc.quantity) * 100 : 0}%` }} /></div>
          </article>
        </div>
      </section>

      <section className="reservation-section" aria-labelledby="reservation-title">
        <header><div><span className="eyebrow">CAPITAL ASSIGNMENTS</span><h2 id="reservation-title">Every reservation has an owner</h2><p>These amounts cannot be promised to another trigger until released or settled.</p></div><b>{activeReservations.length} ACTIVE</b></header>
        {activeReservations.length ? <div className="reservation-list">{activeReservations.map((reservation) => {
          const value = Number(reservation.amount) * (reservation.asset === "SOL" ? price : 1);
          const owner = workspace.ghosts.find((ghost) => ghost.id === reservation.ghostId);
          const slippageBps = owner?.maxSlippageBps ?? 0;
          const multiplier = reservation.side === "SELL" ? 1 - slippageBps / 10_000 : 1 + slippageBps / 10_000;
          const estimatedOutput = reservation.side === "SELL" ? `${quantity.format(Number(reservation.amount) * price * multiplier)} USDC` : `${quantity.format(Number(reservation.amount) / (price * multiplier))} SOL`;
          return <article className="reservation-row" key={reservation.id}><div><span className="mini-ghost"><BrandIcon size={17} weight="duotone" /></span><span><a href={`/ghost/${reservation.ghostId}`}>{reservation.ghostName}</a><small>{reservation.status} · {reservation.side} {reservation.asset === "SOL" ? "SOL" : "WITH USDC"}</small></span></div><div><span>CONTROLLED NOW</span><b>{quantity.format(Number(reservation.amount))} {reservation.asset}</b><small>${money.format(value)} current value</small></div><div><span>IF IT EXECUTED NOW</span><b>{reservation.side} → {estimatedOutput}</b><small>illustration at frame price + {slippageBps} bps</small></div><a className="inspect-reservation" href={`/ghost/${reservation.ghostId}`} title={`Inspect ${reservation.ghostName}`}><Eye size={18} /></a><div className="reservation-owner-chain" aria-label={`${reservation.ghostName} reservation ownership`}><span>SIMULATED PORTFOLIO</span><ArrowRight size={13} /><span>{reservation.ghostName}</span><ArrowRight size={13} /><b>{reservation.status} RESERVATION</b></div><details className="reservation-trace"><summary><BracketsCurly size={15} />TRACE OWNERSHIP</summary><dl><div><dt>Reservation ID</dt><dd>{reservation.id}</dd></div><div><dt>Owner trigger</dt><dd>{reservation.ghostId}</dd></div><div><dt>Created</dt><dd>{dateTime(reservation.createdAt)}</dd></div><div><dt>Trigger deadline</dt><dd>{owner ? dateTime(owner.expiresAt) : "Unavailable"}</dd></div></dl></details></article>;
        })}</div> : <div className="portfolio-empty"><BrandIcon size={32} weight="duotone" /><div><h3>No capital is reserved</h3><strong>${money.format(equity)} available</strong><p>Every simulated dollar is free for a new trigger. Starting one creates a named ownership trail here.</p></div><a href="/trade">BUILD A TRIGGER<ArrowRight size={15} /></a></div>}
      </section>

      <section className="ledger-section" aria-labelledby="ledger-title">
        <header><div><span className="eyebrow">IMMUTABLE LEDGER</span><h2 id="ledger-title">The numbers behind the numbers</h2><p>Every balance movement is stored as a transaction. Credits and debits below reconstruct the owned balances above.</p></div><div className="ledger-filters" role="group" aria-label="Filter ledger by asset">{(["ALL", "SOL", "USDC"] as const).map((asset) => <button className={ledgerAsset === asset ? "active" : ""} aria-pressed={ledgerAsset === asset} key={asset} onClick={() => { setLedgerAsset(asset); setLedgerPage(1); }}>{asset === "ALL" ? "All entries" : asset}</button>)}</div></header>
        <div className="reconciliation-strip"><div><span>REBUILT SOL</span><b>{quantity.format(rebuilt.SOL)} SOL</b></div><i /><div><span>REBUILT USDC</span><b>{quantity.format(rebuilt.USDC)} USDC</b></div><i /><div><span>BALANCE CHECK</span><b>{reconciled ? "EXACT MATCH" : "REVIEW NEEDED"}</b></div></div>
        <div className="ledger-list">{visibleLedger.map((transaction) => <article className="ledger-row" key={transaction.id}><div className={`ledger-type ledger-${transaction.type.toLowerCase()}`}><span>{transaction.type === "SEED" ? "01" : "TX"}</span><div><b>{transaction.ghostName ?? "Initial virtual deposit"}</b><small>{transaction.type} · {dateTime(transaction.createdAt)}</small></div></div><div className="ledger-movements">{transaction.entries.map((entry) => <span className={Number(entry.amount) >= 0 ? "credit" : "debit"} key={entry.id}><b>{Number(entry.amount) >= 0 ? "+" : ""}{quantity.format(Number(entry.amount))} {entry.asset}</b><small>{entry.type.replaceAll("_", " ")}</small></span>)}</div><div className="ledger-reference"><span>{transaction.executionId ? "SETTLEMENT EVIDENCE" : "CAPITAL ORIGIN"}</span><b>{transaction.executionId ? "Receipt + ledger" : "Initial deposit"}</b>{transaction.executionId ? <a href={`/history?item=${encodeURIComponent(`receipt:${transaction.executionId}`)}`}>OPEN RECEIPT <ArrowRight size={13} /></a> : <small>PORTFOLIO GENESIS</small>}</div><details className="ledger-trace"><summary><BracketsCurly size={15} />TRACE TRANSACTION</summary><dl><div><dt>Transaction ID</dt><dd>{transaction.id}</dd></div><div><dt>Trigger owner</dt><dd>{transaction.ghostId ?? "PORTFOLIO GENESIS"}</dd></div><div><dt>Execution record</dt><dd>{transaction.executionId ?? "NOT APPLICABLE"}</dd></div><div><dt>Stored</dt><dd>{dateTime(transaction.createdAt)}</dd></div></dl></details></article>)}</div>
        {filteredLedger.length > pageSize && <nav className="ghost-pagination" aria-label="Ledger pages"><span>Showing {(currentLedgerPage - 1) * pageSize + 1}-{Math.min(currentLedgerPage * pageSize, filteredLedger.length)} of {filteredLedger.length}</span><div><button title="Previous ledger page" disabled={currentLedgerPage === 1} onClick={() => setLedgerPage((value) => Math.max(1, value - 1))}><CaretLeft size={17} /></button><b>PAGE {currentLedgerPage} OF {ledgerPages}</b><button title="Next ledger page" disabled={currentLedgerPage === ledgerPages} onClick={() => setLedgerPage((value) => Math.min(ledgerPages, value + 1))}><CaretRight size={17} /></button></div></nav>}
      </section>
    </main>
  );
}

function downloadJson(filename: string, value: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function ReceiptActions({ filename, value }: { filename: string; value: unknown }) {
  return <div className="receipt-actions"><button onClick={() => navigator.clipboard.writeText(JSON.stringify(value, null, 2))}><Copy size={16} />COPY JSON</button><button onClick={() => downloadJson(filename, value)}><DownloadSimple size={16} />DOWNLOAD JSON</button><button onClick={() => window.print()}><Printer size={16} />PRINT RECEIPT</button></div>;
}

function Receipt({ execution, close }: { execution: Execution; close?: () => void }) {
  const receipt = execution.receipt;
  const evaluations = (receipt.evaluations ?? []) as Evaluation[];
  const observations = receipt.frame?.observations as Record<Metric, Observation> | undefined;
  const quote = receipt.quote as { modelVersion?: string; referencePrice?: string; executionPrice?: string } | undefined;
  const reservation = receipt.reservation as { id?: string; asset?: string; amount?: string } | undefined;
  const ledgerTransactionId = receipt.ledgerTransactionId as string | undefined;
  return (
    <div className="receipt printable-audit">
      <div className="receipt-header"><div><span className="receipt-seal"><Check size={23} weight="bold" /></span><div><span className="eyebrow">SIMULATED EXECUTION RECEIPT</span><h2>{execution.ghost_name}</h2></div></div>{close && <button autoFocus className="icon-button no-print" title="Close receipt" onClick={close}><X size={18} /></button>}</div>
      <div className="receipt-hero"><div><span>SETTLED</span><strong>{quantity.format(Number(execution.input_amount))} {execution.input_asset}</strong></div><ArrowRight size={22} /><div><span>RECEIVED</span><strong>{quantity.format(Number(execution.output_amount))} {execution.output_asset}</strong></div></div>
      <div className="receipt-grid"><div><span>Execution price</span><b>${money.format(Number(execution.execution_price))}</b></div><div><span>Modeled slippage</span><b>{execution.modeled_slippage_bps} bps</b></div><div><span>Frame</span><b>{String(receipt.frame?.id ?? "").slice(0, 12)}</b></div><div><span>Completed</span><b>{dateTime(execution.completed_at)}</b></div>{quote?.modelVersion && <div><span>Quote model</span><b>{quote.modelVersion}</b></div>}{reservation?.id && <div><span>Reservation</span><b>{reservation.id.slice(0, 12)}</b></div>}{ledgerTransactionId && <div className="receipt-grid-wide"><span>Ledger transaction</span><b>{ledgerTransactionId}</b></div>}</div>
      <div className="audit-timelines"><section><span className="eyebrow">CONDITION TIMELINE</span>{evaluations.map((evaluation) => <div className="audit-step complete" key={evaluation.metric}><i><Check size={11} weight="bold" /></i><div><b>{evaluation.metric} qualified</b><p>{formatMetric(evaluation.metric, evaluation.current)} {evaluation.operator === "GTE" ? ">=" : "<="} {formatMetric(evaluation.metric, evaluation.target)}</p></div></div>)}</section><section><span className="eyebrow">SETTLEMENT TIMELINE</span>{[["Frame locked", String(receipt.frame?.id ?? "").slice(0, 12)], ["Capital consumed", `${quantity.format(Number(reservation?.amount ?? 0))} ${reservation?.asset ?? ""}`], ["Quote accepted", quote?.modelVersion ?? "RECORDED"], ["Ledger committed", ledgerTransactionId?.slice(0, 12) ?? "RECORDED"]].map(([label, detail]) => <div className="audit-step complete" key={label}><i><Check size={11} weight="bold" /></i><div><b>{label}</b><p>{detail}</p></div></div>)}</section></div>
      {observations && <div className="receipt-section"><span className="eyebrow">FRAME PROVENANCE</span>{Object.values(observations).map((observation) => <div className="provenance-row" key={observation.id}><span>{observation.metric}</span><b>{providerLabel(observation.provider)}</b><small>{observation.sourceTimestamp ? new Date(observation.sourceTimestamp).toISOString() : "NO SOURCE TIME"}</small></div>)}</div>}
      <div className="no-print"><ReceiptActions filename={`ghost-receipt-${execution.id}.json`} value={receipt} /></div>
    </div>
  );
}

function BlockedAudit({ attempt, close }: { attempt: ExecutionAttempt; close: () => void }) {
  const evaluations = attempt.conditions.map((condition) => evaluateCondition(condition, attempt.frame.observations[condition.metric].value));
  const quote = attempt.reason?.metadata.quote;
  const exportValue = { outcome: "EXECUTION_BLOCKED", ...attempt };
  return <div className="receipt blocked-audit printable-audit"><div className="receipt-header"><div><span className="receipt-seal blocked"><Warning size={22} weight="fill" /></span><div><span className="eyebrow">BLOCKED ATTEMPT RECORD</span><h2>{attempt.ghostName}</h2></div></div><button autoFocus className="icon-button no-print" title="Close audit record" onClick={close}><X size={18} /></button></div><div className="blocked-hero"><span>NO EXECUTION</span><h3>Conditions qualified. Settlement was prevented.</h3><p>{attempt.reason?.message ?? "The attempt did not pass the execution boundary."}</p></div><div className="audit-timelines"><section><span className="eyebrow">CONDITION TIMELINE</span>{evaluations.map((evaluation) => <div className="audit-step complete" key={evaluation.metric}><i><Check size={11} weight="bold" /></i><div><b>{evaluation.metric} qualified</b><p>{formatMetric(evaluation.metric, evaluation.current)} {evaluation.operator === "GTE" ? ">=" : "<="} {formatMetric(evaluation.metric, evaluation.target)}</p></div></div>)}</section><section><span className="eyebrow">SETTLEMENT TIMELINE</span><div className="audit-step complete"><i><Check size={11} /></i><div><b>Frame locked</b><p>{attempt.frame.id.slice(0, 12)}</p></div></div><div className="audit-step blocked"><i><X size={11} /></i><div><b>Quote rejected</b><p>{quote?.modeledSlippageBps ?? "Modeled"} bps versus {attempt.maxSlippageBps} bps maximum</p></div></div><div className="audit-step restored"><i><ShieldCheck size={12} /></i><div><b>Capital restored</b><p>{attempt.reservation?.status ?? "ACTIVE"} reservation</p></div></div><div className="audit-step absent"><i /><div><b>No ledger transaction</b><p>Owned balances did not change</p></div></div></section></div><div className="receipt-grid"><div><span>Frame</span><b>{attempt.frame.id}</b></div><div><span>Frame provenance</span><b>{attempt.frame.mode} · {attempt.frame.completeness}</b></div><div><span>Quote model</span><b>{quote?.modelVersion ?? "RECORDED IN ACTIVITY"}</b></div><div><span>Reservation</span><b>{attempt.reservation?.id ?? "NONE"}</b></div><div className="receipt-grid-wide"><span>Ledger transaction</span><b>NOT CREATED</b></div></div><div className="no-print"><ReceiptActions filename={`ghost-blocked-attempt-${attempt.id}.json`} value={exportValue} /></div></div>;
}

function TerminalAudit({ ghost, activities, close }: { ghost: GhostRecord; activities: Activity[]; close: () => void }) {
  const explanation = ghost.status === "CANCELLED" ? "The user stopped monitoring before an execution committed." : ghost.status === "EXPIRED" ? "The deadline passed before a qualifying execution completed." : "The execution path ended without a committed settlement.";
  const exportValue = { outcome: ghost.status, ghost, activities };
  return <div className={`receipt terminal-audit outcome-${ghost.status.toLowerCase()} printable-audit`}><div className="receipt-header"><div><span className="receipt-seal terminal"><X size={22} /></span><div><span className="eyebrow">TERMINAL OUTCOME RECORD</span><h2>{ghost.name}</h2></div></div><button autoFocus className="icon-button no-print" title="Close audit record" onClick={close}><X size={18} /></button></div><div className="blocked-hero"><span>{ghost.status === "FAILED" ? "EXECUTION FAILED" : "NO EXECUTION"}</span><h3>{ghost.status.replaceAll("_", " ")}</h3><p>{explanation}</p></div><div className="audit-timelines"><section><span className="eyebrow">LAST CONDITION STATE</span>{ghost.evaluations.map((evaluation) => <div className={`audit-step ${evaluation.satisfied ? "complete" : "absent"}`} key={evaluation.metric}><i>{evaluation.satisfied && <Check size={11} />}</i><div><b>{evaluation.metric} {evaluation.satisfied ? "ready" : "not ready"}</b><p>{formatMetric(evaluation.metric, evaluation.current)} {evaluation.operator === "GTE" ? ">=" : "<="} {formatMetric(evaluation.metric, evaluation.target)}</p></div></div>)}</section><section><span className="eyebrow">SETTLEMENT TIMELINE</span><div className="audit-step blocked"><i><X size={11} /></i><div><b>Monitoring ended</b><p>{dateTime(ghost.updatedAt)}</p></div></div><div className="audit-step restored"><i><ShieldCheck size={12} /></i><div><b>Capital released</b><p>No active reservation remains</p></div></div><div className="audit-step absent"><i /><div><b>No accepted quote</b><p>No execution price was committed</p></div></div><div className="audit-step absent"><i /><div><b>No ledger transaction</b><p>Owned balances did not change</p></div></div></section></div><div className="terminal-activity"><span className="eyebrow">RECORDED ACTIVITY</span>{activities.map((activity) => <div key={activity.id}><i /><span><b>{activity.type.replaceAll("_", " ")}</b><p>{activity.message}</p><small>{dateTime(activity.created_at)}</small></span></div>)}</div><div className="no-print"><ReceiptActions filename={`ghost-outcome-${ghost.id}.json`} value={exportValue} /></div></div>;
}

type HistoryOutcome = { key: string; id: string; status: "FILLED" | "BLOCKED" | "CANCELLED" | "EXPIRED" | "FAILED"; name: string; at: string; kind: "receipt" | "attempt" | "outcome"; execution?: Execution; attempt?: ExecutionAttempt; ghost?: GhostRecord };

function historyOutcomeStory(outcome: HistoryOutcome) {
  if (outcome.status === "FILLED") return { headline: "Trade settled and balances changed", capital: "Committed to ledger", proof: "Receipt, frame, quote, reservation, ledger" };
  if (outcome.status === "BLOCKED") return { headline: "Execution prevented; capital restored", capital: "Owned balances unchanged", proof: "Attempt, frame, rejected quote, reservation" };
  if (outcome.status === "CANCELLED") return { headline: "Stopped before execution", capital: "Reserved capital released", proof: "Outcome, final conditions, activity trail" };
  if (outcome.status === "EXPIRED") return { headline: "Deadline passed before execution", capital: "Reserved capital released", proof: "Outcome, final conditions, deadline" };
  return { headline: "Settlement failed without a ledger commit", capital: "Owned balances unchanged", proof: "Failure, final conditions, activity trail" };
}

function HistoryView({ workspace }: { workspace: Workspace }) {
  const [status, setStatus] = useState<"ALL" | HistoryOutcome["status"]>("ALL");
  const [search, setSearch] = useState("");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const outcomes = useMemo<HistoryOutcome[]>(() => [
    ...workspace.executions.map((execution) => ({ key: `receipt:${execution.id}`, id: execution.id, status: "FILLED" as const, name: execution.ghost_name, at: execution.completed_at, kind: "receipt" as const, execution })),
    ...workspace.executionAttempts.map((attempt) => ({ key: `attempt:${attempt.id}`, id: attempt.id, status: "BLOCKED" as const, name: attempt.ghostName, at: attempt.updatedAt, kind: "attempt" as const, attempt })),
    ...workspace.ghosts.filter((ghost) => ["CANCELLED", "EXPIRED", "FAILED"].includes(ghost.status)).map((ghost) => ({ key: `outcome:${ghost.id}`, id: ghost.id, status: ghost.status as "CANCELLED" | "EXPIRED" | "FAILED", name: ghost.name, at: ghost.updatedAt, kind: "outcome" as const, ghost })),
  ].sort((left, right) => new Date(right.at).getTime() - new Date(left.at).getTime()), [workspace.executionAttempts, workspace.executions, workspace.ghosts]);
  const visible = outcomes.filter((outcome) => (status === "ALL" || outcome.status === status) && `${outcome.name} ${outcome.status}`.toLowerCase().includes(search.trim().toLowerCase()));
  const selected = outcomes.find((outcome) => outcome.key === selectedKey) ?? null;
  const open = (outcome: HistoryOutcome) => { setSelectedKey(outcome.key); const url = new URL(window.location.href); url.searchParams.set("item", outcome.key); window.history.pushState({}, "", url); };
  const close = () => { setSelectedKey(null); const url = new URL(window.location.href); url.searchParams.delete("item"); window.history.replaceState({}, "", url); };
  useEffect(() => {
    const sync = () => setSelectedKey(new URL(window.location.href).searchParams.get("item"));
    sync();
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape" && selectedKey) close(); };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [selectedKey]);
  const settledVolume = workspace.executions.reduce((sum, item) => sum + Number(item.output_asset === "USDC" ? item.output_amount : item.input_amount), 0);
  return <main className="page-view history-audit-page phase-27-history"><div className="page-title"><div><span className="eyebrow">EXECUTION AUDIT TRAIL</span><h1>Trigger history</h1><p>See what happened to every trigger and its capital first, then open the stored evidence behind the result.</p></div><div className="history-total"><span>SIMULATED SETTLED VALUE</span><b>${money.format(settledVolume)}</b><small>{workspace.executions.length} committed settlement{workspace.executions.length === 1 ? "" : "s"} · {workspace.executionAttempts.length} prevented</small></div></div><section className="history-summary" aria-label="History outcome summary">{(["FILLED", "BLOCKED", "CANCELLED", "EXPIRED", "FAILED"] as const).map((item) => <button key={item} className={status === item ? "active" : ""} onClick={() => setStatus(status === item ? "ALL" : item)}><span>{item}</span><b>{outcomes.filter((outcome) => outcome.status === item).length}</b><small>{item === "FILLED" ? "ledger committed" : item === "BLOCKED" ? "capital restored" : item === "FAILED" ? "settlement failed" : "no execution"}</small></button>)}</section><section className="history-controls" aria-label="Filter history"><label>Search<input placeholder="Trigger or outcome" value={search} onChange={(event) => setSearch(event.target.value)} /></label><div className="history-status-filter" role="group" aria-label="Outcome filter">{(["ALL", "FILLED", "BLOCKED", "CANCELLED", "EXPIRED", "FAILED"] as const).map((item) => <button aria-pressed={status === item} className={status === item ? "active" : ""} key={item} onClick={() => setStatus(item)}>{item === "ALL" ? "All outcomes" : item.charAt(0) + item.slice(1).toLowerCase()}</button>)}</div></section>{outcomes.length === 0 ? <div className="empty-state history-empty phase-27-empty"><ClockCounterClockwise size={38} /><h2>No outcomes yet</h2><p>History begins when a trigger settles, is prevented, is stopped, expires, or fails. Every result will keep its evidence here.</p><div className="history-empty-outcomes"><span><Check size={13} />SETTLED</span><span><ShieldCheck size={13} />PREVENTED</span><span><X size={13} />STOPPED</span></div><a href="/trade">RUN A TRIGGER<Play size={15} /></a></div> : visible.length === 0 ? <div className="empty-state history-empty phase-27-empty"><Database size={36} /><h2>No outcomes match</h2><p>Your evidence is still stored. Clear the current filter to return to the complete chronology.</p><button onClick={() => { setStatus("ALL"); setSearch(""); }}>SHOW ALL HISTORY</button></div> : <section className="history-ledger phase-27-ledger" aria-label="Chronological execution ledger"><header><span>OUTCOME</span><span>TRIGGER AND RESULT</span><span>CAPITAL</span><span>STORED PROOF</span><span>EXPAND</span></header>{visible.map((outcome) => {
    const evaluations = outcome.execution ? (outcome.execution.receipt.evaluations ?? []) as Evaluation[] : outcome.attempt ? outcome.attempt.conditions.map((condition) => evaluateCondition(condition, outcome.attempt!.frame.observations[condition.metric].value)) : outcome.ghost?.evaluations ?? [];
    const ready = evaluations.filter((evaluation) => evaluation.satisfied).length;
    const settlement = outcome.execution ? `${quantity.format(Number(outcome.execution.input_amount))} ${outcome.execution.input_asset} → ${quantity.format(Number(outcome.execution.output_amount))} ${outcome.execution.output_asset}` : outcome.status === "BLOCKED" ? "PREVENTED · CAPITAL RESTORED" : outcome.status === "FAILED" ? "FAILED · NO LEDGER COMMIT" : "NOT ATTEMPTED · CAPITAL RELEASED";
    const story = historyOutcomeStory(outcome);
    const evidenceLabel = outcome.kind === "receipt" ? "VIEW RECEIPT" : outcome.kind === "attempt" ? "VIEW ATTEMPT" : "VIEW OUTCOME";
    return <button className={`history-audit-row outcome-${outcome.status.toLowerCase()}`} aria-expanded={selectedKey === outcome.key} aria-haspopup="dialog" aria-controls="audit-record-dialog" key={outcome.key} onClick={() => open(outcome)}><span className="outcome-mark">{outcome.status === "FILLED" ? <Check size={16} weight="bold" /> : outcome.status === "BLOCKED" ? <ShieldCheck size={17} /> : <X size={16} />}</span><div className="outcome-label"><StatusBadge status={outcome.status} /><small>{dateTime(outcome.at)}</small></div><div className="outcome-story"><span>{outcome.name}</span><b>{story.headline}</b><small>{settlement}</small></div><div className="outcome-capital"><span>CAPITAL RESULT</span><b>{story.capital}</b><small>{ready}/{evaluations.length} conditions stored</small></div><div className="outcome-proof"><span>STORED PROOF</span><b>{story.proof}</b><small>Identifiers available inside</small></div><div className="outcome-evidence"><span>EXPAND EVIDENCE</span><b>{evidenceLabel}</b><CaretRight size={17} /></div></button>;
  })}</section>}<AnimatePresence>{selected && <motion.div className="modal-backdrop audit-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={close}><motion.div id="audit-record-dialog" className="receipt-modal audit-modal" role="dialog" aria-modal="true" aria-label={`${selected.name} ${selected.status.toLowerCase()} audit record`} initial={{ x: 40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 40, opacity: 0 }} onClick={(event) => event.stopPropagation()}>{selected.execution ? <Receipt execution={selected.execution} close={close} /> : selected.attempt ? <BlockedAudit attempt={selected.attempt} close={close} /> : selected.ghost ? <TerminalAudit ghost={selected.ghost} activities={workspace.activities.filter((activity) => activity.ghost_id === selected.ghost!.id)} close={close} /> : null}</motion.div></motion.div>}</AnimatePresence></main>;
}

function DetailView({ workspace, ghostId }: { workspace: Workspace; ghostId: string }) {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["ghost", ghostId], queryFn: () => api<GhostRecord>(`/api/ghosts/${ghostId}`) });
  const advance = useMutation({
    mutationFn: () => api<Frame>("/api/demo/step", { method: "POST" }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["workspace"] }),
        queryClient.invalidateQueries({ queryKey: ["ghost", ghostId] }),
      ]);
    },
  });
  if (query.isLoading) return <LoadingView />;
  if (!query.data) return <main className="page-view"><div className="empty-state"><Warning size={36} /><h2>Trigger not found</h2><a href="/ghosts">BACK TO TRIGGERS</a></div></main>;
  return <GhostDetailContent workspace={workspace} ghost={query.data} advanceFrame={() => advance.mutate()} advancingFrame={advance.isPending} />;
}

const detailLifecycle = ["DRAFT", "WATCHING", "TRIGGERED", "EXECUTING", "FILLED"] as const;

function GhostDetailContent({ workspace, ghost, advanceFrame, advancingFrame }: { workspace: Workspace; ghost: GhostRecord; advanceFrame: () => void; advancingFrame: boolean }) {
  const ready = ghost.evaluations.filter((evaluation) => evaluation.satisfied).length;
  const conditionCount = ghost.evaluations.length;
  const receiptFrame = ghost.execution?.receipt?.frame as { id?: string; cutoffAt?: string; completeness?: string; observations?: Record<Metric, Observation> } | undefined;
  const frame: Frame = receiptFrame?.observations ? {
    ...workspace.frame,
    id: receiptFrame.id ?? workspace.frame.id,
    mode: receiptFrame.observations.PRICE?.provenance ?? workspace.frame.mode,
    completeness: receiptFrame.completeness ?? workspace.frame.completeness,
    executionEligible: true,
    assembledAt: receiptFrame.cutoffAt ?? workspace.frame.assembledAt,
    observations: receiptFrame.observations,
  } : workspace.frame;
  const dataPaused = ghost.status === "PAUSED" && ["DATA_STALE", "FRAME_INCOMPLETE"].includes(ghost.pauseReason ?? "");
  const framePredatesArm = ghost.status === "WATCHING" && Boolean(ghost.armedAt) && new Date(frame.assembledAt).getTime() < new Date(ghost.armedAt!).getTime();
  const normalizedStatus = ghost.status === "ARMED" || ghost.status === "PAUSED" ? "WATCHING" : ghost.status;
  const storedStage = detailLifecycle.indexOf(normalizedStatus as (typeof detailLifecycle)[number]);
  const actualStage = storedStage >= 0 ? storedStage : ghost.armedAt ? 1 : 0;
  const [inspectionStage, setInspectionStage] = useState(actualStage);
  useEffect(() => setInspectionStage(actualStage), [actualStage]);
  const unsatisfied = ghost.evaluations.filter((evaluation) => !evaluation.satisfied);
  const activeSignalNames = ghost.evaluations.map((evaluation) => metricLabels[evaluation.metric]);
  const coreHeadline = dataPaused ? (ghost.pauseReason === "DATA_STALE" ? "Fresh market data is missing" : "One complete market snapshot is missing") : framePredatesArm ? "This moment arrived before watching began" : ghost.status === "FILLED" ? "This trigger acted once and finished" : ghost.status === "CANCELLED" ? "This trigger was stopped" : ghost.status === "EXPIRED" ? "Time ran out before the moment arrived" : ghost.status === "FAILED" ? "The action did not settle" : ready === conditionCount ? "The whole moment is here" : unsatisfied.length === 1 ? `${metricLabels[unsatisfied[0]?.metric ?? "PRICE"]} has not reached its target` : `${unsatisfied.length} parts of the moment are still missing`;
  const coreMessage = dataPaused ? "This trigger will not act until one fresh, complete frame can prove every active condition at the same time. Reserved capital stays safe." : framePredatesArm ? "The displayed conditions qualify, but this frame predates arming. It cannot execute retroactively. Check one fresh Demo frame to continue." : ghost.status === "FILLED" ? "The receipt below proves the observations, reservation, quote, and ledger movement used for settlement." : ghost.status === "CANCELLED" ? "Monitoring stopped and all reserved capital was released." : ghost.status === "EXPIRED" ? "The deadline passed without execution, so reserved capital was released." : ghost.status === "FAILED" ? "No settlement was committed. The activity trail keeps the failure explainable." : ready === conditionCount ? "Every active condition agrees on one post-arm frame. The trigger is entering the stored execution lifecycle." : conditionCount === 1 ? `This trigger waits until ${activeSignalNames[0]} reaches its configured target in one complete frame.` : `This trigger waits until ${activeSignalNames.join(", ")} are all true in the same complete frame.`;
  const sceneConditions = useMemo<GhostCoreSceneCondition[]>(() => ghost.evaluations.map((evaluation) => {
    const observation = frame.observations[evaluation.metric];
    return {
      metric: metricLabels[evaluation.metric],
      current: formatMetric(evaluation.metric, evaluation.current),
      target: formatMetric(evaluation.metric, evaluation.target),
      operator: evaluation.operator,
      satisfied: evaluation.satisfied,
      distanceRatio: Number(evaluation.distanceRatio),
      provider: observation.provider,
      observedAt: observation.sourceTimestamp ?? observation.receivedAt,
    };
  }), [frame.observations, ghost.evaluations]);
  const viewingHistory = inspectionStage !== actualStage;
  const inspectedStatus = detailLifecycle[inspectionStage] ?? detailLifecycle[0];
  const stateSummary = ghostStateSummary(ghost, frame);
  const settlementEvidence = ghost.status === "FILLED" ? "Receipt and ledger stored" : ghost.status === "FAILED" ? "No ledger commit" : ["CANCELLED", "EXPIRED"].includes(ghost.status) ? "No execution attempted" : "Pending qualification";

  return (
    <main className={`detail-page phase-26-detail detail-state-${stateSummary.tone}`}>
      <div className="detail-title"><div><a href="/ghosts">TRIGGERS</a><span>/</span><span>CURRENT STATUS</span></div><div className="detail-heading"><span className="large-ghost"><BrandIcon size={31} weight="duotone" /></span><div><span className="eyebrow">ONE-SHOT {ghost.side} INTENT</span><h1>{ghost.name}</h1></div><StatusBadge status={ghost.status} /></div></div>

      <section className={`detail-observatory ${dataPaused ? "data-blocked" : ""}`} aria-labelledby="ghost-core-heading">
        <aside className="observatory-brief">
          <div className="detail-current-answer"><span>{stateSummary.label}</span><h2 id="ghost-core-heading">{coreHeadline}</h2><p>{coreMessage}</p><small>{stateSummary.reason}</small></div>
          <dl className="observatory-facts">
            <div className="primary-fact"><dt>READINESS NOW</dt><dd>{ready} of {conditionCount} conditions ready</dd></div>
            <div><dt>CAPITAL SET ASIDE</dt><dd>{ghost.reservation ? `${quantity.format(Number(ghost.reservation.amount))} ${ghost.reservation.asset}` : "Nothing reserved"}</dd></div>
            <div><dt>ACTION IF READY</dt><dd>{ghost.side} {ghost.amountType === "USDC" ? `${quantity.format(Number(ghost.amount))} USDC` : `${quantity.format(Number(ghost.amount))}% of SOL`}</dd></div>
            <div><dt>DEADLINE</dt><dd>{dateTime(ghost.expiresAt)}</dd></div>
          </dl>
        </aside>
        <div className="detail-scene-stage">
          <GhostCoreScene conditions={sceneConditions} blocked={dataPaused || ghost.status === "FAILED"} lifecycleStage={inspectionStage} status={viewingHistory ? inspectedStatus : ghost.status} />
          <div className="scene-state"><span>{viewingHistory ? "VIEWING REACHED STATE" : dataPaused ? "SAFETY PAUSE" : "CURRENT STATE"}</span><b>{viewingHistory ? inspectedStatus : ghost.status}</b></div>
          <div className="scene-frame"><Database size={15} /><span>FRAME {frame.id.slice(0, 8)}</span><b>{frame.completeness}</b></div>
        </div>
      </section>

      {framePredatesArm && <section className="prearm-frame-notice" role="status"><ClockCounterClockwise size={22} /><div><b>This qualifying frame is older than the armed order</b><p>This trigger will never execute against evidence captured before you started watching.</p></div><button onClick={advanceFrame} disabled={advancingFrame}>{advancingFrame ? "CHECKING..." : "CHECK FRESH DEMO FRAME"}<ArrowRight size={16} /></button></section>}

      <section className="lifecycle-inspector" aria-labelledby="lifecycle-heading">
        <div><span className="eyebrow">LIFECYCLE</span><h2 id="lifecycle-heading">Inspect the journey</h2><p>Move back through every state this trigger has actually reached.</p></div>
        <div className="lifecycle-control">
          <input aria-label="Inspect trigger lifecycle" type="range" min="0" max={actualStage} step="1" value={inspectionStage} onChange={(event) => setInspectionStage(Number(event.target.value))} />
          <div className="lifecycle-stages">{detailLifecycle.map((status, index) => <button className={`${index <= actualStage ? "reached" : ""} ${index === inspectionStage ? "selected" : ""}`} disabled={index > actualStage} aria-pressed={index === inspectionStage} key={status} onClick={() => setInspectionStage(index)}><i>{index < actualStage ? <Check size={12} /> : index + 1}</i><span>{status}</span></button>)}</div>
          <small>{viewingHistory ? `Viewing ${inspectedStatus}. Actual status is ${ghost.status}.` : `Showing the current stored status: ${ghost.status}.`}</small>
        </div>
      </section>

      <section className="detail-evidence-summary" aria-label="Stored trigger evidence">
        <div><span>CONDITIONS</span><b>{ready}/{conditionCount} stored</b><small>current evaluation state</small></div>
        <div><span>MARKET FRAME</span><b>{frame.completeness}</b><small>{frame.executionEligible ? "execution eligible" : "view only"}</small></div>
        <div><span>CAPITAL</span><b>{ghost.reservation?.status ?? "NOT RESERVED"}</b><small>{ghost.reservation ? `${quantity.format(Number(ghost.reservation.amount))} ${ghost.reservation.asset}` : "no capital controlled"}</small></div>
        <div><span>SETTLEMENT</span><b>{settlementEvidence}</b><small>{ghost.status === "FILLED" ? "immutable simulated receipt" : "owned balances unchanged unless filled"}</small></div>
      </section>

      <div className="detail-grid">
        <section className="detail-main">
          <div className="observation-panel">
            <div className="observation-heading"><div><span className="eyebrow">EXACT OBSERVATIONS</span><h2>The frame this trigger can prove</h2><p>Each value, target, provider, and timestamp comes from the stored evaluation frame.</p></div><div><span>{frame.mode} DATA</span><b>{frame.executionEligible ? "EXECUTION ELIGIBLE" : "VIEW ONLY"}</b></div></div>
            <div className="observation-table" role="table" aria-label="Exact condition observations">
              {ghost.evaluations.map((evaluation) => { const observation = frame.observations[evaluation.metric]; return <div className={evaluation.satisfied ? "ready" : ""} role="row" key={evaluation.metric}><span className="observation-state" role="cell">{evaluation.satisfied ? <CheckCircle size={19} weight="fill" /> : <Pulse size={19} />}</span><div role="cell"><small>CONDITION</small><b>{metricLabels[evaluation.metric]}</b></div><div role="cell"><small>OBSERVED</small><b>{formatMetric(evaluation.metric, evaluation.current)}</b></div><div role="cell"><small>TARGET</small><b>{evaluation.operator === "GTE" ? "AT LEAST" : "AT MOST"} {formatMetric(evaluation.metric, evaluation.target)}</b></div><div role="cell"><small>PROVIDER</small><b>{providerLabel(observation.provider)}</b></div><div role="cell"><small>SOURCE TIME</small><b>{dateTime(observation.sourceTimestamp ?? observation.receivedAt)}</b></div></div>; })}
            </div>
            <details className="frame-details"><summary><BracketsCurly size={17} />VIEW FRAME IDENTIFIERS</summary><dl><div><dt>Frame ID</dt><dd>{frame.id}</dd></div><div><dt>Assembled</dt><dd>{dateTime(frame.assembledAt)}</dd></div><div><dt>Completeness</dt><dd>{frame.completeness}</dd></div><div><dt>Execution eligible</dt><dd>{frame.executionEligible ? "YES" : "NO"}</dd></div></dl></details>
          </div>
          {ghost.execution && <section className="detail-proof"><div className="proof-heading"><span className="eyebrow">SETTLEMENT PROOF</span><h2>One action, fully accounted for</h2><p>The receipt binds the qualifying frame to the quote, reservation, and immutable ledger transaction.</p></div><Receipt execution={{ ...ghost.execution, ghost_name: ghost.name } as Execution} /></section>}
        </section>
        <aside className="detail-side">
          <div className="terms-panel"><span className="eyebrow">CONTROLLED CAPITAL</span><div><span>Reservation status</span><b>{ghost.reservation?.status ?? "NOT RESERVED"}</b></div><div><span>Reservation ID</span><b>{ghost.reservation?.id ? ghost.reservation.id.slice(0, 12) : "NONE"}</b></div><div><span>Data mode</span><b>{frame.mode === "DEMO" ? "DEMO FEED" : "LIVE DATA"}</b></div><div><span>Frame state</span><b>{frame.completeness}</b></div><div><span>Execution mode</span><b>SIMULATED</b></div></div>
          <div className="timeline-panel"><span className="eyebrow">WHAT HAPPENED</span>{ghost.activities?.map((activity) => <div className="timeline-item" key={activity.id}><i /><div><b>{activity.type.replaceAll("_", " ")}</b><p>{activity.message}</p><small>{dateTime(activity.created_at)}</small></div></div>)}</div>
        </aside>
      </div>
    </main>
  );
}

function OnboardingPanel({ view, close }: { view: AppView; close: () => void }) {
  const guide = onboardingByView[view];
  return <motion.aside id="onboarding-panel" className="onboarding-panel" role="dialog" aria-modal="true" aria-labelledby="onboarding-title" initial={{ x: 32, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 32, opacity: 0 }}>
    <div className="onboarding-heading"><div><span>NEW HERE?</span><h2 id="onboarding-title">{guide.title}</h2></div><button className="icon-button" title="Close guide" onClick={close}><X size={18} /></button></div>
    <p>{guide.intro}</p>
    <ol>{guide.steps.map((step, index) => <li key={step}><i>{index + 1}</i><span>{step}</span></li>)}</ol>
    <div className="onboarding-boundary"><ShieldCheck size={18} /><span><b>Simulation stays in your control</b><small>Help never creates, starts, stops, or changes a trigger.</small></span></div>
    {view !== "discover" && <a href="/discover">LEARN WITH A STRATEGY<ArrowRight size={15} /></a>}
  </motion.aside>;
}

function LoadingView() {
  return <div className="loading-shell" role="status" aria-label="Loading Triggerlane workspace" aria-busy="true"><div className="loading-app-header"><i /><span /><span /><span /></div><div className="loading-workspace"><aside><i className="loading-balance" /><i /><i /><i /></aside><main><div className="loading-market"><i /><i /></div><div className="loading-chart" /><div className="loading-conditions"><i /><i /><i /></div></main><aside><i /><i className="loading-textarea" /><i /><i /></aside></div></div>;
}

export function GhostApp({ view, ghostId }: { view: AppView; ghostId?: string }) {
  const queryClient = useQueryClient();
  const [sessionReady, setSessionReady] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [connectionsOpen, setConnectionsOpen] = useState(false);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [bootError, setBootError] = useState<string | null>(null);

  useEffect(() => {
    api("/api/session/anonymous", { method: "POST" }).then(() => setSessionReady(true)).catch((error) => setBootError(error instanceof Error ? error.message : "Simulation could not start."));
  }, []);
  const workspaceQuery = useQuery({ queryKey: ["workspace"], queryFn: () => api<Workspace>("/api/workspace"), enabled: sessionReady });
  const workspace = workspaceQuery.data;
  const liveQuery = useQuery({ queryKey: ["live-market"], queryFn: () => api<LiveMarket>("/api/live-market"), enabled: workspace?.portfolio.dataMode === "LIVE", refetchInterval: 5000 });
  const diagnosticsQuery = useQuery({ queryKey: ["diagnostics"], queryFn: () => api<Diagnostics>("/health/diagnostics"), enabled: Boolean(workspace), refetchInterval: 5000 });
  const capabilitiesQuery = useQuery({ queryKey: ["capabilities"], queryFn: () => api<RuntimeCapabilities>("/api/capabilities") });

  useEffect(() => {
    if (!sessionReady) return;
    const stream = new EventSource(`${API_URL}/api/events`, { withCredentials: true });
    stream.onmessage = (event) => {
      const payload = JSON.parse(event.data) as { type: string };
      if (!["heartbeat", "connected"].includes(payload.type)) void queryClient.invalidateQueries({ queryKey: ["workspace"] });
    };
    return () => stream.close();
  }, [queryClient, sessionReady]);

  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") { setConnectionsOpen(false); setAccountOpen(false); setOnboardingOpen(false); } };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, []);

  const setMode = useMutation({ mutationFn: (mode: "DEMO" | "LIVE") => api<Workspace>("/api/data-mode", { method: "POST", body: JSON.stringify({ mode }) }), onSuccess: (data) => queryClient.setQueryData(["workspace"], data) });
  const clearSession = useMutation({ mutationFn: () => api("/api/session", { method: "DELETE" }), onSuccess: () => window.location.reload() });

  const fatalMessage = bootError ?? (workspaceQuery.error instanceof Error ? workspaceQuery.error.message : null);
  if (fatalMessage) return <div className="fatal-state" role="alert"><BrandIcon size={44} /><span className="eyebrow">WORKSPACE CONNECTION FAILED</span><h1>Simulation unavailable</h1><p>{fatalMessage}</p><div className="capital-safe"><ShieldCheck size={17} /><span><b>No capital was moved.</b> Your saved Simulation remains unchanged.</span></div><button onClick={() => window.location.reload()}>RETRY CONNECTION</button></div>;
  if (!workspace) return <LoadingView />;
  const modeIsLive = workspace.portfolio.dataMode === "LIVE";
  const capabilities = capabilitiesQuery.data ?? { environment: "development", executionMode: "SANDBOX", features: { aiComposer: true, replay: true, multiStage: false, rialo: false, demoFeed: true, advancedConditions: false } };
  const sourceAge = modeIsLive && liveQuery.data ? Math.max(0, (Date.now() - new Date(liveQuery.data.receivedAt).getTime()) / 1000).toFixed(1) : Math.max(0, (Date.now() - new Date(workspace.frame.assembledAt).getTime()) / 1000).toFixed(0);
  const provider = providerLabel(modeIsLive ? liveQuery.data?.provider ?? "Hyperliquid" : workspace.frame.observations.PRICE.provider);
  const feedStatus = liveQuery.isError ? "UNAVAILABLE" : modeIsLive ? "MONITORING ONLY" : "CONNECTED";
  const sourceTime = modeIsLive ? "SOURCE TIME UNAVAILABLE" : dateTime(workspace.frame.observations.PRICE.sourceTimestamp ?? workspace.frame.observations.PRICE.receivedAt);
  const engineStatus = diagnosticsQuery.data?.workerLease.active ? "OPERATIONAL" : diagnosticsQuery.data ? "RECONNECTING" : "CHECKING";

  return (
    <AppShell>
      <header className="app-header">
        <Logo />
        <nav><a className={view === "trade" ? "active" : ""} href="/trade">Trade</a><a className={view === "ghosts" || view === "detail" ? "active" : ""} href="/ghosts">Triggers<span>{workspace.ghosts.filter((ghost) => ghost.status === "WATCHING").length || ""}</span></a><a className={view === "portfolio" ? "active" : ""} href="/portfolio">Portfolio</a><a className={view === "history" ? "active" : ""} href="/history">History</a><a className={view === "discover" ? "active" : ""} href="/discover">Discover</a></nav>
        <div className="header-tools">
          <button className={`environment-button ${modeIsLive ? "monitoring" : ""}`} aria-label={`Open ${modeIsLive ? "Live monitoring" : "Simulation"} settings`} aria-expanded={connectionsOpen} aria-controls="simulation-popover" onClick={() => { setConnectionsOpen((value) => !value); setAccountOpen(false); setOnboardingOpen(false); }}><i /><span>{modeIsLive ? "LIVE MONITORING" : "SIMULATION"}</span><CaretRight size={14} /></button>
          <button className="account-button" aria-label="Open account" aria-expanded={accountOpen} aria-controls="account-popover" onClick={() => { setAccountOpen((value) => !value); setConnectionsOpen(false); setOnboardingOpen(false); }}><UserCircle size={17} /><span className="account-label">ACCOUNT</span><CaretRight size={14} /></button>
        </div>
      </header>
      <AnimatePresence>{(connectionsOpen || accountOpen) && <motion.button className="menu-backdrop" aria-label="Close open menu" onClick={() => { setConnectionsOpen(false); setAccountOpen(false); }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />}</AnimatePresence>
      <AnimatePresence>{onboardingOpen && <><motion.button className="drawer-backdrop onboarding-backdrop" aria-label="Close beginner guide" onClick={() => setOnboardingOpen(false)} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} /><OnboardingPanel view={view} close={() => setOnboardingOpen(false)} /></>}</AnimatePresence>
      <AnimatePresence>{connectionsOpen && <motion.div id="simulation-popover" className="popover simulation-menu" role="dialog" aria-modal="false" aria-label="Simulation and data settings" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}>
        <div className="simulation-menu-heading"><div><span className="eyebrow">ENVIRONMENT</span><strong>{modeIsLive ? "Live monitoring" : "Simulation"}</strong></div><span className={modeIsLive ? "monitoring" : "eligible"}>{modeIsLive ? "VIEW ONLY" : "EXECUTION ELIGIBLE"}</span></div>
        <div className="simulation-mode-switch" role="group" aria-label="Market data mode"><button aria-pressed={!modeIsLive} className={!modeIsLive ? "active" : ""} onClick={() => setMode.mutate("DEMO")}>SIMULATION</button><button aria-pressed={modeIsLive} className={modeIsLive ? "active" : ""} onClick={() => setMode.mutate("LIVE")}>LIVE DATA</button></div>
        {modeIsLive && <div className="simulation-warning"><Warning size={16} /><span><b>Monitoring only</b><small>Live observations cannot execute or settle simulated capital.</small></span></div>}
        <dl className="simulation-summary"><div><dt>Feed</dt><dd>{feedStatus}</dd></div><div><dt>Source</dt><dd>{provider}</dd></div><div><dt>Freshness</dt><dd>{sourceAge}s ago</dd></div><div><dt>Frame</dt><dd>{workspace.frame.completeness}</dd></div></dl>
        <details className="simulation-details"><summary>CONNECTION DETAILS<CaretRight size={14} /></summary><div><span><Broadcast size={15} />Price and funding</span><b>{provider} · {sourceTime}</b></div><div><span><BrandIcon size={15} />Trigger engine</span><b>{engineStatus} · {diagnosticsQuery.data?.outboxPending ?? 0} pending</b></div><div><span><Lightning size={15} />Execution</span><b>{modeIsLive ? "DISABLED" : "SIMULATED · AVAILABLE"}</b></div><p>Rialo remains unavailable and is not reported as connected.</p></details>
      </motion.div>}</AnimatePresence>
      <AnimatePresence>{accountOpen && <motion.div id="account-popover" className="popover account" role="dialog" aria-modal="false" aria-label="Account" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}><span className="eyebrow">ACCOUNT</span><strong>{workspace.identity.label}</strong><small>{workspace.identity.id.slice(0, 18)}...</small><div className="account-balances"><span>USDC <b>{quantity.format(Number(workspace.portfolio.balances.USDC.quantity))}</b></span><span>SOL <b>{quantity.format(Number(workspace.portfolio.balances.SOL.quantity))}</b></span></div><button onClick={() => { setAccountOpen(false); setOnboardingOpen(true); }}><Sparkle size={16} />NEW HERE?</button><button className="account-danger" onClick={() => clearSession.mutate()}><Power size={16} />CLEAR SESSION</button></motion.div>}</AnimatePresence>
      {view === "trade" && <TradeView workspace={workspace} live={liveQuery.data} capabilities={capabilities} />}
      {view === "ghosts" && <GhostsView workspace={workspace} />}
      {view === "portfolio" && <PortfolioView workspace={workspace} />}
      {view === "history" && <HistoryView workspace={workspace} />}
      {view === "discover" && <DiscoverView workspace={workspace} />}
      {view === "detail" && ghostId && <DetailView workspace={workspace} ghostId={ghostId} />}
      <nav className="mobile-nav" aria-label="Mobile navigation"><a className={view === "trade" ? "active" : ""} href="/trade"><ChartLineUp size={18} />Trade</a><a className={view === "ghosts" || view === "detail" ? "active" : ""} href="/ghosts"><BrandIcon size={18} />Triggers</a><a className={view === "portfolio" ? "active" : ""} href="/portfolio"><Pulse size={18} />Portfolio</a><a className={view === "discover" ? "active" : ""} href="/discover"><SlidersHorizontal size={18} />Discover</a><button onClick={() => { setAccountOpen(true); setConnectionsOpen(false); }}><UserCircle size={18} />Account</button></nav>
      <SandboxDisclaimer />
      <footer className="system-footer"><span><i className={modeIsLive ? "amber" : "green"} />{modeIsLive ? "LIVE DATA · MONITORING ONLY" : "DEMO FEED · EXECUTION ELIGIBLE"}</span><span>SOL/USDC</span><span>FRAME {workspace.frame.id.slice(0, 8)}</span><span>{capabilities.environment.toUpperCase()}</span><span className="rialo-footer"><BrandIcon size={13} />RIALO TARGET · {capabilities.features.rialo ? "CONFIGURED" : "NOT CONFIGURED"}</span></footer>
    </AppShell>
  );
}
