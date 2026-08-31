# Data Providers

## Gate 0 decision

**Decision:** Hyperliquid Live Data is monitoring-only. The deterministic Demo Feed is execution-eligible.

Checked on 2026-08-27 against the official Hyperliquid WebSocket documentation.

## Hyperliquid candidate

- Endpoint: `wss://api.hyperliquid.xyz/ws`
- Subscription: `{ "type": "activeAssetCtx", "coin": "SOL" }`
- Declared fields include `markPx`, `midPx`, `oraclePx`, and `funding` in one `WsActiveAssetCtx` envelope.
- The documented envelope does not include a provider/server source timestamp or sequence.
- Reconnects and snapshots must be handled; the official docs warn that server disconnects may occur.
- WebSocket clients must send a ping when no outbound message has been sent for 60 seconds.

## Product behavior

- Live mode polls the public Hyperliquid info endpoint for SOL mark price and funding.
- Observations display provider and receive time.
- Live mode cannot start or settle triggers because `receivedAt` is not accepted as `sourceTimestamp`.
- The application never falls back from Live to Demo without the user changing modes.
- Demo Feed observations have deterministic values, explicit timestamps, stable sequence numbers, and `DEMO` provenance.

## Qualification needed for live execution

A future provider must supply price and funding with compatible units, trusted source timestamps, ordering semantics, no more than 60 seconds of cross-metric skew, and acceptable usage terms.

## Sources

- https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket/subscriptions
- https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket
- https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket/timeouts-and-heartbeats
