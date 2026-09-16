"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { usd } from "@/lib/format";
import { ui } from "@/components/ui";
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
        </div>
      </header>

      <main className={styles.body}>{children}</main>

      <footer aria-label="Virtual execution notice" className={styles.footer}>
        Trades use virtual funds. No real assets move.
      </footer>
    </div>
  );
}
