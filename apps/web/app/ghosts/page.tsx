import { TriggersScreen } from "@/features/triggers/triggers-screen";

export default async function GhostsPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const params = await searchParams;
  return <TriggersScreen initialFilter={params.view === "past" ? "FINISHED" : "WATCHING"} />;
}
