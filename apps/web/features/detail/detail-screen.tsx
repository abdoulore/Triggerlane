"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { buildSandboxQuote, type Metric } from "@ghost/domain";
import { api } from "@/lib/api";
import { amount, dateTime, fundingApr, fundingHourly, metricLabel, percent, providerLabel, timeLeft, usd } from "@/lib/format";
import type { Trigger, Workspace } from "@/lib/types";
import { isTerminal } from "@/lib/types";
import { useLiveEvents } from "@/lib/use-live-events";
import { Bar, Dialog, Row, SecondaryButton, Stat, StatStrip, ui } from "@/components/ui";

const CONDITION_COLUMNS = "1.2fr 1fr 1fr 1fr 1.8fr 1.6fr 0.8fr";

interface Activity {
  id: string;
  type: string;
  message: string;
  created_at: string;
}

interface TriggerDetail extends Trigger {
  activities?: Activity[];
  evaluationFrame?: { id: string; completeness: string; assembledAt: string; observations: Record<Metric, { provider: string; receivedAt: string; sourceTimestamp: string | null }> } | null;
}

/** Current value against target, in the units the trader set. */
function currentReading(metric: Metric, value: string): string {
  if (metric === "PRICE") return usd(value);
  if (metric === "FUNDING") return `${fundingHourly(value)} · ${fundingApr(value)}`;
  return percent(value, 1);
}

function targetReading(metric: Metric, target: string): string {
  if (metric === "PRICE") return usd(target);
  if (metric === "FUNDING") return fundingApr(target);
  return percent(target, 1);
}

