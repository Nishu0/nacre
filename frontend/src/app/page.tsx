import Link from "next/link";
import { ArrowDown, ArrowRight, ArrowUpRight, MoveUpRight } from "lucide-react";

import { SpotlightHero } from "@/components/spotlight-hero";
import { FlowDither } from "@/components/flow-dither";
import { ExampleTabs } from "@/components/example-tabs";
import { ProtectionJourney } from "@/components/protection-journey";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

const steps = [
  {
    number: "01",
    title: "Set your floor.",
    description: "Choose the Uniswap position, a time window, and the minimum fee income you want to protect.",
    aside: "A guarantee shaped around your position.",
  },
  {
    number: "02",
    title: "Let the market quote.",
    description: "Independent underwriters compete to offer a premium. You choose the terms that work for you.",
    aside: "One risk. More than one price.",
  },
  {
    number: "03",
    title: "Keep your footing.",
    description: "If eligible fees finish below the agreed floor, locked collateral covers the shortfall up to the limit.",
    aside: "A clear outcome, settled onchain.",
  },
];

function ShellMark({ light = false }: { light?: boolean }) {
  return (
    <span className={light ? "shell-mark shell-mark-light" : "shell-mark"} aria-hidden="true">
      <svg viewBox="0 0 48 48" fill="none" role="presentation">
        <path d="M5 32.5C7.8 17.2 15.5 9.5 24 7c8.5 2.5 16.2 10.2 19 25.5-5 6.2-11.5 9.3-19 9.3S10 38.7 5 32.5Z" stroke="currentColor" strokeWidth="1.5" />
        <path d="M24 8v31M13 16l8 22M35 16l-8 22M7.5 26l11.7 12M40.5 26 28.8 38" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
        <path d="M10 32c9 3.3 19 3.3 28 0" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
      </svg>
    </span>
  );
}

function SectionDivider({ id, first, middle, last }: { id?: string; first: string; middle: string; last: string }) {
  return (
    <div id={id} className="section-divider page-gutter">
      <div className="checker" aria-hidden="true" />
      <div className="divider-meta"><span>{first}</span><span>{middle}</span><span>{last}</span></div>
    </div>
  );
}

