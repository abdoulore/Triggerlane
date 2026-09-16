import type { GhostDraft, Metric } from "@ghost/domain";

/** Shapes returned by the API. Kept here so features import types, not each other. */

export type Side = "BUY" | "SELL";
export type Operator = "GTE" | "LTE";
export type Provenance = "DEMO" | "LIVE";

export interface Balance {
  asset: "SOL" | "USDC";
  quantity: string;
  reserved: string;
  available: string;
  costBasisUsdc: string | null;
}

export interface Observation {
  id: string;
  metric: Metric;
  value: string;
  provider: string;
  sourceTimestamp: string | null;
  receivedAt: string;
  provenance: Provenance;
}

export interface Frame {
  id: string;
  mode: Provenance;
  completeness: "COMPLETE" | "INCOMPLETE" | "STALE";
  executionEligible: boolean;
  assembledAt: string;
  observations: Record<Metric, Observation>;
}

export interface Evaluation {
  metric: Metric;
  operator: Operator;
  target: string;
  current: string;
  satisfied: boolean;
  distanceRatio: string;
  evidence?: {
    frameId: string;
    observationId: string;
    provider: string;
    sourceTimestamp: string | null;
    receivedAt: string;
    provenance: Provenance;
  };
}

export interface Reservation {
  id: string;
  asset: string;
  amount: string;
  status: string;
}

export interface Trigger {
  id: string;
  name: string;
  side: Side;
  amount: string;
  amountType: "USDC" | "POSITION_PERCENT";
  maxSlippageBps: number;
  expiresAt: string;
  conditions: GhostDraft["conditions"];
  evaluations: Evaluation[];
  configurationVersion: number;
  status: string;
  pauseReason: string | null;
  triggerProximity: string;
  createdAt: string;
  armedAt: string | null;
  executedAt: string | null;
  updatedAt: string;
  reservation?: Reservation | null;
}

export interface Workspace {
  identity: { id: string; label: string };
  portfolio: {
    id: string;
    generation: number;
    dataMode: Provenance;
    demoStep: number;
    version: number;
    balances: { SOL: Balance; USDC: Balance };
  };
  frame: Frame;
  ghosts: Trigger[];
}

export interface EngineStatus {
  status: "OPERATIONAL" | "DEGRADED";
  workerActive: boolean;
  outboxPending: number;
}

export interface RuntimeCapabilities {
  environment: "development" | "preview" | "production-sandbox" | "production-rialo";
  executionMode: "SANDBOX" | "RIALO";
  features: { aiComposer: boolean; replay: boolean; multiStage: boolean; rialo: boolean; demoFeed: boolean; advancedConditions: boolean };
}

/** The live trigger states, in the order a trader scans them. */
export const ACTIVE_STATUSES = ["WATCHING", "PAUSED", "DRAFT"] as const;
export const TERMINAL_STATUSES = ["FILLED", "CANCELLED", "EXPIRED", "FAILED"] as const;

export function isTerminal(status: string): boolean {
  return (TERMINAL_STATUSES as readonly string[]).includes(status);
}
