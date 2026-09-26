"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { ArrowUpRight, Pause, Play } from "lucide-react";
import Link from "next/link";
import styles from "./protection-journey.module.css";

const stages = [
  { title: "Fund a range", role: "THE UNDERWRITER", description: "Back a price range with capital. Set the premium, duration and available spots.", detail: "Protection starts with funded capital, ready for an LP to buy coverage." },
  { title: "Make it yours", role: "THE LIQUIDITY PROVIDER", description: "Choose a funded range, narrow it to fit, and supply your two tokens on Uniswap v4.", detail: "Your position stays within the bid’s funded boundaries. You choose how concentrated it is." },
  { title: "Protect your fees", role: "THE AGREEMENT", description: "Choose an eligible fee target and pay the premium to activate your coverage.", detail: "Coverage begins when you buy it. Supplying liquidity alone does not activate protection." },
  { title: "Settle the difference", role: "THE OUTCOME", description: "At expiry, eligible fees are measured. Collateral covers a shortfall up to your policy’s cap.", detail: "Earned fees above the target? No payout is needed. Below it? Coverage pays the eligible difference." },
];

function JourneyArt({ step }: { step: number }) {
  return <svg viewBox="0 0 200 112" fill="none" aria-hidden="true">
    {step === 0 && <>
      <path d="M22 91H178" className={styles.faint} />
      <path d="M48 20V92M152 20V92" className={styles.boundary} />
      {[28, 43, 58, 75, 66, 48, 33].map((height, i) => <rect key={i} className={styles.bar} x={38 + i * 18} y={91 - height} width="12" height={height} style={{ "--delay": `${i * 90}ms` } as CSSProperties} />)}
      <path d="M48 14H152" className={styles.ink} /><path d="m48 10-4 4 4 4m104-8 4 4-4 4" className={styles.ink} />
    </>}
    {step === 1 && <>
      <rect x="49" y="17" width="102" height="77" rx="3" className={styles.rangeFill} />
      <path d="M23 94H177M49 16V95M151 16V95" className={styles.faint} />
      <path d="m25 73 24-12 20 7 23-29 20 9 21-16 21 11 22-14" className={styles.draw} pathLength="1" />
      <g className={styles.handles}><path d="M69 20V92M131 20V92" className={styles.ink} /><rect x="64" y="74" width="10" height="19" rx="3" fill="currentColor" /><rect x="126" y="74" width="10" height="19" rx="3" fill="currentColor" /></g>
    </>}
    {step === 2 && <>
      <path d="M100 12 137 27V53c0 23-22 38-37 46-15-8-37-23-37-46V27Z" className={styles.shield} />
      <path d="m83 54 12 12 24-27" className={styles.draw} pathLength="1" />
      <circle cx="39" cy="53" r="11" className={styles.faint} /><path d="M35 53h8m-4-4v8" className={styles.ink} />
      <circle className={styles.payment} cx="43" cy="53" r="3" fill="currentColor" />
      <path d="M153 43h17m-17 10h23m-23 10h13" className={styles.faint} />
    </>}
    {step === 3 && <>
      <path d="M28 91H174M28 31H174" className={styles.faint} strokeDasharray="3 5" />
      <rect x="48" y="59" width="34" height="32" className={styles.earned} />
      <rect x="48" y="31" width="34" height="26" className={styles.payout} />
      <rect x="119" y="31" width="34" height="60" className={styles.earned} opacity=".4" />
      <path d="M94 59h12m-4-4 5 4-5 4" className={styles.ink} />
      <path d="m128 19 5 5 10-11" className={styles.draw} pathLength="1" />
    </>}
  </svg>;
}

export function ProtectionJourney() {
  const root = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const [visible, setVisible] = useState(false);
  const [reduced, setReduced] = useState(true);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(media.matches);
    sync(); media.addEventListener("change", sync);
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: .2 });
    if (root.current) observer.observe(root.current);
    return () => { media.removeEventListener("change", sync); observer.disconnect(); };
  }, []);
  const playing = visible && !paused && !reduced;
  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => setActive((step) => (step + 1) % stages.length), 4200);
    return () => window.clearInterval(timer);
  }, [playing]);

  return <div ref={root} className={styles.journey} data-playing={playing} aria-label="How Nacre fee protection works">
    <div className={styles.heading}>
      <div><span className={styles.eyebrow}>FROM RANGE TO REASSURANCE</span><h3>Four steps. A floor beneath your fees.</h3></div>
      {!reduced && <button className={styles.playback} type="button" onClick={() => setPaused(!paused)} aria-label={paused ? "Play protection animation" : "Pause protection animation"}>{paused ? <Play size={13} /> : <Pause size={13} />}{paused ? "Play" : "Pause"}</button>}
    </div>
    <div className={styles.timeline} style={{ "--step": active } as CSSProperties}>
      <div className={styles.rail} aria-hidden="true"><span className={styles.traveler} /></div>
      <ol className={styles.stages}>
        {stages.map((stage, index) => <li key={stage.title} className={styles.stage} data-active={active === index}>
          <button type="button" className={styles.stepButton} aria-pressed={active === index} onClick={() => { setActive(index); setPaused(true); }}>
            <div className={styles.art}><JourneyArt step={index} /></div>
            <span className={styles.checkpoint} aria-hidden="true" />
            <span className={styles.stepTitle}><span className={styles.number}>0{index + 1}</span>{stage.title}</span>
          </button>
          <span className={styles.role}>{stage.role}</span>
          <p>{stage.description}</p>
        </li>)}
      </ol>
    </div>
    <div className={styles.footer}>
      <p><span className={styles.detailNumber}>0{active + 1} / 04</span>{stages[active].detail}</p>
      <Link href="/dashboard/pools">Explore funded ranges <ArrowUpRight size={16} aria-hidden="true" /></Link>
    </div>
    <p className={styles.note}>Fee income protection · Payouts are capped by the policy · LP principal and impermanent loss are not covered</p>
  </div>;
}
