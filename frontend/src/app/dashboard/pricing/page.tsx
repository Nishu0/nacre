import type { Metadata } from "next";
import { NacreDashboard } from "@/components/nacre-dashboard";

export const metadata: Metadata = { title: "Premium model — Nacre", description: "Explore indicative fee floors and protection premiums." };
export default function PricingPage() { return <NacreDashboard view="pricing" />; }
