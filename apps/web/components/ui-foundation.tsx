"use client";

import { motion } from "motion/react";
import { formatMetric, type Metric } from "@ghost/domain";

export function StatusBadge({ status }: { status: string }) {
  return <motion.span layout key={status} initial={{ opacity: 0.5, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} className={`status status-${status.toLowerCase().replaceAll("_", "-")}`}>{status.replaceAll("_", " ")}</motion.span>;
}

export function MetricValue({ metric, value }: { metric: Metric; value: string }) {
  return <span className="metric-value">{formatMetric(metric, value)}</span>;
}

export function ProvenanceLabel({ mode, provider }: { mode: "DEMO" | "LIVE"; provider: string }) {
  return <span className={`provenance-label ${mode.toLowerCase()}`}><i />{mode === "DEMO" ? "SIMULATED" : "LIVE"} · {provider}</span>;
}
