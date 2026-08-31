"use client";

import { useParams } from "next/navigation";
import { GhostApp } from "@/components/ghost-app";

export default function GhostDetailPage() {
  const params = useParams<{ id: string }>();
  return <GhostApp view="detail" ghostId={params.id} />;
}
