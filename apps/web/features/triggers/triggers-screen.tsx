"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { amount, conditionChip, dateTime, metricLabel, percent, providerLabel, timeLeft, usd } from "@/lib/format";
import type { Execution, ExecutionAttempt, Trigger, Workspace } from "@/lib/types";
import { isTerminal } from "@/lib/types";
import { useLiveEvents } from "@/lib/use-live-events";
import { AppShell } from "@/components/app-shell";
import { Chip, Dialog, Row, SecondaryButton, Stat, StatStrip, ui } from "@/components/ui";

const COLUMNS = "1.5fr 2.2fr 0.8fr 0.9fr 0.8fr 0.7fr 0.8fr 0.9fr";
const FINISHED_COLUMNS = "1fr 1.4fr 2fr 1.4fr 1fr";

type Filter = "WATCHING" | "FINISHED";

/**
 * A finished trigger is one of three stored records, not one shape: a trade that
 * settled, an attempt stopped at settlement, or a trigger that ended without
 * executing. Each keeps its own evidence, so the list carries the record itself.
 */
type Outcome =
  | { key: string; kind: "receipt"; status: "FILLED"; name: string; at: string; execution: Execution; generation?: number }
  | { key: string; kind: "attempt"; status: "BLOCKED"; name: string; at: string; attempt: ExecutionAttempt }
  | { key: string; kind: "outcome"; status: string; name: string; at: string; trigger: Trigger };

/** Why this trigger is not trading, in the trader's terms. */
function stateLabel(trigger: Trigger): { text: string; tone?: "warn" | "muted" | "accent" } {
  if (trigger.status === "PAUSED" && trigger.pauseReason === "USER") return { text: "Paused", tone: "muted" };
  if (trigger.status === "PAUSED") return { text: "Market data stale", tone: "warn" };
  if (trigger.status === "WATCHING") return { text: "Watching", tone: "accent" };
  return { text: trigger.status.toLowerCase(), tone: "muted" };
}

/** What happened to the money, stated plainly. Wording kept from the old view. */
function outcomeStory(status: string): { headline: string; capital: string } {
  if (status === "FILLED") return { headline: "Settled, balances changed", capital: "Committed to ledger" };
  if (status === "BLOCKED") return { headline: "Stopped at settlement", capital: "Balances unchanged" };
  if (status === "CANCELLED") return { headline: "Stopped before it traded", capital: "Locked capital released" };
  if (status === "EXPIRED") return { headline: "Deadline passed", capital: "Locked capital released" };
  return { headline: "Settlement failed", capital: "Balances unchanged" };
}

function outcomeTone(status: string): "up" | "warn" | "muted" {
  if (status === "FILLED") return "up";
  if (status === "BLOCKED" || status === "FAILED") return "warn";
  return "muted";
}

