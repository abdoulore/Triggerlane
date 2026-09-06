# Data Providers

## Gate 0 decision

**Decision:** Hyperliquid Live Data is monitoring-only. The deterministic Demo Feed is execution-eligible.

Checked again on 2026-09-06 against the official Hyperliquid REST, perpetuals, funding, and rate-limit documentation.

## Hyperliquid candidate

- Endpoint: `wss://api.hyperliquid.xyz/ws`
- Subscription: `{ "type": "activeAssetCtx", "coin": "SOL" }`
- Declared fields include `markPx`, `midPx`, `oraclePx`, and `funding` in one `WsActiveAssetCtx` envelope.
- The documented envelope does not include a provider/server source timestamp or sequence.
- Reconnects and snapshots must be handled; the official docs warn that server disconnects may occur.
- WebSocket clients must send a ping when no outbound message has been sent for 60 seconds.

## Current REST contract

- `metaAndAssetCtxs` supplies the SOL perpetual context used by Triggerlane.
- The displayed price is `markPx` for `SOL-PERP`, quoted in USDC. It is not described as a SOL spot-market price.
- `funding` is stored as a ratio and displayed as a one-hour rate. Hyperliquid documents hourly funding payments and says the funding interval does not depend on the asset.
- `prevDayPx` is the only source used for the visible 24-hour change. If it is absent, invalid, or zero, Triggerlane shows the change as unavailable.
- The documented asset-context response has no provider source timestamp. This is an inference from the documented response schema, so Triggerlane keeps `sourceTimestamp` null and records `receivedAt` only after the response arrives.
- Live execution remains disabled because receipt time is not treated as trusted source time.

## Chart history

- Live history uses the official `candleSnapshot` request for `SOL`.
- Supported product intervals are `1m`, `5m`, and `1h`; each visible selector sends that exact aggregation interval.
- The provider documents a maximum of 5,000 recent candles. Triggerlane requests bounded windows, validates symbol/interval/finite close values, orders timestamps, and removes duplicates.
- If candle history fails while the latest context succeeds, the current mark remains visible and the chart explicitly reports unavailable history.
- Demo charts use only persisted `PRICE` observations from the active portfolio. Sparse manual steps remain sparse and are labeled Demo steps; no points are generated or interpolated.

## Cache and failure policy

- The API owns one shared provider instance, coalesces concurrent requests by interval, and caches successful views for five seconds.
- A refresh failure may retain the last Live snapshot only as visibly `STALE` data with its original receive time.
- A first-request failure returns `UNAVAILABLE` with null price and funding. Demo values are never substituted into a Live response.
- Provider failures enter a short retry backoff. A later successful request restores `FRESH` status and a new snapshot identifier.

## Product behavior

- Live mode polls the public Hyperliquid info endpoint for SOL mark price and funding.
- Observations display provider and receive time.
- Live mode cannot start or settle triggers because `receivedAt` is not accepted as `sourceTimestamp`.
- The application never falls back from Live to Demo without the user changing modes.
- Demo Feed observations have deterministic values, explicit timestamps, stable sequence numbers, and `DEMO` provenance.

## Qualification needed for live execution

A future provider must supply price and funding with compatible units, trusted source timestamps, ordering semantics, no more than 60 seconds of cross-metric skew, and acceptable usage terms.

## Sources

- https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/perpetuals
- https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint
- https://hyperliquid.gitbook.io/hyperliquid-docs/trading/funding
- https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/rate-limits-and-user-limits
- https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket/subscriptions
- https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket
- https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket/timeouts-and-heartbeats
