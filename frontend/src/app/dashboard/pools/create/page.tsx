import type { Metadata } from "next";
import { NacreDashboard } from "@/components/nacre-dashboard";

export const metadata: Metadata = {
  title: "Create pool — Nacre",
  description: "Configure and review a Nacre sandbox pool draft.",
};

export default function CreatePoolPage() {
  return <NacreDashboard view="pool-create" />;
}
