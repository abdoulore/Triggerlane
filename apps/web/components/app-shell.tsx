"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { api } from "@/lib/api";
import { amount, usd } from "@/lib/format";
import type { Workspace } from "@/lib/types";
import { Dialog, Row, SecondaryButton, ui } from "@/components/ui";
import styles from "./app-shell.module.css";

const NAV = [
  { href: "/trade", label: "Trade", key: "trade" },
  { href: "/ghosts", label: "Triggers", key: "triggers" },
  { href: "/portfolio", label: "Portfolio", key: "portfolio" },
  { href: "/discover", label: "Ideas", key: "ideas" },
] as const;

export type NavKey = (typeof NAV)[number]["key"];

/**
 * The frame every product screen sits in: where you are, what the account is
 * worth, and the standing reminder that none of this moves real money.
 */
export function AppShell({ active, equity, children }: { active: NavKey; equity?: number | null; children: ReactNode }) {
  const [accountOpen, setAccountOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  // Read whatever the screen already loaded. Disabled, so it never fetches on
  // its own: the account panel is not worth a request, and the shell has no
  // session to wait on. The fetcher is still required even when it is never
  // called, and omitting it logs an error on every render of every screen.
  const { data: workspace } = useQuery<Workspace>({
    queryKey: ["workspace"],
    queryFn: () => api<Workspace>("/api/workspace"),
    enabled: false,
  });

  const clearAccess = useMutation({
    mutationFn: () => api<{ ok: true }>("/api/session", { method: "DELETE" }),
    onSuccess: () => { window.location.href = "/"; },
    onError: (caught: unknown) => setFailed(caught instanceof Error ? caught.message : "Access could not be cleared."),
  });

  const closeAccount = () => {
    setAccountOpen(false);
    setConfirming(false);
    setFailed(null);
  };

  return (
    <div style={{ height: "100dvh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <header className={styles.header}>
        <div className={styles.left}>
          <Link href="/" aria-label="Go to Triggerlane home" className={styles.brand}>
            <span className={styles.brandMark}><span /></span>
            <span className={styles.brandName}>Triggerlane</span>
          </Link>

          <nav aria-label="Product" className={styles.nav}>
            {NAV.map((item) => (
              <Link key={item.key} href={item.href} aria-current={item.key === active ? "page" : undefined}>
                {item.label}
              </Link>
            ))}
          </nav>
        </div>

        <div className={styles.meta}>
          <span className={`${ui.warn} ${styles.paper}`}>PAPER</span>
          {equity != null && (
            <span className={`${ui.mono} ${ui.muted} ${styles.equity}`}>
              Equity <span className={styles.equityValue}>{usd(equity)}</span>
            </span>
          )}
          <button
            type="button"
            aria-label="Open account"
            aria-haspopup="dialog"
            onClick={() => setAccountOpen(true)}
            className={ui.muted}
            style={{ padding: 0, background: "transparent", border: 0, fontSize: 12, cursor: "pointer" }}
          >
            Account
          </button>
        </div>
      </header>

      <main className={styles.body}>{children}</main>

      <footer aria-label="Virtual execution notice" className={styles.footer}>
        Trades use virtual funds. No real assets move.
      </footer>

      {accountOpen && (
        <Dialog
          title="Account"
          aside={workspace && <span className={`${ui.mono} ${ui.muted}`} style={{ fontSize: 12 }}>{workspace.identity.label}</span>}
          onClose={closeAccount}
          footer={
            <span className={ui.muted} style={{ fontSize: "var(--type-caption)" }}>
              {failed ?? "Nothing here moves real money."}
            </span>
          }
        >
          {workspace && (
            <>
              <Row columns="1fr 1fr 1fr" head><span>Asset</span><span>Available</span><span>Locked</span></Row>
              {(["USDC", "SOL"] as const).map((asset) => (
                <Row key={asset} columns="1fr 1fr 1fr">
                  <span style={{ fontWeight: 600 }}>{asset}</span>
                  <span className={ui.mono}>{amount(workspace.portfolio.balances[asset].available)}</span>
                  <span className={ui.mono}>{amount(workspace.portfolio.balances[asset].reserved)}</span>
                </Row>
              ))}
            </>
          )}

          <Row columns="1fr">
            <span className={ui.muted} style={{ fontSize: 12, lineHeight: 1.6 }}>
              This account exists only in this browser. There is no sign-in, and no way to recover it
              once its access is cleared.
            </span>
          </Row>

          {!confirming ? (
            <Row columns="1fr">
              <span>
                <SecondaryButton onClick={() => setConfirming(true)}>Clear browser access</SecondaryButton>
              </span>
            </Row>
          ) : (
            <Row columns="1fr">
              <span role="alert" style={{ display: "grid", gap: 10 }}>
                <span style={{ fontWeight: 600 }}>End access from this browser?</span>
                <span className={ui.muted} style={{ fontSize: 12 }}>
                  The paper data stays on the server, but this browser cannot reopen it afterwards.
                </span>
                <span style={{ display: "flex", gap: 10 }}>
                  <SecondaryButton onClick={() => setConfirming(false)}>Keep access</SecondaryButton>
                  <button
                    type="button"
                    className={ui.down}
                    disabled={clearAccess.isPending}
                    onClick={() => clearAccess.mutate()}
                    style={{ padding: 0, background: "transparent", border: 0, fontSize: 12, cursor: "pointer" }}
                  >
                    {clearAccess.isPending ? "Clearing…" : "End access"}
                  </button>
                </span>
              </span>
            </Row>
          )}
        </Dialog>
      )}
    </div>
  );
}
