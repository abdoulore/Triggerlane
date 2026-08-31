# Triggerlane Controlled Demo

Use Demo Feed throughout the executable portion. Never describe a settlement as a live trade or Rialo transaction.

1. Open `/trade` and point out `DEMO EXECUTION`, the seeded SOL/USDC portfolio, and the current observations.
2. Keep the default `SOL profit lock`: sell 25% when price is at least $280, funding is at least 0.05%, and position P&L is at least 10%.
3. Explain that a trader can remove price, funding, or P&L and use only the signals they need.
4. Select `SAVE TRIGGER`, then start the trigger. Confirm that simulated SOL moves from available to reserved capital without changing total owned quantity.
5. Advance the feed until only part of the condition set is ready. Open Trigger Detail and explain the exact waiting reason.
6. Advance again until all active conditions agree on one complete post-start frame. Confirm the single `TRIGGERED -> EXECUTING -> FILLED` path and updated sandbox balances.
7. Advance the feed once more. Confirm History still contains exactly one execution.
8. Open the receipt and identify the immutable frame, observation provenance, modeled slippage, reservation, and ledger transaction.
9. Switch to Live Data. Confirm the interface says `LIVE DATA - MONITORING ONLY` and execution controls are unavailable.

Expected duration: 90 seconds.

Recovery: refresh the page. The anonymous session and Sandbox state persist in the local PGlite store.