/** `initialFilter` lets /ghosts?view=past open straight on the finished list. */
export function TriggersScreen({ initialFilter = "WATCHING" }: { initialFilter?: Filter } = {}) {
  const queryClient = useQueryClient();
  const [ready, setReady] = useState(false);
  const [filter, setFilter] = useState<Filter>(initialFilter);
  const [failed, setFailed] = useState<string | null>(null);
  const [opened, setOpened] = useState<string | null>(null);

  useEffect(() => {
    api("/api/session/anonymous", { method: "POST", body: JSON.stringify({ initialMode: "LIVE" }) })
      .then(() => setReady(true))
      .catch(() => setReady(true));
  }, []);

  useLiveEvents(ready);

  const workspaceQuery = useQuery({ queryKey: ["workspace"], queryFn: () => api<Workspace>("/api/workspace"), enabled: ready });
  const workspace = workspaceQuery.data;

  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "pause" | "resume" | "cancel" }) =>
      api(`/api/ghosts/${id}/${action}`, { method: "POST" }),
    onSuccess: () => {
      setFailed(null);
      void queryClient.invalidateQueries({ queryKey: ["workspace"] });
    },
    onError: (caught: unknown) => setFailed(caught instanceof Error ? caught.message : "That action did not complete."),
  });

  if (!workspace) return <main style={{ padding: 40 }}><p className={ui.muted}>Loading triggers…</p></main>;

  const live = workspace.ghosts.filter((trigger) => !isTerminal(trigger.status));
  const price = Number(workspace.frame.observations.PRICE.value);

  // Settled trades from this account and from earlier ones, the attempts that
  // were stopped, and the triggers that ended without trading. Newest first.
  const finished: Outcome[] = [
    ...workspace.executions.map((execution): Outcome => ({
      key: `receipt:${execution.id}`, kind: "receipt", status: "FILLED",
      name: execution.ghost_name, at: execution.completed_at, execution,
    })),
    ...(workspace.archivedExecutions ?? []).map((execution): Outcome => ({
      key: `receipt:${execution.id}`, kind: "receipt", status: "FILLED",
      name: execution.ghost_name, at: execution.completed_at, execution,
      generation: execution.portfolioGeneration,
    })),
    ...workspace.executionAttempts.map((attempt): Outcome => ({
      key: `attempt:${attempt.id}`, kind: "attempt", status: "BLOCKED",
      name: attempt.ghostName, at: attempt.updatedAt, attempt,
    })),
    ...workspace.ghosts.filter((trigger) => isTerminal(trigger.status)).map((trigger): Outcome => ({
      key: `outcome:${trigger.id}`, kind: "outcome", status: trigger.status,
      name: trigger.name, at: trigger.updatedAt, trigger,
    })),
  ].sort((left, right) => new Date(right.at).getTime() - new Date(left.at).getTime());

  const open = finished.find((outcome) => outcome.key === opened) ?? null;

  const lockedValue = live.reduce((total, trigger) => {
    if (!trigger.reservation) return total;
    const size = Number(trigger.reservation.amount);
    return total + (trigger.reservation.asset === "SOL" ? size * price : size);
  }, 0);

  const closest = [...live]
    .filter((trigger) => trigger.status === "WATCHING")
    .sort((left, right) => Number(right.triggerProximity) - Number(left.triggerProximity))[0];

  const equity = Number(workspace.portfolio.balances.USDC.quantity) + Number(workspace.portfolio.balances.SOL.quantity) * price;

  return (
    <AppShell active="triggers" equity={equity}>
      <StatStrip height={56}>
        <h1 style={{ fontSize: "var(--type-body)", fontWeight: 600, margin: 0 }}>Triggers</h1>
        <div style={{ display: "flex", gap: 18, fontSize: 13 }}>
          <button
            type="button"
            aria-pressed={filter === "WATCHING"}
            onClick={() => setFilter("WATCHING")}
            style={{ padding: 0, color: filter === "WATCHING" ? "var(--text)" : "var(--muted)", background: "transparent", border: 0, fontWeight: filter === "WATCHING" ? 600 : 400, cursor: "pointer" }}
          >
            Watching ({live.length})
          </button>
          <button
            type="button"
            aria-pressed={filter === "FINISHED"}
            onClick={() => setFilter("FINISHED")}
            style={{ padding: 0, color: filter === "FINISHED" ? "var(--text)" : "var(--muted)", background: "transparent", border: 0, fontWeight: filter === "FINISHED" ? 600 : 400, cursor: "pointer" }}
          >
            Finished ({finished.length})
          </button>
        </div>
        <div style={{ flexGrow: 1 }} />
        <Stat label="Locked capital" value={`${usd(lockedValue)} USDC equivalent`} />
        <Stat label="Closest to firing" value={closest ? percent(1 - Number(closest.triggerProximity), 1).replace("+", "") : "--"} />
      </StatStrip>

      <div style={{ flexGrow: 1, display: "flex", flexDirection: "column", minHeight: 0, overflowY: "auto" }}>
        {filter === "FINISHED" ? (
          <>
            <Row columns={FINISHED_COLUMNS} head>
              <span>Outcome</span><span>Trigger</span><span>Result</span>
              <span>Capital</span><span style={{ textAlign: "right" }}>Evidence</span>
            </Row>

            {finished.length === 0 && (
              <Row columns="1fr"><span className={ui.muted}>Nothing has finished yet.</span></Row>
            )}

            {finished.map((outcome) => {
              const story = outcomeStory(outcome.status);
              const result = outcome.kind === "receipt"
                ? `${amount(outcome.execution.input_amount)} ${outcome.execution.input_asset} → ${amount(outcome.execution.output_amount)} ${outcome.execution.output_asset}`
                : story.headline;
              return (
                <Row key={outcome.key} columns={FINISHED_COLUMNS}>
                  <span className={ui[outcomeTone(outcome.status)]} style={{ fontWeight: 600 }}>
                    {outcome.status.charAt(0) + outcome.status.slice(1).toLowerCase()}
                  </span>
                  <span>
                    {outcome.name}
                    {outcome.kind === "receipt" && outcome.generation != null && (
                      <span className={ui.muted}> · earlier account</span>
                    )}
                  </span>
                  <span className={outcome.kind === "receipt" ? ui.mono : ui.muted}>{result}</span>
                  <span className={ui.muted}>{story.capital}</span>
                  <span style={{ textAlign: "right" }}>
                    <button
                      type="button"
                      className={ui.accent}
                      aria-haspopup="dialog"
                      onClick={() => setOpened(outcome.key)}
                      style={{ padding: 0, background: "transparent", border: 0, fontSize: 12, cursor: "pointer" }}
                    >
                      {outcome.kind === "receipt" ? "Receipt" : outcome.kind === "attempt" ? "Attempt" : "Outcome"}
                    </button>
                  </span>
                </Row>
              );
            })}
          </>
        ) : (
          <>
        <Row columns={COLUMNS} head>
          <span>Trigger</span><span>Conditions</span><span>Size</span><span>Locked</span>
          <span>To trigger</span><span>Expires</span><span>State</span>
          <span style={{ textAlign: "right" }}>Actions</span>
        </Row>

        {live.length === 0 && (
          <Row columns="1fr">
            <span className={ui.muted}>No triggers are watching. The Trade screen places one.</span>
          </Row>
        )}

        {live.map((trigger) => {
          const state = stateLabel(trigger);
          const blocked = trigger.status === "WATCHING" && trigger.evaluations.every((evaluation) => evaluation.satisfied);
          const next = trigger.evaluations
            .filter((evaluation) => !evaluation.satisfied)
            .sort((left, right) => Number(left.distanceRatio) - Number(right.distanceRatio))[0];
          const reservation = trigger.reservation;
          const lockedFor = reservation
            ? reservation.asset === "SOL"
              ? usd(Number(reservation.amount) * price)
              : usd(Number(reservation.amount))
            : "--";

          return (
            <Row key={trigger.id} columns={COLUMNS} tone={blocked ? "warn" : undefined}>
              {/* The name is what the trader typed, so it leads, the way the
                  finished list and the detail screen already lead with it. */}
              <span>
                <span style={{ display: "block", fontWeight: 600 }}>{trigger.name}</span>
                <span className={ui.muted} style={{ display: "block", fontSize: 11 }}>
                  <span className={trigger.side === "BUY" ? ui.up : ui.down}>
                    {trigger.side === "BUY" ? "Buy" : "Sell"}
                  </span>{" "}
                  {trigger.amountType === "USDC" ? `${amount(trigger.amount)} USDC` : `${amount(trigger.amount)}% of SOL`}
                </span>
              </span>

              <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {trigger.evaluations.map((evaluation) => (
                  <Chip key={evaluation.metric} met={evaluation.satisfied}>
                    {conditionChip(evaluation.metric, evaluation.operator, evaluation.target)}
                    {evaluation.satisfied ? " met" : ""}
                  </Chip>
                ))}
              </span>

              <span className={ui.mono}>
                {reservation ? `${amount(reservation.amount)} ${reservation.asset}` : "--"}
              </span>
              <span className={ui.mono}>{lockedFor}</span>
              <span className={ui.mono}>{next ? percent(next.distanceRatio, 1).replace("+", "") : "ready"}</span>
              <span className={`${ui.mono} ${ui.muted}`}>{timeLeft(trigger.expiresAt)}</span>
              <span className={state.tone ? ui[state.tone] : undefined}>{state.text}</span>

              <span style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}>
                {trigger.status === "PAUSED" ? (
                  <button type="button" className={ui.accent} onClick={() => act.mutate({ id: trigger.id, action: "resume" })} disabled={act.isPending} style={{ padding: 0, background: "transparent", border: 0, fontSize: 12, cursor: "pointer" }}>
                    Resume
                  </button>
                ) : (
                  <button type="button" className={ui.muted} onClick={() => act.mutate({ id: trigger.id, action: "pause" })} disabled={act.isPending || isTerminal(trigger.status)} style={{ padding: 0, background: "transparent", border: 0, fontSize: 12, cursor: "pointer" }}>
                    Pause
                  </button>
                )}
                <button type="button" className={ui.down} onClick={() => act.mutate({ id: trigger.id, action: "cancel" })} disabled={act.isPending || isTerminal(trigger.status)} style={{ padding: 0, background: "transparent", border: 0, fontSize: 12, cursor: "pointer" }}>
                  Cancel
                </button>
              </span>
            </Row>
          );
        })}
          </>
        )}

        <div style={{ flexGrow: 1 }} />
        <div style={{ flexShrink: 0, height: 34, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 20px", borderTop: "1px solid var(--line)", color: "var(--muted)", fontSize: "var(--type-caption)" }}>
          <span>{failed ?? "Capital stays locked until a trigger settles, expires or is cancelled"}</span>
          <span className={ui.mono}>frame {workspace.frame.id.slice(0, 8)} {workspace.frame.completeness}</span>
        </div>
      </div>

      {open && (
        <Dialog
          title={open.kind === "receipt" ? "Receipt" : open.kind === "attempt" ? "Attempt" : "Outcome"}
          aside={<span className={`${ui.mono} ${ui.muted}`} style={{ fontSize: 12 }}>{open.name}</span>}
          onClose={() => setOpened(null)}
          footer={<span className={`${ui.mono} ${ui.muted}`} style={{ fontSize: 12 }}>{dateTime(open.at)}</span>}
        >
          {open.kind === "receipt" && <ReceiptBody execution={open.execution} />}
          {open.kind === "attempt" && <AttemptBody attempt={open.attempt} />}
          {open.kind === "outcome" && <OutcomeBody trigger={open.trigger} />}
        </Dialog>
      )}
    </AppShell>
  );
}

