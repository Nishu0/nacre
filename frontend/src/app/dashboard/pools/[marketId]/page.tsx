import type { Metadata } from "next";
import { NacreDashboard } from "@/components/nacre-dashboard";

export const metadata: Metadata = {
  title: "Pool details — Nacre",
  description: "Review a Nacre market range, funding, and available protection.",
};

export default async function PoolDetailPage({ params }: {
  params: Promise<{ marketId: string }>;
}) {
  const { marketId } = await params;
  return <NacreDashboard view="pool-detail" marketId={marketId} />;
}
