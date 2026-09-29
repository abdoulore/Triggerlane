"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { API_URL } from "./api";

/**
 * One server-sent events subscription for the whole app.
 *
 * A price tick refreshes the market view. The workspace is refetched only when a
 * frame was actually stored, because condition readiness is rewritten then and
 * carries no event of its own. Connection and demo-step events change no
 * readiness, so they do not trigger a workspace read.
 */
export function useLiveEvents(enabled: boolean) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let stream: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;

    const reconcile = () => Promise.all([
      queryClient.invalidateQueries({ queryKey: ["workspace"] }),
      queryClient.invalidateQueries({ queryKey: ["market-view"] }),
      queryClient.invalidateQueries({ queryKey: ["trigger"] }),
    ]);

    const connect = () => {
      if (stopped) return;
      stream = new EventSource(`${API_URL}/api/events`, { withCredentials: true });

      stream.onopen = () => {
        const recovering = attempt > 0;
        attempt = 0;
        if (recovering) void reconcile();
      };

      stream.onmessage = (event) => {
        let payload: { type: string; ghostId?: string };
        try {
          payload = JSON.parse(event.data) as typeof payload;
        } catch {
          return;
        }
        if (payload.type === "heartbeat" || payload.type === "connected") return;

        if (payload.type.startsWith("market.")) {
          void queryClient.invalidateQueries({ queryKey: ["market-view"] });
          if (payload.type === "market.frame.updated") void queryClient.invalidateQueries({ queryKey: ["workspace"] });
        }
        if (payload.type.startsWith("ghost.")) {
          void queryClient.invalidateQueries({ queryKey: ["workspace"] });
          void queryClient.invalidateQueries({ queryKey: payload.ghostId ? ["trigger", payload.ghostId] : ["trigger"] });
        }
        if (payload.type.startsWith("portfolio.")) void queryClient.invalidateQueries({ queryKey: ["workspace"] });
      };

      stream.onerror = () => {
        stream?.close();
        if (stopped) return;
        const delay = Math.min(15_000, 1_000 * 2 ** attempt);
        attempt += 1;
        reconnectTimer = setTimeout(connect, delay);
      };
    };

    connect();
    return () => {
      stopped = true;
      stream?.close();
      if (reconnectTimer) clearTimeout(reconnectTimer);
    };
  }, [enabled, queryClient]);
}
