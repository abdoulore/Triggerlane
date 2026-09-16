"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useReducer, useState } from "react";
import { evaluateCondition, fundingAprPercent, modeledSlippageBps, type GhostDraft, type MarketView, type Metric } from "@ghost/domain";
import { api } from "@/lib/api";
import { amount, conditionChip, fundingApr, fundingHourly, metricLabel, operatorLabel, percent, timeLeft, usd } from "@/lib/format";
import type { Trigger, Workspace } from "@/lib/types";
import { isTerminal } from "@/lib/types";
import { useLiveEvents } from "@/lib/use-live-events";
import { Card, Chip, PrimaryButton, Row, ScrollRail, SecondaryButton, Segmented, Stat, StatStrip, ui } from "@/components/ui";

const TRIGGER_COLUMNS = "1.6fr 2.4fr 0.9fr 1fr 0.7fr 0.9fr";
const conditionOrder: Metric[] = ["PRICE", "FUNDING", "PNL"];

type Draft = GhostDraft;
type Action =
  | { type: "side"; side: "BUY" | "SELL" }
  | { type: "field"; field: "name" | "amount"; value: string }
  | { type: "condition"; metric: Metric; field: "operator" | "target"; value: string }
  | { type: "add"; metric: Metric }
  | { type: "remove"; metric: Metric };

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

  return (
    <main style={{ height: "100dvh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <StatStrip height={64}>
        <div className={ui.stat}>
          <span className={ui.statValue}>SOL-PERP</span>
          <span className={ui.statLabel}>{workspace.portfolio.dataMode === "LIVE" ? "Hyperliquid mark" : "Guided scenario"}</span>
        </div>
        <span className={`${ui.mono} ${ui.up}`} style={{ fontSize: 22, fontWeight: 600 }}>{usd(price)}</span>
        <Stat label="24h change" value={percent(market?.change.value, 2)} tone={Number(market?.change.value ?? 0) >= 0 ? "up" : "down"} />
        <Stat label="Funding" value={<>{fundingHourly(funding)} <span className={ui.muted}>{fundingApr(funding)}</span></>} />
        <Stat label="Feed" value={market?.status === "FRESH" ? "live" : market?.status?.toLowerCase() ?? "loading"} />
        <div style={{ flexGrow: 1 }} />
        <Stat label="Equity" value={usd(Number(workspace.portfolio.balances.USDC.quantity) + Number(workspace.portfolio.balances.SOL.quantity) * Number(price))} />
      </StatStrip>

      <div style={{ flexGrow: 1, display: "flex", minHeight: 0 }}>
        <section style={{ flexGrow: 1, display: "flex", flexDirection: "column", minWidth: 0, borderRight: "1px solid var(--line)" }}>
          <div style={{ flexGrow: 1, display: "grid", placeItems: "center", color: "var(--muted)", fontSize: "var(--type-label)" }}>
            Price chart
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
                <input
                  className={ui.mono}
                  aria-label={`${condition.metric} target`}
                  value={condition.metric === "PRICE" ? condition.target : String(Number(condition.target) * 100)}
                  onChange={(event) => {
                    const raw = event.target.value;
                    const target = condition.metric === "PRICE" ? raw : String(Number(raw) / 100);
                    dispatch({ type: "condition", metric: condition.metric, field: "target", value: target });
                  }}
                  style={{ height: 34, padding: "0 8px", textAlign: "right", color: "var(--text)", background: "var(--panel)", border: "1px solid var(--line-strong)", borderRadius: "var(--radius)", fontSize: 12 }}
                />
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

          <SecondaryButton onClick={() => dispatch({ type: "field", field: "name", value: draft.name })}>Save as draft</SecondaryButton>
        </ScrollRail>
      </div>
    </main>
  );
}
