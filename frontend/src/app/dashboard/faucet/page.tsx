import type { Metadata } from "next";
import { NacreDashboard } from "@/components/nacre-dashboard";

export const metadata: Metadata = { title: "Test USDC faucet — Nacre" };
export default function FaucetPage() { return <NacreDashboard view="faucet" />; }
