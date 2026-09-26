import type { Metadata } from "next";
import { NacreDashboard } from "@/components/nacre-dashboard";

export const metadata: Metadata = { title: "Simulation | Nacre", description: "A labeled 30 day local settlement scenario with saved transaction receipts." };
export default function SimulationPage() { return <NacreDashboard view="simulation" />; }
