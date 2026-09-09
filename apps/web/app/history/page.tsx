import { redirect } from "next/navigation";

export default async function HistoryPage({ searchParams }: { searchParams: Promise<{ item?: string }> }) {
  const params = await searchParams;
  const query = new URLSearchParams({ view: "past" });
  if (params.item) query.set("item", params.item);
  redirect(`/ghosts?${query.toString()}`);
}
