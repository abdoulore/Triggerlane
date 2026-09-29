"use client";

import { useParams } from "next/navigation";
import { DetailScreen } from "@/features/detail/detail-screen";

export default function GhostDetailPage() {
  const params = useParams<{ id: string }>();
  return <DetailScreen triggerId={params.id} />;
}
