import type { Metadata } from "next";
import { NacreDashboard } from "@/components/nacre-dashboard";

export const metadata: Metadata = {
  title: "Create pool — Nacre",
  description: "Configure the token pair, starting price and trading fee for a Nacre pool.",
};

export default function CreatePoolPage() {
  return <NacreDashboard view="pool-create" />;
}
