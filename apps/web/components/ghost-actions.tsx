"use client";

import { ArrowRight, Lightning, Pause, Play, X } from "@phosphor-icons/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

type ActionGhost = { id: string; name: string; status: string };

export function GhostActions({ ghost, context = "row" }: { ghost: ActionGhost; context?: "row" | "detail" }) {
  const queryClient = useQueryClient();
  const mutate = useMutation({
    mutationFn: (action: "pause" | "resume" | "cancel" | "arm") => api(`/api/ghosts/${ghost.id}/${action}`, { method: "POST" }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["workspace"] });
      void queryClient.invalidateQueries({ queryKey: ["ghost", ghost.id] });
      void queryClient.invalidateQueries({ queryKey: ["ghost-activity", ghost.id] });
    },
  });
  const terminal = ["FILLED", "CANCELLED", "EXPIRED", "FAILED"].includes(ghost.status);
  const pending = mutate.isPending;
  const error = mutate.error instanceof Error ? mutate.error.message : null;
  return (
    <div className={`ghost-action-wrap ${context === "detail" ? "detail-actions" : ""}`}>
      <div className="row-actions">
        <button aria-label="Start trigger" title={ghost.status === "DRAFT" ? "Start Trigger" : `Start unavailable while status is ${ghost.status}`} disabled={ghost.status !== "DRAFT" || pending} onClick={() => mutate.mutate("arm")}><Lightning size={17} />{context === "detail" && <span>START</span>}</button>
        {ghost.status === "PAUSED" ? <button aria-label="Resume trigger" title="Resume Trigger" disabled={pending} onClick={() => mutate.mutate("resume")}><Play size={17} />{context === "detail" && <span>RESUME</span>}</button> : <button aria-label="Pause trigger" title={ghost.status === "WATCHING" ? "Pause Trigger" : `Pause unavailable while status is ${ghost.status}`} disabled={ghost.status !== "WATCHING" || pending} onClick={() => mutate.mutate("pause")}><Pause size={17} />{context === "detail" && <span>PAUSE</span>}</button>}
        <button aria-label="Cancel trigger" title={terminal ? `Cancel unavailable while status is ${ghost.status}` : "Cancel Trigger"} disabled={terminal || pending} onClick={() => mutate.mutate("cancel")}><X size={17} />{context === "detail" && <span>CANCEL</span>}</button>
        {context === "row" && <a aria-label={`Open ${ghost.name}`} title="Open Trigger" href={`/ghost/${ghost.id}`}><ArrowRight size={17} /></a>}
      </div>
      {error && <small className="row-action-error" role="alert">{error}</small>}
    </div>
  );
}
