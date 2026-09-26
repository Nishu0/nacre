import type { Metadata } from "next";
import { NacreDashboard } from "@/components/nacre-dashboard";

export const metadata: Metadata = { title: "Reference data — Nacre", description: "Historical Uniswap pool fee references for Nacre research." };
export default function ReferencesPage() { return <NacreDashboard view="references" />; }
