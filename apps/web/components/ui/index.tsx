"use client";

import type { CSSProperties, ReactNode } from "react";
import styles from "./ui.module.css";

export const ui = styles;

export function Panel({ children, className = "", style }: { children: ReactNode; className?: string; style?: CSSProperties }) {
  return <div className={`${styles.panel} ${className}`} style={style}>{children}</div>;
}

export function Card({ title, aside, focused = false, children }: { title?: ReactNode; aside?: ReactNode; focused?: boolean; children: ReactNode }) {
  return (
    <div className={`${styles.card} ${focused ? styles.cardFocused : ""}`}>
      {(title || aside) && <div className={styles.cardTitle}><span>{title}</span>{aside}</div>}
      {children}
    </div>
  );
}

/**
 * Header and footer stay put; only the middle scrolls. The action never leaves
 * the panel, however many conditions the trader adds.
 */
export function ScrollRail({ header, footer, children, width = 340 }: { header?: ReactNode; footer?: ReactNode; children: ReactNode; width?: number }) {
  return (
    <aside className={styles.rail} style={{ width, flexShrink: 0 }}>
      {header && <div className={styles.railHeader}>{header}</div>}
      <div className={styles.railScroll}>{children}</div>
      {footer && <div className={styles.railFooter}>{footer}</div>}
    </aside>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label }: {
  value: T;
  options: Array<{ value: T; label: string; tone?: "buy" | "sell" }>;
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div className={styles.segmented} role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={styles.segmentedOption}
          data-tone={option.tone}
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function StatStrip({ children, height = 76 }: { children: ReactNode; height?: number }) {
  return <div className={styles.statStrip} style={{ height }}>{children}</div>;
}

export function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: "up" | "down" | "warn" }) {
  const toneClass = tone ? styles[tone] : "";
  return (
    <div className={styles.stat}>
      <span className={styles.statLabel}>{label}</span>
      <span className={`${styles.statValue} ${styles.mono} ${toneClass}`}>{value}</span>
    </div>
  );
}

/**
 * A grid of columns, not a semantic table. It carries no ARIA row role on
 * purpose: `role="row"` without a table parent and cell children is two
 * critical violations, and inventing the whole table scaffolding around plain
 * divs would claim structure the markup does not have.
 */
export function Row({ columns, head = false, children, tone }: { columns: string; head?: boolean; children: ReactNode; tone?: "warn" }) {
  return (
    <div
      className={`${styles.row} ${head ? styles.rowHead : ""}`}
      style={{ gridTemplateColumns: columns, ...(tone === "warn" ? { background: "#15130d" } : {}) }}
    >
      {children}
    </div>
  );
}

export function Chip({ met = false, children }: { met?: boolean; children: ReactNode }) {
  return <span className={`${styles.chip} ${styles.mono} ${met ? styles.chipMet : ""}`}>{children}</span>;
}

export function PrimaryButton({ children, onClick, disabled }: { children: ReactNode; onClick?: () => void; disabled?: boolean }) {
  return <button type="button" className={styles.primary} onClick={onClick} disabled={disabled}>{children}</button>;
}

export function SecondaryButton({ children, onClick, disabled }: { children: ReactNode; onClick?: () => void; disabled?: boolean }) {
  return <button type="button" className={styles.secondary} onClick={onClick} disabled={disabled}>{children}</button>;
}
