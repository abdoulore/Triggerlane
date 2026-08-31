import type { AdapterCapabilityMatrix } from "@ghost/domain";
import { CapabilityCheckedAdapter } from "../execution-adapter.js";

export class SandboxAutomationAdapter extends CapabilityCheckedAdapter {
  readonly capabilities: AdapterCapabilityMatrix = {
    target: "SANDBOX",
    configured: true,
    predicates: ["PRICE", "FUNDING", "PNL"],
    provenance: ["DEMO"],
    actions: ["BUY", "SELL"],
    assets: ["SOL", "USDC"],
    semantics: ["ONE_SHOT", "COMPLETE_FRAME", "EXPIRATION", "MAX_SLIPPAGE"],
    accountPermissions: "ANONYMOUS_SANDBOX",
    retry: "IDEMPOTENT",
    cancellation: "SUPPORTED",
    executionVenue: "SANDBOX_LEDGER",
  };
}
