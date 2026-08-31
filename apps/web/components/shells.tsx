import type { ReactNode } from "react";

export function MarketingShell({ children }: { children: ReactNode }) {
  return <div className="marketing-shell">{children}</div>;
}

export function AppShell({ children }: { children: ReactNode }) {
  return <div className="app-shell">{children}</div>;
}

export function SandboxDisclaimer() {
  return <aside className="sandbox-disclaimer" aria-label="Simulation execution disclaimer">Simulation uses virtual funds and simulated execution. Live market data may be shown, but no real assets move.</aside>;
}
