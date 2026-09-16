"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { amount, conditionChip, percent, timeLeft, usd } from "@/lib/format";
import type { Trigger, Workspace } from "@/lib/types";
import { isTerminal } from "@/lib/types";
import { useLiveEvents } from "@/lib/use-live-events";
import { Chip, Row, Stat, StatStrip, ui } from "@/components/ui";

const COLUMNS = "1.5fr 2.2fr 0.8fr 0.9fr 0.8fr 0.7fr 0.8fr 0.9fr";

type Filter = "WATCHING" | "FINISHED";

/** Why this trigger is not trading, in the trader's terms. */
function stateLabel(trigger: Trigger): { text: string; tone?: "warn" | "muted" | "accent" } {
  if (trigger.status === "PAUSED" && trigger.pauseReason === "USER") return { text: "Paused", tone: "muted" };
  if (trigger.status === "PAUSED") return { text: "Market data stale", tone: "warn" };
  if (trigger.status === "WATCHING") return { text: "Watching", tone: "accent" };
  return { text: trigger.status.toLowerCase(), tone: "muted" };
}

export function TriggersScreen() {
  const queryClient = useQueryClient();
  const [ready, setReady] = useState(false);
  const [filter, setFilter] = useState<Filter>("WATCHING");
  const [failed, setFailed] = useState<string | null>(null);

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
  const finished = workspace.ghosts.filter((trigger) => isTerminal(trigger.status));
  const shown = filter === "WATCHING" ? live : finished;
  const price = Number(workspace.frame.observations.PRICE.value);

  const lockedValue = live.reduce((total, trigger) => {
    if (!trigger.reservation) return total;
    const size = Number(trigger.reservation.amount);
    return total + (trigger.reservation.asset === "SOL" ? size * price : size);
  }, 0);

  const closest = [...live]
    .filter((trigger) => trigger.status === "WATCHING")
    .sort((left, right) => Number(right.triggerProximity) - Number(left.triggerProximity))[0];

  return (
    <main style={{ height: "100dvh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <StatStrip height={56}>
        <span style={{ fontSize: "var(--type-body)", fontWeight: 600 }}>Triggers</span>
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
        <Row columns={COLUMNS} head>
          <span>Trigger</span><span>Conditions</span><span>Size</span><span>Locked</span>
          <span>To trigger</span><span>Expires</span><span>State</span>
          <span style={{ textAlign: "right" }}>Actions</span>
        </Row>

        {shown.length === 0 && (
          <Row columns="1fr">
            <span className={ui.muted}>
              {filter === "WATCHING" ? "No triggers are watching. The Trade screen places one." : "Nothing has finished yet."}
            </span>
          </Row>
        )}

        {shown.map((trigger) => {
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
              <span>
                <span className={trigger.side === "BUY" ? ui.up : ui.down} style={{ fontWeight: 600 }}>
                  {trigger.side === "BUY" ? "Buy" : "Sell"}
                </span>{" "}
                {trigger.amountType === "USDC" ? `${amount(trigger.amount)} USDC` : `${amount(trigger.amount)}% of SOL`}
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

        <div style={{ flexGrow: 1 }} />
        <div style={{ flexShrink: 0, height: 34, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 20px", borderTop: "1px solid var(--line)", color: "var(--muted)", fontSize: "var(--type-caption)" }}>
          <span>{failed ?? "Capital stays locked until a trigger settles, expires or is cancelled"}</span>
          <span className={ui.mono}>frame {workspace.frame.id.slice(0, 8)} {workspace.frame.completeness}</span>
        </div>
      </div>
    </main>
  );
}
