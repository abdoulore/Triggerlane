import type { AdapterCapabilityMatrix, GhostIR, TargetCompilation } from "@ghost/domain";
import { CapabilityCheckedAdapter } from "../execution-adapter.js";

/**
 * Deliberately conservative until a verified Rialo toolchain, network and venue exist.
 * This adapter never fabricates deployment payloads or network receipts.
 */
export class RialoAutomationAdapter extends CapabilityCheckedAdapter {
  readonly capabilities: AdapterCapabilityMatrix = {
    target: "RIALO",
    configured: false,
    predicates: [],
    provenance: [],
    actions: [],
    assets: [],
    semantics: [],
    accountPermissions: "UNAVAILABLE",
    retry: "UNAVAILABLE",
    cancellation: "UNAVAILABLE",
    executionVenue: "UNAVAILABLE",
  };

  override compile(ir: GhostIR): TargetCompilation {
    return super.compile(ir);
  }
}
