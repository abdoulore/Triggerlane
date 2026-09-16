"use client";

import { useParams } from "next/navigation";
import { DetailScreen } from "@/features/detail/detail-screen";

/** The rebuilt trigger detail, served alongside the current /ghost/[id]. */
export default function TriggerDetailRebuildPage() {
  const params = useParams<{ id: string }>();
  return <DetailScreen triggerId={params.id} />;
}
