"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import { useEffect, useReducer, useState } from "react";
import { evaluateCondition, fundingAprPercent, modeledSlippageBps, roundToHalfDollar, type GhostDraft, type MarketView, type Metric } from "@ghost/domain";
import { api } from "@/lib/api";
import { amount, conditionChip, fundingApr, fundingHourly, metricLabel, operatorLabel, percent, timeLeft, usd } from "@/lib/format";
import type { StrategyCatalog, Trigger, Workspace } from "@/lib/types";
import { isTerminal } from "@/lib/types";
import { useLiveEvents } from "@/lib/use-live-events";
import { AppShell } from "@/components/app-shell";
import { Card, Chip, PrimaryButton, Row, ScrollRail, SecondaryButton, Segmented, Stat, StatStrip, ui } from "@/components/ui";

/*
 * The charting library is a canvas renderer with no server rendering to do, and
 * it is the heaviest thing this screen would otherwise pull into its first
 * load. Loading it on its own keeps it out of the initial bundle.
 */
const MarketChart = dynamic(() => import("@/components/market-chart").then((module) => module.MarketChart), {
  ssr: false,
  loading: () => (
    <div style={{ height: "100%", display: "grid", placeItems: "center", color: "var(--muted)", fontSize: "var(--type-caption)" }}>
      Loading price history…
    </div>
  ),
});

const TRIGGER_COLUMNS = "1.6fr 2.4fr 0.9fr 1fr 0.7fr 0.9fr";
const targetInputStyle = { height: 34, padding: "0 8px", textAlign: "right", color: "var(--text)", background: "var(--panel)", border: "1px solid var(--line-strong)", borderRadius: "var(--radius)", fontSize: 12 } as const;

// Fixed digits, then trailing zeros dropped, so a tiny ratio never becomes "5e-7".
const trimmed = (value: number, digits: number) => value.toFixed(digits).replace(/\.?0+$/, "");
const ratioToPercent = (ratio: string) => trimmed(Number(ratio) * 100, 8);
const percentToRatio = (percent: string) => trimmed(Number(percent) / 100, 10);
const isNumber = (text: string) => text.trim() !== "" && Number.isFinite(Number(text));

/*
 * Funding and P&L are stored as ratios and typed as percents. Converting on
 * every keystroke threw away half-typed values like "0." or "-", so this keeps
 * the text as typed and only saves it once it reads as a number.
 */
function PercentTargetInput({ label, ratio, onChange }: { label: string; ratio: string; onChange: (ratio: string) => void }) {
  const [text, setText] = useState(() => ratioToPercent(ratio));
  const [seen, setSeen] = useState(ratio);

  // A new target from outside, such as an idea being applied, replaces the text.
  if (ratio !== seen) {
    setSeen(ratio);
    if (!isNumber(text) || percentToRatio(text) !== percentToRatio(ratioToPercent(ratio))) setText(ratioToPercent(ratio));
  }

  return (
    <input
      className={ui.mono}
      aria-label={label}
      value={text}
      inputMode="decimal"
      onChange={(event) => {
        setText(event.target.value);
        if (isNumber(event.target.value)) onChange(percentToRatio(event.target.value));
      }}
      // Leaving the box with something unusable shows the target that is actually set.
      onBlur={() => { if (!isNumber(text)) setText(ratioToPercent(ratio)); }}
      style={targetInputStyle}
    />
  );
}
const conditionOrder: Metric[] = ["PRICE", "FUNDING", "PNL"];

type Draft = GhostDraft;
type Action =
  | { type: "side"; side: "BUY" | "SELL" }
  | { type: "field"; field: "name" | "amount"; value: string }
  | { type: "condition"; metric: Metric; field: "operator" | "target"; value: string }
  | { type: "add"; metric: Metric }
  | { type: "remove"; metric: Metric }
  | { type: "load"; draft: Draft };

const defaults: Record<Metric, Draft["conditions"][number]> = {
  PRICE: { metric: "PRICE", operator: "LTE", target: "178" },
  FUNDING: { metric: "FUNDING", operator: "GTE", target: "0.00002" },
  PNL: { metric: "PNL", operator: "GTE", target: "0.1" },
};