export default function Home() {
  return (
    <main id="top" className="site-shell">
      <SpotlightHero>
        <header className="site-header page-gutter">
          <Link href="#top" className="wordmark" aria-label="Nacre home">
            <ShellMark light /><span>NACRE</span>
          </Link>
          <nav className="desktop-nav" aria-label="Main navigation">
            <Link href="#idea">The idea</Link>
            <Link href="#model">How it works</Link>
            <Link href="#example">The example</Link>
          </nav>
          <Button asChild className="header-cta" size="lg">
            <Link href="/dashboard">Try now <ArrowUpRight aria-hidden="true" /></Link>
          </Button>
        </header>

        <div className="hero-content page-gutter">
          <div className="hero-eyebrow"><span className="eyebrow-line" />A NEW THOUGHT FOR LIQUIDITY<span className="eyebrow-line" /></div>
          <h1>Nacre<span className="hero-period">.</span></h1>
          <p className="hero-deck">A floor beneath your fee income.</p>
          <p className="hero-description">Markets move. Ranges break. Nacre imagines a way for liquidity providers to protect the income they came for.</p>
          <div className="hero-actions">
            <Button asChild size="lg" className="button-ivory"><Link href="/dashboard">Open dashboard <ArrowUpRight aria-hidden="true" /></Link></Button>
            <Link href="#idea" className="hero-text-link">Discover the idea <ArrowRight aria-hidden="true" size={17} /></Link>
          </div>
        </div>

        <div className="hero-bottom page-gutter">
          <span>AN EXPERIMENT IN LP FEE PROTECTION</span>
          <Link href="#idea" className="scroll-cue" aria-label="Scroll to the idea">SCROLL TO EXPLORE <ArrowDown aria-hidden="true" size={15} /></Link>
          <span>MOVE TO REVEAL THE ARTWORK</span>
        </div>
      </SpotlightHero>

      <SectionDivider id="idea" first="CONCEPT / 001" middle="BUILT AROUND UNISWAP V4 & 1INCH AQUA" last="THE FUTURE OF LIQUIDITY PROTECTION" />

      <section className="idea-section section-pad page-gutter" aria-label="The idea">
        <div className="idea-grid">
          <div className="idea-heading-wrap">
            <p className="mini-overline">A BETTER WAY TO STAY IN THE GAME</p>
            <h2>When your range goes quiet, <em>your ambition shouldn&apos;t.</em></h2>
          </div>
          <div className="idea-copy-wrap">
            <p className="idea-lead">Concentrated liquidity puts your capital exactly where it can work hardest. But once price moves outside your range, the fees can stop.</p>
            <p>Choose a range backed by an underwriter. Supply liquidity, buy fee protection, and give your position a floor for the agreed period.</p>
            <div className="idea-signoff"><span>FUNDED RANGES. DEFINED TERMS.</span><ArrowUpRight aria-hidden="true" size={18} /></div>
          </div>
        </div>
        <ProtectionJourney />
      </section>

      <SectionDivider id="model" first="PROTECTION / 002" middle="A FLOOR FOR QUIET RANGES" last="NACRE / THE MODEL" />

      <section className="model-section section-pad page-gutter" aria-label="The model">
        <div className="model-heading-row"><h2>Protection, <em>priced by the market.</em></h2><p>No universal premium. No single price for every position. A clear request, competing quotes, and coverage tied to a real position.</p></div>
        <div className="steps-grid">
          {steps.map((step) => (
            <Card key={step.number} className="step-card">
              <CardContent className="step-card-inner">
                <div className="step-card-top"><span>{step.number}</span><MoveUpRight size={20} aria-hidden="true" /></div>
                <div><h3>{step.title}</h3><p>{step.description}</p></div>
                <div className="step-card-aside"><span className="small-spark">✳</span>{step.aside}</div>
              </CardContent>
            </Card>
          ))}
        </div>
        <div className="model-footnote"><ShellMark light /><p>Nacre</p><span>UNISWAP V4 × AQUA</span></div>
      </section>

      <SectionDivider id="example" first="MARKET / 003" middle="COMPETING QUOTES · CLEAR TERMS" last="UNISWAP V4 × AQUA" />

      <section className="example-section section-pad page-gutter" aria-label="The example">
        <div className="example-grid">
          <div className="example-intro">
            <Badge variant="outline" className="concept-badge">ILLUSTRATIVE EXAMPLE</Badge>
            <h2>What a little <em>certainty</em> could look like.</h2>
            <p>Imagine protecting a week of fees on an ETH/USDC liquidity position. This example shows the payout idea, not a live quote or available coverage.</p>
            <div className="example-side-note"><span className="note-rule" /><span>Same position. Same market.<br />A different outcome.</span></div>
          </div>
          <ExampleTabs />
        </div>
      </section>

      <SectionDivider first="OUTCOME / 004" middle="THE FEE FLOOR IN ACTION" last="NACRE / THE IDEA" />

      <section className="closing-section page-gutter">
        <FlowDither className="closing-flow-dither" spacing={9} />
        <div className="closing-content"><ShellMark light /><p className="mini-overline">THE NACRE IDEA</p><h2>The market moves.<br /><em>Your floor remains.</em></h2><Button asChild size="lg" className="button-ivory"><Link href="/dashboard">Try Nacre <ArrowUpRight aria-hidden="true" /></Link></Button></div>
      </section>

      <footer className="site-footer page-gutter">
        <div className="footer-main"><div className="footer-brand"><Link href="#top" className="wordmark footer-wordmark"><ShellMark /><span>NACRE</span></Link><p>An exploration of fee income protection for concentrated liquidity.</p></div><div className="footer-links"><Link href="#idea">The idea</Link><Link href="#model">The model</Link><Link href="#example">Example</Link></div></div>
        <Separator className="footer-separator" />
        <div className="footer-bottom"><span>© 2026 NACRE</span><Link href="#top">BACK TO TOP ↑</Link></div>
      </footer>
    </main>
  );
}
