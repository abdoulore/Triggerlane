"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { Metric } from "@ghost/domain";
import { api } from "@/lib/api";
import { fundingApr, metricLabel, operatorLabel, percent, usd } from "@/lib/format";
import type { Strategy, StrategyCatalog, Workspace } from "@/lib/types";
import { AppShell } from "@/components/app-shell";
import { Card, PrimaryButton, Row, ScrollRail, Stat, StatStrip, ui } from "@/components/ui";

const LIST_COLUMNS = "1.4fr 2.2fr 1fr";

/** A target in the unit the trader set it in. */
function targetReading(metric: Metric, target: string): string {
  if (metric === "PRICE") return usd(target);
  if (metric === "FUNDING") return fundingApr(target);
  return percent(target, 1);
}

/** What the trade does, in the trader's words rather than the draft's fields. */
function actionReading(strategy: Strategy): string {
  const { side, amount } = strategy.draft;
  return side === "BUY" ? `Buy with ${usd(amount)} USDC` : `Sell ${amount}% of SOL`;
}

export function IdeasScreen() {
  const [ready, setReady] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    api("/api/session/anonymous", { method: "POST", body: JSON.stringify({ initialMode: "LIVE" }) })
      .then(() => setReady(true))
      .catch(() => setReady(true));
  }, []);

  const catalogQuery = useQuery({ queryKey: ["strategies"], queryFn: () => api<StrategyCatalog>("/api/strategies"), enabled: ready });
  const workspaceQuery = useQuery({ queryKey: ["workspace"], queryFn: () => api<Workspace>("/api/workspace"), enabled: ready });

  // Recording the choice is all this does. The trigger is built on Trade.
  const use = useMutation({
    mutationFn: (id: string) => api<Strategy>(`/api/strategies/${id}/use`, { method: "POST" }),
    onSuccess: (strategy) => { window.location.href = `/trade?strategy=${strategy.id}`; },
    onError: (caught: unknown) => setFailed(caught instanceof Error ? caught.message : "That idea could not be opened."),
  });

  if (catalogQuery.isError) return <main style={{ padding: 40 }}><p className={ui.down}>Ideas could not be loaded.</p></main>;
  if (!catalogQuery.data) return <main style={{ padding: 40 }}><p className={ui.muted}>Loading ideas…</p></main>;

  const ideas = catalogQuery.data.strategies;
  const selected = ideas.find((idea) => idea.id === selectedId) ?? ideas[0] ?? null;

  const workspace = workspaceQuery.data;
  const equity = workspace
    ? Number(workspace.portfolio.balances.USDC.quantity)
      + Number(workspace.portfolio.balances.SOL.quantity) * Number(workspace.frame.observations.PRICE.value)
    : null;

  if (!selected) {
    return (
      <AppShell active="ideas" equity={equity}>
        <StatStrip height={56}>
          <h1 style={{ fontSize: "var(--type-body)", fontWeight: 600, margin: 0 }}>Find a starting point</h1>
        </StatStrip>
        <div style={{ padding: 40 }}>
          <p className={ui.muted}>No ideas are available. The Trade screen builds a trigger from scratch.</p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell active="ideas" equity={equity}>
      <StatStrip height={56}>
        <h1 style={{ fontSize: "var(--type-body)", fontWeight: 600, margin: 0 }}>Find a starting point</h1>
        <span className={ui.muted} style={{ fontSize: "var(--type-caption)" }}>
          Each one opens on Trade as an editable trigger. Nothing is placed here.
        </span>
        <div style={{ flexGrow: 1 }} />
        <Stat label="Ideas" value={String(ideas.length)} />
      </StatStrip>

      <div style={{ flexGrow: 1, display: "flex", minHeight: 0 }}>
        <section style={{ flexGrow: 1, display: "flex", flexDirection: "column", minWidth: 0, overflowY: "auto", borderRight: "1px solid var(--line)" }}>
          <Row columns={LIST_COLUMNS} head>
            <span>Idea</span><span>What it watches for</span><span>Action</span>
          </Row>

          {ideas.map((idea) => {
            const chosen = idea.id === selected.id;
            return (
              <div
                key={idea.id}
                role="button"
                tabIndex={0}
                aria-pressed={chosen}
                aria-label={idea.name}
                onClick={() => { setSelectedId(idea.id); setFailed(null); }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setSelectedId(idea.id);
                    setFailed(null);
                  }
                }}
                style={{ cursor: "pointer", background: chosen ? "rgba(112,242,204,0.04)" : undefined }}
              >
                <Row columns={LIST_COLUMNS}>
                  <span>
                    <span style={{ fontWeight: 600, color: chosen ? "var(--accent)" : "var(--text)" }}>{idea.name}</span>
                    <span className={ui.muted} style={{ display: "block", fontSize: 11 }}>{idea.thesis}</span>
                  </span>
                  <span className={ui.muted} style={{ fontSize: 12 }}>{idea.description}</span>
                  <span className={idea.draft.side === "BUY" ? ui.up : ui.down}>{actionReading(idea)}</span>
                </Row>
              </div>
            );
          })}
        </section>

        <ScrollRail
          header={
            <div style={{ display: "grid", gap: 4 }}>
              <span className={ui.muted} style={{ fontSize: 11 }}>{selected.thesis}</span>
              <span style={{ fontSize: 15, fontWeight: 600 }}>{selected.name}</span>
            </div>
          }
          footer={
            <>
              <PrimaryButton onClick={() => use.mutate(selected.id)} disabled={use.isPending}>
                {use.isPending ? "Opening…" : "Use this setup"}
              </PrimaryButton>
              <span className={ui.muted} style={{ fontSize: "var(--type-caption)" }}>
                {failed ?? "Opens on Trade. You place it, or you don't."}
              </span>
            </>
          }
        >
          <Card title="Why it exists">
            <span className={ui.muted} style={{ fontSize: 12, lineHeight: 1.6 }}>{selected.description}</span>
          </Card>

          <Card
            title="When all are true"
            aside={<span className={`${ui.mono} ${ui.muted}`} style={{ fontSize: 11 }}>{selected.draft.conditions.length}</span>}
          >
            <div aria-label="Idea conditions" role="group" style={{ display: "grid", gap: 8 }}>
              {selected.draft.conditions.map((condition) => (
                <div key={condition.metric} style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                  <span className={ui.muted}>{metricLabel[condition.metric]}</span>
                  <span className={ui.mono} style={{ textAlign: "right" }}>
                    {operatorLabel[condition.operator]} {targetReading(condition.metric, condition.target)}
                    {condition.metric === "PRICE" && selected.priceOffsetPct != null && (
                      <span className={ui.muted} style={{ display: "block", fontSize: 11 }}>
                        {Math.abs(selected.priceOffsetPct)}% {selected.priceOffsetPct < 0 ? "below" : "above"} the current price
                      </span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          </Card>

          <Card title="Then it does this">
            <span style={{ fontSize: 14, fontWeight: 600 }} className={selected.draft.side === "BUY" ? ui.up : ui.down}>
              {actionReading(selected)}
            </span>
            <span className={ui.muted} style={{ fontSize: 11 }}>Once, then it finishes.</span>
          </Card>

          <Card title="Terms">
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
              <span className={ui.muted}>Price impact limit</span>
              <span className={ui.mono}>{(selected.draft.maxSlippageBps / 100).toFixed(2)}%</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
              <span className={ui.muted}>Expires</span>
              <span className={ui.mono}>
                {selected.draft.expiresInHours < 24
                  ? `${selected.draft.expiresInHours}h`
                  : `${Math.round(selected.draft.expiresInHours / 24)}d`}
              </span>
            </div>
            <span className={ui.muted} style={{ fontSize: 11 }}>Every value stays editable on Trade.</span>
          </Card>
        </ScrollRail>
      </div>
    </AppShell>
  );
}
