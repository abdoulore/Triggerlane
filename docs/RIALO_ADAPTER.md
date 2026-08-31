# Triggerlane Rialo Adapter Boundary

Triggerlane implements the Rialo integration only as far as verified access permits. Every validated Composer draft compiles into the same versioned execution intent consumed by Sandbox target checks. The current internal schema is named `GhostIR` v1 for compatibility with the original codebase; that legacy identifier is not a claim about the current product brand.

## Current Architecture

```text
Demo or monitoring data -> Trigger configuration -> GhostIR v1 -> Sandbox adapter -> Sandbox ledger
                                                          |
                                                          -> Rialo adapter -> NOT_CONFIGURED
```

`SandboxAutomationAdapter` declares the predicates, provenance, actions, assets, semantics, permissions, retry behavior, cancellation behavior, and execution venue it supports. `RialoAutomationAdapter` implements the same boundary under `apps/api/src/integrations/rialo`, but conservatively declares every unverified capability unavailable.

Compilation returns all unsupported requirements in one structured report. It never reinterprets intent and never returns a partial Rialo workflow as deployable.

## Implemented

- `GhostIR` v1 schema and deterministic compiler
- complete-frame, one-shot, expiry, exact-unit, and slippage semantics
- target capability matrices
- Sandbox and Rialo automation adapter boundaries
- authenticated target and compiler-preview APIs
- Composer contract inspector
- conformance tests for units, operators, expiration, one-shot behavior, and unsupported-capability reporting

## Blocked By Access

- verified Rialo SDK or CLI
- network endpoint and account permissions
- supported predicate and feed contracts
- reactive workflow serialization
- retry, cancellation, and lifecycle semantics
- a qualified SOL/USDC execution venue
- transaction receipt and explorer formats

Until those are verified, there is no deploy endpoint. The UI does not display a Rialo transaction hash, block, gas amount, confirmation, or explorer link.

## API

- `GET /api/execution-targets` returns declared adapter capabilities.
- `POST /api/compiler/preview` validates a `GhostDraft`, emits `GhostIR`, and checks each target.

`networkArtifacts` is explicitly `null` while Rialo is unavailable.
