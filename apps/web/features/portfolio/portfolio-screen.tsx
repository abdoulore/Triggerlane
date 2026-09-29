"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { valuePortfolio } from "@ghost/domain";
import { api } from "@/lib/api";
import { amount, dateTime, percent, usd } from "@/lib/format";
import type { Workspace } from "@/lib/types";
import { useLiveEvents } from "@/lib/use-live-events";
import { AppShell } from "@/components/app-shell";
import { Dialog, Row, SecondaryButton, Stat, StatStrip, ui } from "@/components/ui";

const BALANCE_COLUMNS = "0.8fr 1fr 1fr 1fr 1fr 0.8fr";
const LOCK_COLUMNS = "1.6fr 0.9fr 1.1fr 1fr 0.9fr 1fr";
const LEDGER_COLUMNS = "1.2fr 1.6fr 2fr";
const LEDGER_PAGE = 12;

export function PortfolioScreen() {
  const [ready, setReady] = useState(false);
  const [showLedger, setShowLedger] = useState(false);
  const [ledgerPage, setLedgerPage] = useState(1);

  useEffect(() => {
    api("/api/session/anonymous", { method: "POST", body: JSON.stringify({ initialMode: "LIVE" }) })
      .then(() => setReady(true))
      .catch(() => setReady(true));
  }, []);

  useLiveEvents(ready);

  const workspaceQuery = useQuery({ queryKey: ["workspace"], queryFn: () => api<Workspace>("/api/workspace"), enabled: ready });
  const workspace = workspaceQuery.data;

  if (workspaceQuery.isError) return <main style={{ padding: 40 }}><p className={ui.down}>The portfolio could not be loaded.</p></main>;
  if (!workspace) return <main style={{ padding: 40 }}><p className={ui.muted}>Loading portfolio…</p></main>;

  const sol = workspace.portfolio.balances.SOL;
  const usdc = workspace.portfolio.balances.USDC;
  const price = workspace.frame.observations.PRICE.value;
  const valuation = valuePortfolio({
    solQuantity: sol.quantity,
    usdcQuantity: usdc.quantity,
    solReserved: sol.reserved,
    usdcReserved: usdc.reserved,
    solCostBasisUsdc: sol.costBasisUsdc,
    price,
  });

  const markPrice = Number(price);
  const equity = valuation.equityUsdc == null ? null : Number(valuation.equityUsdc);
  const reserved = valuation.reservedValueUsdc == null ? null : Number(valuation.reservedValueUsdc);
  const available = valuation.availableValueUsdc == null ? null : Number(valuation.availableValueUsdc);
  const solValue = valuation.solValueUsdc == null ? null : Number(valuation.solValueUsdc);
  const usdcValue = Number(usdc.quantity);

  // Unrealized gain on the SOL position against its cost basis. Realized P&L has
  // no column behind it yet, so nothing here claims one.
  const unrealized = valuation.pnlRatio;
  const basis = sol.costBasisUsdc == null ? null : Number(sol.costBasisUsdc);
  const unrealizedUsd = solValue != null && basis != null ? solValue - basis : null;

  const locks = workspace.reservations.filter((reservation) => ["ACTIVE", "LOCKED"].includes(reservation.status));
  const lockedShare = equity && reserved != null ? reserved / equity : null;

  // The ledger entries must rebuild the balances, or the numbers above are wrong.
  const rebuilt = workspace.ledger
    .flatMap((transaction) => transaction.entries)
    .reduce((totals, entry) => ({ ...totals, [entry.asset]: totals[entry.asset] + Number(entry.amount) }), { SOL: 0, USDC: 0 });
  const reconciled =
    Math.abs(rebuilt.SOL - Number(sol.quantity)) < 1e-9 && Math.abs(rebuilt.USDC - Number(usdc.quantity)) < 1e-6;

  const pages = Math.max(1, Math.ceil(workspace.ledger.length / LEDGER_PAGE));
  const page = Math.min(ledgerPage, pages);
  const visible = workspace.ledger.slice((page - 1) * LEDGER_PAGE, page * LEDGER_PAGE);

  const share = (value: number | null) => (equity && value != null ? percent(value / equity, 1).replace("+", "") : "--");

  return (
    <AppShell active="portfolio" equity={equity}>
      <StatStrip height={84}>
        <h1 style={{ fontSize: "var(--type-body)", fontWeight: 600, margin: 0 }}>Portfolio</h1>
        <div className={ui.stat}>
          <span className={ui.statLabel}>Equity</span>
          <span className={`${ui.statValue} ${ui.mono}`} style={{ fontSize: 22 }}>{usd(equity)}</span>
        </div>
        <Stat label="Available" value={usd(available)} />
        <Stat label="Locked by triggers" value={usd(reserved)} />
        <Stat
          label="Unrealized on SOL"
          value={unrealized == null ? "--" : <>{percent(unrealized, 2)} <span className={ui.muted}>{unrealizedUsd == null ? "" : usd(unrealizedUsd)}</span></>}
          tone={unrealized == null ? undefined : Number(unrealized) >= 0 ? "up" : "down"}
        />
        <div style={{ flexGrow: 1 }} />
        <Stat label="Mark" value={`${usd(markPrice)} / SOL`} />
      </StatStrip>

      <div style={{ flexGrow: 1, display: "flex", flexDirection: "column", minHeight: 0, overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "18px 20px 8px" }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>Balances</span>
          <span className={ui.muted} style={{ fontSize: "var(--type-caption)" }}>Marked from the same snapshot shown on Trade</span>
        </div>

        <Row columns={BALANCE_COLUMNS} head>
          <span>Asset</span><span>Owned</span><span>Available</span><span>Locked</span>
          <span>Value</span><span style={{ textAlign: "right" }}>Share</span>
        </Row>

        <Row columns={BALANCE_COLUMNS}>
          <span style={{ fontWeight: 600 }}>SOL</span>
          <span className={ui.mono}>{amount(sol.quantity)}</span>
          <span className={ui.mono}>{amount(sol.available)}</span>
          <span className={ui.mono}>{amount(sol.reserved)}</span>
          <span className={ui.mono}>{usd(solValue)}</span>
          <span className={`${ui.mono} ${ui.muted}`} style={{ textAlign: "right" }}>{share(solValue)}</span>
        </Row>

        <Row columns={BALANCE_COLUMNS}>
          <span style={{ fontWeight: 600 }}>USDC</span>
          <span className={ui.mono}>{amount(usdc.quantity)}</span>
          <span className={ui.mono}>{amount(usdc.available)}</span>
          <span className={ui.mono}>{amount(usdc.reserved)}</span>
          <span className={ui.mono}>{usd(usdcValue)}</span>
          <span className={`${ui.mono} ${ui.muted}`} style={{ textAlign: "right" }}>{share(usdcValue)}</span>
        </Row>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "22px 20px 8px" }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>Locked by triggers</span>
          <span className={ui.muted} style={{ fontSize: "var(--type-caption)" }}>
            {lockedShare == null ? "Mark unavailable" : `${percent(lockedShare, 1).replace("+", "")} of equity across ${locks.length} trigger${locks.length === 1 ? "" : "s"}`}
          </span>
        </div>

        <Row columns={LOCK_COLUMNS} head>
          <span>Trigger</span><span>Side</span><span>Locked</span>
          <span>Value</span><span>State</span><span style={{ textAlign: "right" }}>Since</span>
        </Row>

        {locks.length === 0 && (
          <Row columns="1fr">
            <span className={ui.muted}>Nothing is locked. Every unit is free for a new trigger.</span>
          </Row>
        )}

        {locks.map((lock) => {
          const value = lock.asset === "SOL" ? Number(lock.amount) * markPrice : Number(lock.amount);
          return (
            <Row key={lock.id} columns={LOCK_COLUMNS}>
              <a href={`/ghost/${lock.ghostId}`} style={{ color: "var(--text)" }}>{lock.ghostName}</a>
              <span className={lock.side === "BUY" ? ui.up : ui.down}>{lock.side === "BUY" ? "Buy" : "Sell"}</span>
              <span className={ui.mono}>{amount(lock.amount)} {lock.asset}</span>
              <span className={ui.mono}>{usd(value)}</span>
              <span className={lock.status === "LOCKED" ? ui.warn : ui.muted}>
                {lock.status === "LOCKED" ? "Settling" : "Held"}
              </span>
              <span className={`${ui.mono} ${ui.muted}`} style={{ textAlign: "right" }}>{dateTime(lock.createdAt)}</span>
            </Row>
          );
        })}

        <div style={{ flexGrow: 1 }} />
        <div style={{ flexShrink: 0, height: 52, display: "flex", alignItems: "center", gap: 10, padding: "0 20px", borderTop: "1px solid var(--line)" }}>
          <SecondaryButton onClick={() => setShowLedger(true)}>Show ledger ({workspace.ledger.length})</SecondaryButton>
          <div style={{ flexGrow: 1 }} />
          <span className={`${ui.mono} ${reconciled ? ui.muted : ui.down}`} style={{ fontSize: "var(--type-caption)" }}>
            {reconciled ? "Ledger reconciles with balances" : "Ledger does not reconcile with balances"}
          </span>
        </div>
      </div>

      {showLedger && (
        <Dialog
          title="Ledger"
          aside={<span className={`${ui.mono} ${ui.muted}`} style={{ fontSize: 12 }}>Account {workspace.portfolio.generation}</span>}
          onClose={() => setShowLedger(false)}
          footer={
            <>
              <span className={`${ui.mono} ${ui.muted}`} style={{ fontSize: 12 }}>
                Rebuilt {amount(rebuilt.SOL)} SOL · {amount(rebuilt.USDC)} USDC
              </span>
              {pages > 1 && (
                <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <SecondaryButton onClick={() => setLedgerPage((value) => Math.max(1, value - 1))} disabled={page === 1}>Previous</SecondaryButton>
                  <span className={`${ui.mono} ${ui.muted}`} style={{ fontSize: 12 }}>Page {page} of {pages}</span>
                  <SecondaryButton onClick={() => setLedgerPage((value) => Math.min(pages, value + 1))} disabled={page === pages}>Next</SecondaryButton>
                </span>
              )}
            </>
          }
        >
          <Row columns={LEDGER_COLUMNS} head>
            <span>Time</span><span>Source</span><span>Movement</span>
          </Row>
          {visible.map((transaction) => (
            <Row key={transaction.id} columns={LEDGER_COLUMNS}>
              <span className={`${ui.mono} ${ui.muted}`}>{dateTime(transaction.createdAt)}</span>
              <span>{transaction.ghostName ?? "Initial deposit"}</span>
              <span style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                {transaction.entries.map((entry) => (
                  <span key={entry.id} className={`${ui.mono} ${Number(entry.amount) >= 0 ? ui.up : ui.down}`}>
                    {Number(entry.amount) >= 0 ? "+" : ""}{amount(entry.amount)} {entry.asset}
                  </span>
                ))}
              </span>
            </Row>
          ))}
          {workspace.ledger.length === 0 && (
            <Row columns="1fr"><span className={ui.muted}>Nothing recorded yet.</span></Row>
          )}
        </Dialog>
      )}
    </AppShell>
  );
}