const initial: Draft = {
  name: "SOL entry",
  side: "BUY",
  amount: "1000",
  amountType: "USDC",
  maxSlippageBps: 60,
  expiresInHours: 24,
  conditions: [{ ...defaults.PRICE }],
};

function reducer(state: Draft, action: Action): Draft {
  // A strategy arrives as a whole draft. Replaying it through the other actions
  // would fight them: choosing a side resets the amount and the name.
  if (action.type === "load") {
    return {
      ...action.draft,
      conditions: [...action.draft.conditions].sort(
        (left, right) => conditionOrder.indexOf(left.metric) - conditionOrder.indexOf(right.metric),
      ),
    };
  }
  if (action.type === "side") {
    return {
      ...state,
      side: action.side,
      amountType: action.side === "BUY" ? "USDC" : "POSITION_PERCENT",
      amount: action.side === "BUY" ? "1000" : "25",
      name: action.side === "BUY" ? "SOL entry" : "SOL exit",
    };
  }
  if (action.type === "field") return { ...state, [action.field]: action.value } as Draft;
  if (action.type === "add") {
    if (state.conditions.some((condition) => condition.metric === action.metric)) return state;
    return {
      ...state,
      conditions: [...state.conditions, { ...defaults[action.metric] }].sort(
        (left, right) => conditionOrder.indexOf(left.metric) - conditionOrder.indexOf(right.metric),
      ),
    };
  }
  if (action.type === "remove") {
    if (state.conditions.length === 1) return state;
    return { ...state, conditions: state.conditions.filter((condition) => condition.metric !== action.metric) };
  }
  return {
    ...state,
    conditions: state.conditions.map((condition) =>
      condition.metric === action.metric ? { ...condition, [action.field]: action.value } : condition,
    ),
  };
}

