import type { Metadata } from "next";
import { Geist, Geist_Mono, Instrument_Sans, JetBrains_Mono, Noto_Serif } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
const instrumentSans = Instrument_Sans({ variable: "--font-instrument-sans", subsets: ["latin"] });
const jetbrainsMono = JetBrains_Mono({ variable: "--font-jetbrains-mono", subsets: ["latin"] });
const notoSerif = Noto_Serif({ variable: "--font-noto-serif", subsets: ["latin"] });

export const metadata: Metadata = {
  metadataBase: new URL("https://nacre.lol"),
  title: "Nacre — A floor beneath your fee income",
  description: "Nacre is a concept for a market in Uniswap liquidity provider fee income protection, with competing quotes powered by 1inch Aqua.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return <html lang="en" className={`${geistSans.variable} ${geistMono.variable} ${instrumentSans.variable} ${jetbrainsMono.variable} ${notoSerif.variable}`}><body>{children}</body></html>;
}