/** What settled, at what price, and the stored records that prove it. */
function ReceiptBody({ execution }: { execution: Execution }) {
  const receipt = execution.receipt as {
    frame?: { id?: string; observations?: Record<string, { metric: string; provider: string; sourceTimestamp: string | null }> };
    quote?: { modelVersion?: string };
    ledgerTransactionId?: string;
  };
  const observations = receipt.frame?.observations;

  return (
    <>
      <Row columns="1fr 1fr" head><span>Settled</span><span>Received</span></Row>
      <Row columns="1fr 1fr">
        <span className={ui.mono}>{amount(execution.input_amount)} {execution.input_asset}</span>
        <span className={`${ui.mono} ${ui.up}`}>{amount(execution.output_amount)} {execution.output_asset}</span>
      </Row>

      <Row columns="1fr 1fr" head><span>Detail</span><span>Value</span></Row>
      <Row columns="1fr 1fr"><span className={ui.muted}>Execution price</span><span className={ui.mono}>{usd(execution.execution_price)}</span></Row>
      <Row columns="1fr 1fr"><span className={ui.muted}>Modeled slippage</span><span className={ui.mono}>{execution.modeled_slippage_bps} bps</span></Row>
      {receipt.quote?.modelVersion && (
        <Row columns="1fr 1fr"><span className={ui.muted}>Quote model</span><span className={ui.mono}>{receipt.quote.modelVersion}</span></Row>
      )}
      {receipt.frame?.id && (
        <Row columns="1fr 1fr"><span className={ui.muted}>Frame</span><span className={ui.mono}>{receipt.frame.id.slice(0, 12)}</span></Row>
      )}
      {receipt.ledgerTransactionId && (
        <Row columns="1fr 1fr"><span className={ui.muted}>Ledger transaction</span><span className={ui.mono}>{receipt.ledgerTransactionId.slice(0, 12)}</span></Row>
      )}

      {observations && (
        <>
          <Row columns="1fr 1fr 1.4fr" head><span>Signal</span><span>Source</span><span>Recorded</span></Row>
          {Object.values(observations).map((observation) => (
            <Row key={observation.metric} columns="1fr 1fr 1.4fr">
              <span>{metricLabel[observation.metric as keyof typeof metricLabel] ?? observation.metric}</span>
              <span className={`${ui.mono} ${ui.muted}`}>{providerLabel(observation.provider)}</span>
              <span className={`${ui.mono} ${ui.muted}`}>{observation.sourceTimestamp ? dateTime(observation.sourceTimestamp) : "no source time"}</span>
            </Row>
          ))}
        </>
      )}
    </>
  );
}

