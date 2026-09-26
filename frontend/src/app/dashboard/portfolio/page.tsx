import type { Metadata } from "next";
import { NacreDashboard } from "@/components/nacre-dashboard";

export const metadata: Metadata = { title: "Portfolio — Nacre", description: "See Nacre positions, invested capital, fee income, and coverage." };
export default function PortfolioPage() { return <NacreDashboard view="portfolio" />; }
