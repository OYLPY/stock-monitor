import type { Metadata } from "next";

import { EventCenter } from "@/components/events/event-center";
import { loadMarketEvents } from "@/features/evidence/event-center";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const metadata: Metadata = { title: "异常与事件 | 量化研究工作台" };

type VerificationLevel = "VERIFIED" | "PARTIAL" | "NOT_VERIFIED" | "DEMO_ONLY";
type SearchParams = Record<string, string | string[] | undefined>;

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function EventsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const rawMarket = firstValue(params.market);
  const rawVerification = firstValue(params.verification);
  const market = rawMarket === "JP" || rawMarket === "US" ? rawMarket : "";
  const verificationLevels: VerificationLevel[] = [
    "VERIFIED",
    "PARTIAL",
    "NOT_VERIFIED",
    "DEMO_ONLY",
  ];
  const verification = verificationLevels.includes(
    rawVerification as VerificationLevel,
  )
    ? (rawVerification as VerificationLevel)
    : "";
  const allEvents = await loadMarketEvents();
  const events = allEvents.filter((event) => {
    const latest = event.revisions.at(-1);
    return (
      (!market || latest?.marketCode === market) &&
      (!verification || latest?.verificationLevel === verification)
    );
  });

  return (
    <EventCenter
      events={events}
      filters={{ market, verification }}
      totalEvents={allEvents.length}
    />
  );
}
