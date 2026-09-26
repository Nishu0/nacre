import type { Metadata } from "next";
import { NacreDashboard } from "@/components/nacre-dashboard";

export const metadata: Metadata = {
  title: "Create pool — Nacre",
  description: "Choose a coverage range, funding terms, and create a funded Nacre bid.",
};

export default function CreatePoolPage() {
  return <NacreDashboard view="pool-create" />;
}