/** Why the trade was stopped at settlement, and that the capital came back. */
function AttemptBody({ attempt }: { attempt: ExecutionAttempt }) {
  const quote = attempt.reason?.metadata?.quote;
  return (
    <>
      <Row columns="1fr"><span className={ui.warn}>{attempt.reason?.message ?? "This trade was stopped at settlement."}</span></Row>

      <Row columns="1fr 1fr" head><span>Detail</span><span>Value</span></Row>
      <Row columns="1fr 1fr"><span className={ui.muted}>Your limit</span><span className={ui.mono}>{(attempt.maxSlippageBps / 100).toFixed(2)}%</span></Row>
      {quote?.modeledSlippageBps != null && (
        <Row columns="1fr 1fr"><span className={ui.muted}>Price impact</span><span className={`${ui.mono} ${ui.warn}`}>{quote.modeledSlippageBps} bps</span></Row>
      )}
      {quote?.executionPrice && (
        <Row columns="1fr 1fr"><span className={ui.muted}>Would have filled at</span><span className={ui.mono}>{usd(quote.executionPrice)}</span></Row>
      )}
      <Row columns="1fr 1fr"><span className={ui.muted}>Locked capital</span><span className={ui.mono}>{attempt.reservation ? `${amount(attempt.reservation.amount)} ${attempt.reservation.asset} returned` : "returned"}</span></Row>
      <Row columns="1fr 1fr"><span className={ui.muted}>Frame</span><span className={ui.mono}>{attempt.frame.id.slice(0, 12)}</span></Row>
    </>
  );
}

/** Where the conditions stood when the trigger ended without trading. */
function OutcomeBody({ trigger }: { trigger: Trigger }) {
  return (
    <>
      <Row columns="1fr"><span className={ui.muted}>{outcomeStory(trigger.status).capital}. These were the conditions when it ended.</span></Row>
      <Row columns="1.2fr 1fr 1fr 0.8fr" head>
        <span>Signal</span><span>Target</span><span>Last seen</span><span style={{ textAlign: "right" }}>State</span>
      </Row>
      {trigger.evaluations.map((evaluation) => (
        <Row key={evaluation.metric} columns="1.2fr 1fr 1fr 0.8fr">
          <span>{metricLabel[evaluation.metric]}</span>
          <span className={ui.mono}>{conditionChip(evaluation.metric, evaluation.operator, evaluation.target)}</span>
          <span className={ui.mono}>{evaluation.current}</span>
          <span className={evaluation.satisfied ? ui.accent : ui.muted} style={{ textAlign: "right" }}>
            {evaluation.satisfied ? "Met" : "Pending"}
          </span>
        </Row>
      ))}
    </>
  );
}
