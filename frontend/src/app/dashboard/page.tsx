import type { Metadata } from "next";

import { NacreDashboard } from "@/components/nacre-dashboard";
import "./dashboard.css";

export const metadata: Metadata = {
  title: "Dashboard — Nacre",
  description: "Explore fee income, protection, positions, and competing cover quotes in the Nacre dashboard.",
};

export default function DashboardPage() {
  return <NacreDashboard />;
}
