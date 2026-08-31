import { compileForTarget, type AdapterCapabilityMatrix, type GhostIR, type TargetCompilation } from "@ghost/domain";

export interface ExecutionAdapter {
  readonly capabilities: AdapterCapabilityMatrix;
  compile(ir: GhostIR): TargetCompilation;
}

export abstract class CapabilityCheckedAdapter implements ExecutionAdapter {
  abstract readonly capabilities: AdapterCapabilityMatrix;

  compile(ir: GhostIR): TargetCompilation {
    return compileForTarget(ir, this.capabilities);
  }
}