export function TradeScreen() {
  const queryClient = useQueryClient();
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, dispatch] = useReducer(reducer, initial);
  const [loaded, setLoaded] = useState<string | null>(null);
  // The starting price target is only a default until the trader edits it, so
  // it is aimed at the market once, not on every tick.
  const [aimed, setAimed] = useState(false);

  // Ideas hands a strategy over as ?strategy=<id>. Load its draft once, then
  // drop the parameter so a refresh does not silently overwrite later edits.
  useEffect(() => {
    if (!ready) return;
    const id = new URLSearchParams(window.location.search).get("strategy");
    if (!id) return;
    let cancelled = false;
    api<StrategyCatalog>("/api/strategies")
      .then((catalog) => {
        if (cancelled) return;
        const strategy = catalog.strategies.find((item) => item.id === id);
        if (!strategy) return;
        dispatch({ type: "load", draft: strategy.draft });
        setLoaded(strategy.name);
        window.history.replaceState({}, "", "/trade");
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [ready]);

  const clearStrategy = () => {
    dispatch({ type: "load", draft: initial });
    setLoaded(null);
    setAimed(false);
  };

  useEffect(() => {
    api<{ expiresAt: string }>("/api/session/anonymous", { method: "POST", body: JSON.stringify({ initialMode: "LIVE" }) })
      .then(() => setReady(true))
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "Paper account could not start."));
  }, []);

  useLiveEvents(ready);

  const workspaceQuery = useQuery({ queryKey: ["workspace"], queryFn: () => api<Workspace>("/api/workspace"), enabled: ready });
  const workspace = workspaceQuery.data;
  const marketQuery = useQuery({
    queryKey: ["market-view", workspace?.portfolio.dataMode],
    queryFn: () => api<MarketView>("/api/market-view?interval=1m"),
    enabled: Boolean(workspace),
    refetchInterval: 30_000,
  });

  const place = useMutation({
    mutationFn: async () => {
      const created = await api<Trigger>("/api/ghosts", { method: "POST", body: JSON.stringify(draft) });
      return api<Trigger>(`/api/ghosts/${created.id}/arm`, { method: "POST" });
    },
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ["workspace"] });
    },
    onError: (caught: unknown) => setError(caught instanceof Error ? caught.message : "The trigger could not be placed."),
  });

  /*
   * Aim a fresh draft at the market, once. A price target written against a
   * different market is either already true or unreachable, which is exactly
   * how the idea catalogue broke; the composer's own $178 default had the same
   * problem. The offset keeps it on the reachable side of the operator, since a
   * target sitting exactly at the market is satisfied the moment it is placed.
   *
   * This reads the queries rather than the derived price below, because the
   * dependency array is evaluated during render and that value does not exist
   * yet at this point in the body.
   */
  useEffect(() => {
    if (aimed || loaded) return;
    if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("strategy")) return;
    const current = Number(marketQuery.data?.price.value ?? workspaceQuery.data?.frame.observations.PRICE.value ?? 0);
    if (!Number.isFinite(current) || current <= 0) return;

    const sol = Number(workspaceQuery.data?.portfolio.balances.SOL.quantity ?? 0);
    const notionalNow = draft.side === "BUY" ? Number(draft.amount) : (sol * Number(draft.amount)) / 100 * current;
    const estimate = notionalNow > 0 ? modeledSlippageBps(notionalNow) : 0;

    dispatch({
      type: "load",
      draft: {
        ...draft,
        // A limit under the modeled impact qualifies and then never settles.
        maxSlippageBps: Math.min(500, Math.max(50, estimate + 10)),
        conditions: draft.conditions.map((condition) =>
          condition.metric === "PRICE"
            ? { ...condition, target: roundToHalfDollar(current * (condition.operator === "LTE" ? 0.98 : 1.02)) }
            : condition,
        ),
      },
    });
    setAimed(true);
  }, [aimed, loaded, draft, marketQuery.data, workspaceQuery.data]);

  if (error && !workspace) return <main style={{ padding: 40 }}><p className={ui.down}>{error}</p></main>;
  if (!workspace) return <main style={{ padding: 40 }}><p className={ui.muted}>Loading workspace…</p></main>;

  const market = marketQuery.data;
  const observations = workspace.frame.observations;
  const price = market?.price.value ?? observations.PRICE.value;
  const funding = market?.funding.value ?? observations.FUNDING.value;
  const open = workspace.ghosts.filter((trigger) => !isTerminal(trigger.status));

  const free = draft.side === "BUY" ? workspace.portfolio.balances.USDC.available : workspace.portfolio.balances.SOL.available;
  const committed = draft.side === "BUY"
    ? Number(draft.amount)
    : Number(workspace.portfolio.balances.SOL.quantity) * Number(draft.amount) / 100;
  const notional = draft.side === "BUY" ? committed : committed * Number(price);
  const estimatedBps = committed > 0 ? modeledSlippageBps(notional) : 0;
  const affordable = committed > 0 && committed <= Number(free);
  const previews = draft.conditions.map((condition) => evaluateCondition(condition, observations[condition.metric].value));

  const equity = Number(workspace.portfolio.balances.USDC.quantity) + Number(workspace.portfolio.balances.SOL.quantity) * Number(price);

  return (
    <AppShell active="trade" equity={equity}>
      <StatStrip height={64}>
        <div className={ui.stat}>
          <h1 className={ui.statValue} style={{ margin: 0 }}>SOL-PERP</h1>
          <span className={ui.statLabel}>{workspace.portfolio.dataMode === "LIVE" ? "Hyperliquid mark" : "Guided scenario"}</span>
        </div>
        <span className={`${ui.mono} ${ui.up}`} style={{ fontSize: 22, fontWeight: 600 }}>{usd(price)}</span>
        <Stat label="24h change" value={percent(market?.change.value, 2)} tone={Number(market?.change.value ?? 0) >= 0 ? "up" : "down"} />
        <Stat label="Funding" value={<>{fundingHourly(funding)} <span className={ui.muted}>{fundingApr(funding)}</span></>} />
        <Stat label="Feed" value={market?.status === "FRESH" ? "live" : market?.status?.toLowerCase() ?? "loading"} />
      </StatStrip>

      <div style={{ flexGrow: 1, display: "flex", minHeight: 0 }}>
        <section style={{ flexGrow: 1, display: "flex", flexDirection: "column", minWidth: 0, borderRight: "1px solid var(--line)" }}>
          <div style={{ flexGrow: 1, minHeight: 0, position: "relative" }}>
            <MarketChart points={market?.history.points ?? []} status={market?.status ?? "LOADING"} />
          </div>

          <div style={{ flexShrink: 0, borderTop: "1px solid var(--line)" }}>
            <Row columns={TRIGGER_COLUMNS} head>
              <span>Trigger</span><span>Conditions</span><span>Size</span><span>To trigger</span><span>Expires</span>
              <span style={{ textAlign: "right" }}>Actions</span>
            </Row>
            {open.length === 0 && (
              <Row columns="1fr"><span className={ui.muted}>No open triggers. The order panel places one.</span></Row>
            )}
            {open.map((trigger) => {
              const readiness = trigger.evaluations.filter((evaluation) => !evaluation.satisfied).sort((a, b) => Number(a.distanceRatio) - Number(b.distanceRatio))[0];
              return (
                <Row key={trigger.id} columns={TRIGGER_COLUMNS}>
                  <span>
                    <span className={trigger.side === "BUY" ? ui.up : ui.down} style={{ fontWeight: 600 }}>{trigger.side === "BUY" ? "Buy" : "Sell"}</span>{" "}
                    {trigger.amountType === "USDC" ? `${amount(trigger.amount)} USDC` : `${amount(trigger.amount)}% of SOL`}
                  </span>
                  <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {trigger.evaluations.map((evaluation) => (
                      <Chip key={evaluation.metric} met={evaluation.satisfied}>
                        {conditionChip(evaluation.metric, evaluation.operator, evaluation.target)}{evaluation.satisfied ? " met" : ""}
                      </Chip>
                    ))}
                  </span>
                  <span className={ui.mono}>{trigger.reservation ? `${amount(trigger.reservation.amount)} ${trigger.reservation.asset}` : "--"}</span>
                  <span className={ui.mono}>{readiness ? percent(readiness.distanceRatio, 1).replace("+", "") : "ready"}</span>
                  <span className={`${ui.mono} ${ui.muted}`}>{timeLeft(trigger.expiresAt)}</span>
                  <span className={ui.muted} style={{ textAlign: "right" }}>{trigger.status.toLowerCase()}</span>
                </Row>
              );
            })}
          </div>
        </section>

        <ScrollRail
          header={
            <Segmented
              label="Order side"
              value={draft.side}
              onChange={(side) => dispatch({ type: "side", side })}
              options={[{ value: "BUY", label: "Buy", tone: "buy" }, { value: "SELL", label: "Sell", tone: "sell" }]}
            />
          }
          footer={
            <>
              <PrimaryButton onClick={() => place.mutate()} disabled={place.isPending || !affordable}>
                {place.isPending ? "Placing…" : `Place ${draft.side.toLowerCase()} trigger`}
              </PrimaryButton>
              {error && <span className={`${ui.down}`} style={{ fontSize: "var(--type-caption)" }}>{error}</span>}
            </>
          }
        >
          {loaded && (
            <Card
              title="From Ideas"
              aside={
                <button
                  type="button"
                  className={ui.muted}
                  onClick={clearStrategy}
                  style={{ padding: 0, background: "transparent", border: 0, fontSize: 11, cursor: "pointer" }}
                >
                  Clear
                </button>
              }
            >
              <span style={{ fontWeight: 600 }}>{loaded}</span>
              <span className={ui.muted} style={{ fontSize: 11 }}>Nothing is placed until you place it.</span>
            </Card>
          )}

          <Card title="Trigger name">
            <input
              aria-label="Trigger name"
              value={draft.name}
              onChange={(event) => dispatch({ type: "field", field: "name", value: event.target.value })}
              style={{ width: "100%", padding: 0, color: "var(--text)", background: "transparent", border: 0, fontSize: 14 }}
            />
          </Card>

          <Card title="Amount" aside={<span className={`${ui.mono} ${ui.muted}`} style={{ fontSize: 11 }}>{draft.side === "BUY" ? "USDC" : "% of SOL"}</span>} focused>
            <input
              className={ui.mono}
              aria-label="Amount"
              value={draft.amount}
              inputMode="decimal"
              onChange={(event) => dispatch({ type: "field", field: "amount", value: event.target.value })}
              style={{ width: "100%", padding: 0, color: "var(--text)", background: "transparent", border: 0, fontSize: 28, fontWeight: 600 }}
            />
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
              <span className={`${ui.mono} ${ui.muted}`}>{draft.side === "BUY" ? `${amount(committed)} USDC` : `${amount(committed)} SOL`}</span>
              <span className={`${ui.mono} ${ui.muted}`}>{amount(free)} free</span>
            </div>
            {!affordable && <span className={`${ui.warn}`} style={{ fontSize: 11 }}>More than the free balance.</span>}
          </Card>

          <Card title="Trigger when all are true" aside={<span className={`${ui.mono} ${ui.muted}`} style={{ fontSize: 11 }}>{previews.filter((preview) => preview.satisfied).length} of {previews.length} now</span>}>
            {draft.conditions.map((condition) => (
              <div key={condition.metric} style={{ display: "grid", gridTemplateColumns: "1fr 80px 92px", gap: 4, alignItems: "center" }}>
                <span style={{ fontSize: 12 }}>{metricLabel[condition.metric]}</span>
                <select
                  aria-label={`${condition.metric} operator`}
                  value={condition.operator}
                  onChange={(event) => dispatch({ type: "condition", metric: condition.metric, field: "operator", value: event.target.value })}
                  style={{ height: 34, padding: "0 8px", color: "var(--text)", background: "var(--panel)", border: "1px solid var(--line-strong)", borderRadius: "var(--radius)", fontSize: 12 }}
                >
                  <option value="GTE">{operatorLabel.GTE}</option>
                  <option value="LTE">{operatorLabel.LTE}</option>
                </select>
                {condition.metric === "PRICE" ? (
                  <input
                    className={ui.mono}
                    aria-label={`${condition.metric} target`}
                    value={condition.target}
                    inputMode="decimal"
                    onChange={(event) => dispatch({ type: "condition", metric: condition.metric, field: "target", value: event.target.value })}
                    style={targetInputStyle}
                  />
                ) : (
                  <PercentTargetInput
                    label={`${condition.metric} target`}
                    ratio={condition.target}
                    onChange={(target) => dispatch({ type: "condition", metric: condition.metric, field: "target", value: target })}
                  />
                )}
                {condition.metric === "FUNDING" && (
                  <span className={`${ui.mono} ${Math.abs(Number(fundingAprPercent(condition.target))) > 45 ? ui.warn : ui.muted}`} style={{ gridColumn: "2 / -1", fontSize: 11, textAlign: "right" }}>
                    {fundingApr(condition.target)}
                  </span>
                )}
              </div>
            ))}
            <div style={{ display: "flex", gap: 8 }}>
              {conditionOrder.filter((metric) => !draft.conditions.some((condition) => condition.metric === metric)).map((metric) => (
                <button key={metric} type="button" className={ui.accent} onClick={() => dispatch({ type: "add", metric })} style={{ padding: 0, background: "transparent", border: 0, fontSize: 12, cursor: "pointer" }}>
                  + {metricLabel[metric]}
                </button>
              ))}
              {draft.conditions.length > 1 && (
                <button type="button" className={ui.muted} onClick={() => dispatch({ type: "remove", metric: draft.conditions.at(-1)!.metric })} style={{ marginLeft: "auto", padding: 0, background: "transparent", border: 0, fontSize: 12, cursor: "pointer" }}>
                  Remove last
                </button>
              )}
            </div>
          </Card>

          <Card title="Order terms">
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
              <span className={ui.muted}>Price impact limit</span>
              <span className={ui.mono}>{(draft.maxSlippageBps / 100).toFixed(2)}% <span className={ui.muted}>est {(estimatedBps / 100).toFixed(2)}%</span></span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
              <span className={ui.muted}>Expires</span><span className={ui.mono}>{draft.expiresInHours}h</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
              <span className={ui.muted}>Fires</span><span className={ui.mono}>once, then finishes</span>
            </div>
            {estimatedBps > draft.maxSlippageBps && (
              <span className={ui.warn} style={{ fontSize: 11 }}>
                The limit is below the estimate, so this can qualify without settling.
              </span>
            )}
          </Card>

          <Card title="Position">
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
              <span className={ui.muted}>SOL held</span><span className={ui.mono}>{amount(workspace.portfolio.balances.SOL.quantity)}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
              <span className={ui.muted}>SOL locked</span><span className={ui.mono}>{amount(workspace.portfolio.balances.SOL.reserved)}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
              <span className={ui.muted}>USDC locked</span><span className={ui.mono}>{amount(workspace.portfolio.balances.USDC.reserved)}</span>
            </div>
          </Card>

        </ScrollRail>
      </div>
    </AppShell>
  );
}