export function DetailScreen({ triggerId }: { triggerId: string }) {
  const queryClient = useQueryClient();
  const [ready, setReady] = useState(false);
  const [showActivity, setShowActivity] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    api("/api/session/anonymous", { method: "POST", body: JSON.stringify({ initialMode: "LIVE" }) })
      .then(() => setReady(true))
      .catch(() => setReady(true));
  }, []);

  useLiveEvents(ready);

  const triggerQuery = useQuery({
    queryKey: ["trigger", triggerId],
    queryFn: () => api<TriggerDetail>(`/api/ghosts/${triggerId}`),
    enabled: ready,
  });
  const workspaceQuery = useQuery({ queryKey: ["workspace"], queryFn: () => api<Workspace>("/api/workspace"), enabled: ready });

  const act = useMutation({
    mutationFn: (action: "pause" | "resume" | "cancel") => api(`/api/ghosts/${triggerId}/${action}`, { method: "POST" }),
    onSuccess: () => {
      setFailed(null);
      void queryClient.invalidateQueries({ queryKey: ["trigger", triggerId] });
      void queryClient.invalidateQueries({ queryKey: ["workspace"] });
    },
    onError: (caught: unknown) => setFailed(caught instanceof Error ? caught.message : "That action did not complete."),
  });

  const trigger = triggerQuery.data;
  if (triggerQuery.isError) return <main style={{ padding: 40 }}><p className={ui.down}>That trigger could not be loaded.</p></main>;
  if (!trigger) return <main style={{ padding: 40 }}><p className={ui.muted}>Loading trigger…</p></main>;

  const workspace = workspaceQuery.data;
  const price = Number(workspace?.frame.observations.PRICE.value ?? trigger.evaluations.find((item) => item.metric === "PRICE")?.current ?? 0);
  const met = trigger.evaluations.filter((evaluation) => evaluation.satisfied).length;
  const locked = trigger.reservation;

  // What it would settle for at the price this trigger is waiting on.
  const priceCondition = trigger.conditions.find((condition) => condition.metric === "PRICE");
  const settleAt = priceCondition ? Number(priceCondition.target) : price;
  const size = locked ? Number(locked.amount) : 0;
  const quote = size > 0 && settleAt > 0
    ? buildSandboxQuote({ side: trigger.side, reservedAmount: size, referencePrice: settleAt })
    : null;

  return (
    <main style={{ height: "100dvh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <StatStrip height={60}>
        <span className={ui.muted} style={{ fontSize: 12 }}>Triggers /</span>
        <span style={{ fontSize: 17, fontWeight: 600 }}>
          <span className={trigger.side === "BUY" ? ui.up : ui.down}>{trigger.side === "BUY" ? "Buy" : "Sell"}</span>{" "}
          {trigger.amountType === "USDC" ? `${amount(trigger.amount)} USDC` : `${amount(trigger.amount)}% of SOL`}
        </span>
        <span className={ui.accent} style={{ fontSize: 11, fontWeight: 600, padding: "3px 9px", border: "1px solid var(--accent-dark)", borderRadius: "var(--radius)" }}>
          {trigger.status}
        </span>
        <span className={`${ui.mono} ${ui.muted}`} style={{ fontSize: 12 }}>
          {met} of {trigger.evaluations.length} conditions met, fires once
        </span>
        <div style={{ flexGrow: 1 }} />
        <div style={{ display: "flex", gap: 8 }}>
          {trigger.status === "PAUSED" ? (
            <SecondaryButton onClick={() => act.mutate("resume")} disabled={act.isPending}>Resume</SecondaryButton>
          ) : (
            <SecondaryButton onClick={() => act.mutate("pause")} disabled={act.isPending || isTerminal(trigger.status)}>Pause</SecondaryButton>
          )}
          <SecondaryButton onClick={() => act.mutate("cancel")} disabled={act.isPending || isTerminal(trigger.status)}>Cancel</SecondaryButton>
        </div>
      </StatStrip>

      <StatStrip height={84}>
        <Stat label="Size" value={locked ? `${amount(locked.amount)} ${locked.asset}` : "not reserved"} />
        <Stat label="Locked" value={locked ? `${amount(locked.amount)} ${locked.asset}` : "--"} />
        <Stat label="Receive at target" value={quote ? `${amount(quote.amountOut)} ${trigger.side === "BUY" ? "SOL" : "USDC"}` : "--"} tone="up" />
        <Stat label={`Est. price at ${usd(settleAt)}`} value={quote ? usd(quote.executionPrice) : "--"} />
        <Stat label="Max slippage" value={`${(trigger.maxSlippageBps / 100).toFixed(2)}%`} />
        <Stat label="Expires" value={timeLeft(trigger.expiresAt)} />
      </StatStrip>

      <section style={{ flexGrow: 1, display: "flex", flexDirection: "column", minHeight: 0, overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "20px 20px 10px" }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>Conditions</span>
          <span className={ui.muted} style={{ fontSize: "var(--type-caption)" }}>All must hold on the same stored frame</span>
        </div>

        <Row columns={CONDITION_COLUMNS} head>
          <span>Signal</span><span>Rule</span><span>Target</span><span>Current</span>
          <span>Distance</span><span>Source</span><span style={{ textAlign: "right" }}>State</span>
        </Row>

        {trigger.evaluations.map((evaluation) => {
          const observation = trigger.evaluationFrame?.observations?.[evaluation.metric];
          return (
            <Row key={evaluation.metric} columns={CONDITION_COLUMNS}>
              <span>{metricLabel[evaluation.metric]}</span>
              <span className={`${ui.mono} ${ui.muted}`}>{evaluation.operator === "GTE" ? "at or above" : "at or below"}</span>
              <span className={ui.mono}>{targetReading(evaluation.metric, evaluation.target)}</span>
              <span className={`${ui.mono} ${evaluation.satisfied ? ui.accent : ""}`}>{currentReading(evaluation.metric, evaluation.current)}</span>
              <span style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <Bar ratio={Number(evaluation.distanceRatio)} met={evaluation.satisfied} />
                <span className={`${ui.mono} ${evaluation.satisfied ? ui.accent : ui.muted}`} style={{ fontSize: 12 }}>
                  {evaluation.satisfied ? "met" : `${percent(evaluation.distanceRatio, 1).replace("+", "")} away`}
                </span>
              </span>
              <span className={`${ui.mono} ${ui.muted}`} style={{ fontSize: 12 }}>
                {observation ? providerLabel(observation.provider) : "--"}
              </span>
              <span className={evaluation.satisfied ? ui.accent : ui.muted} style={{ textAlign: "right" }}>
                {evaluation.satisfied ? "Met" : "Pending"}
              </span>
            </Row>
          );
        })}

        <div style={{ flexGrow: 1 }} />
        <div style={{ flexShrink: 0, height: 52, display: "flex", alignItems: "center", gap: 10, padding: "0 20px", borderTop: "1px solid var(--line)" }}>
          <SecondaryButton onClick={() => setShowActivity(true)}>Activity ({trigger.activities?.length ?? 0})</SecondaryButton>
          <div style={{ flexGrow: 1 }} />
          <span className={`${ui.mono} ${ui.muted}`} style={{ fontSize: "var(--type-caption)" }}>
            {failed ?? (trigger.evaluationFrame ? `frame ${trigger.evaluationFrame.id.slice(0, 8)} ${trigger.evaluationFrame.completeness}` : "no stored frame yet")}
          </span>
        </div>
      </section>

      {showActivity && (
        <Dialog
          title="Activity"
          aside={<span className={`${ui.mono} ${ui.muted}`} style={{ fontSize: 12 }}>{trigger.name}</span>}
          onClose={() => setShowActivity(false)}
        >
          <Row columns="1.2fr 1.4fr 2.4fr" head>
            <span>Time</span><span>Event</span><span>Detail</span>
          </Row>
          {(trigger.activities ?? []).map((activity) => (
            <Row key={activity.id} columns="1.2fr 1.4fr 2.4fr">
              <span className={`${ui.mono} ${ui.muted}`}>{dateTime(activity.created_at)}</span>
              <span>{activity.type.replaceAll("_", " ")}</span>
              <span className={`${ui.mono} ${ui.muted}`}>{activity.message}</span>
            </Row>
          ))}
          {(trigger.activities ?? []).length === 0 && (
            <Row columns="1fr"><span className={ui.muted}>Nothing recorded yet.</span></Row>
          )}
        </Dialog>
      )}
    </main>
  );
}
