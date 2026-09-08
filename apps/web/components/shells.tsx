import type { ReactNode } from "react";

export function MarketingShell({ children }: { children: ReactNode }) {
  return <div className="marketing-shell">{children}</div>;
}

export function AppShell({ children }: { children: ReactNode }) {
  return <div className="app-shell">{children}</div>;
}

export function SandboxDisclaimer() {
  return <aside className="sandbox-disclaimer" aria-label="Virtual execution notice">Trades use virtual funds. No real assets move.</aside>;
}
