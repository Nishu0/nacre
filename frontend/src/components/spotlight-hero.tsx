"use client";

import Image from "next/image";
import { useRef, type PointerEvent, type ReactNode } from "react";
import { FlowDither } from "@/components/flow-dither";

export function SpotlightHero({ children }: { children: ReactNode }) {
  const heroRef = useRef<HTMLElement>(null);

  function handlePointerMove(event: PointerEvent<HTMLElement>) {
    if (event.pointerType === "touch") return;
    const hero = heroRef.current;
    if (!hero) return;
    const bounds = hero.getBoundingClientRect();
    hero.style.setProperty("--spot-x", `${event.clientX - bounds.left}px`);
    hero.style.setProperty("--spot-y", `${event.clientY - bounds.top}px`);
    hero.dataset.spotlight = "active";
  }

  function handlePointerLeave() {
    if (heroRef.current) heroRef.current.dataset.spotlight = "idle";
  }

  return (
    <section ref={heroRef} className="spotlight-hero" data-spotlight="idle" onPointerMove={handlePointerMove} onPointerLeave={handlePointerLeave} aria-label="Nacre introduction">
      <div className="hero-image hero-image-base" aria-hidden="true"><Image src="/nacre-hero.png" alt="" fill priority sizes="100vw" /></div>
      <div className="hero-image hero-image-reveal" aria-hidden="true"><Image src="/nacre-hero.png" alt="" fill priority sizes="100vw" /></div>
      <div className="hero-tint" aria-hidden="true" /><FlowDither /><div className="hero-grain" aria-hidden="true" />
      {children}
    </section>
  );
}
