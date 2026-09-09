import { GhostApp } from "@/components/ghost-app";

export default async function GhostsPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const params = await searchParams;
  return <GhostApp view="ghosts" triggerSection={params.view === "past" ? "past" : "active"} />;
}
