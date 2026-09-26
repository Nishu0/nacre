import type { Metadata } from "next";

import { NacreDashboard } from "@/components/nacre-dashboard";
import "./dashboard.css";
import "./dashboard-research.css";

export const metadata: Metadata = {
  title: "Dashboard — Nacre",
  description: "Explore historical fee backtests and the steps to launch a Nacre protection market.",
};

export default function DashboardPage() {
  return <NacreDashboard />;
}
