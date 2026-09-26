import type { Metadata } from "next";
import { NacreDashboard } from "@/components/nacre-dashboard";

export const metadata: Metadata = { title: "Launch steps — Nacre", description: "How a funded Nacre liquidity protection market launches." };
export default function LaunchPage() { return <NacreDashboard view="launch" />; }
