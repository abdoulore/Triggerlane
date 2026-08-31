import type { ReactNode } from "react";

export function MarketingShell({ children }: { children: ReactNode }) {
  return <div className="marketing-shell">{children}</div>;
}

export function AppShell({ children }: { children: ReactNode }) {
  return <div className="app-shell">{children}</div>;
}

export function SandboxDisclaimer() {
  return <aside className="sandbox-disclaimer" aria-label="Sandbox execution disclaimer">Triggerlane Sandbox uses simulated capital and simulated execution. Market data may be live, but no real assets are moved.</aside>;
}
