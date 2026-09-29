import type { ReactNode } from "react";

/** The landing page's wrapper. Product screens use components/app-shell.tsx. */
export function MarketingShell({ children }: { children: ReactNode }) {
  return <div className="marketing-shell">{children}</div>;
}
