import { TradeScreen } from "@/features/trade/trade-screen";

/**
 * The rebuilt Trade screen, served alongside the current one.
 *
 * Both trees stay alive until every screen is ported: the app keeps working and
 * the end-to-end suite keeps passing against /trade. The final change swaps the
 * routes, removes the old tree and rewrites the selectors in one pass.
 */
export default function TradeRebuildPage() {
  return <TradeScreen />;
}
