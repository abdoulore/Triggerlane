# Triggerlane Guided Scenario

Use Guided Scenario when a predictable walkthrough is needed. Never describe a virtual settlement as a real trade or Rialo transaction.

1. Open `/trade` in Guided Scenario and point out the seeded virtual SOL/USDC portfolio and stored observations.
2. Keep the default `SOL profit lock`: sell 25% when price is at least $280, funding is at least 0.05%, and position P&L is at least 10%.
3. Explain that a trader can remove price, funding, or P&L and use only the signals they need.
4. Select `SAVE TRIGGER`, then start the trigger. Confirm that virtual SOL moves from available to reserved capital without changing total owned quantity.
5. Advance the scenario until only part of the condition set is ready. Open Trigger Detail and explain the exact waiting reason.
6. Advance again until all active conditions agree on one complete post-start frame. Confirm the single `TRIGGERED -> EXECUTING -> FILLED` path and updated virtual balances.
7. Advance the scenario once more. Confirm History still contains exactly one execution.
8. Open the receipt and identify the immutable frame, observation provenance, modeled slippage, reservation, and ledger transaction.
9. Switch to Live Data. Confirm the interface says `LIVE DATA - VIRTUAL EXECUTION` and deterministic scenario controls disappear.

Expected duration: 90 seconds.

Recovery: refresh the page. The anonymous session and paper account persist in the local PGlite store.
