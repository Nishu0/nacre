import type { Metadata } from "next";
import { NacreDashboard } from "@/components/nacre-dashboard";

export const metadata: Metadata = { title: "Pools — Nacre", description: "Explore Nacre protection pools and their funding status." };
export default function PoolsPage() { return <NacreDashboard view="pools" />; }
