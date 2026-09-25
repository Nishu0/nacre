"use client";

import { useEffect, useRef } from "react";

export function FlowDither({ className = "hero-flow-dither", spacing = 7 }: { className?: string; spacing?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    let width = 0;
    let height = 0;
    let lastDraw = 0;
    let visible = false;

    function resize() {
      if (!canvas) return;
      const bounds = canvas.getBoundingClientRect();
      width = Math.ceil(bounds.width);
      height = Math.ceil(bounds.height);
      canvas.width = width;
      canvas.height = height;
      draw(0);
    }

    function draw(time: number) {
      if (!context) return;
      context.clearRect(0, 0, width, height);
      const phase = reducedMotion.matches ? 0 : time * 0.00028;

      for (let y = 0; y < height; y += spacing) {
        const verticalFade = Math.min(1, y / 110, (height - y) / 85);
        for (let x = 0; x < width; x += spacing) {
          const bend = Math.sin(y * 0.012 + phase * 2.2) * 44;
          const wave = Math.sin((x + bend) * 0.018 - phase * 3.1);
          const counterwave = Math.sin(x * 0.008 + y * 0.016 + phase * 1.7);
          const light = Math.max(0, wave * 0.56 + counterwave * 0.3 + 0.13);
          const alpha = Math.min(0.38, light * 0.34 * verticalFade);
          if (alpha < 0.035) continue;
          context.fillStyle = `rgba(69, 231, 93, ${alpha.toFixed(3)})`;
          context.fillRect(x, y, 2, 2);
        }
      }
    }

    function animate(time: number) {
      frame = 0;
      if (!visible) return;
      if (time - lastDraw >= 40) {
        draw(time);
        lastDraw = time;
      }
      frame = window.requestAnimationFrame(animate);
    }

    const observer = new ResizeObserver(resize);
    const visibilityObserver = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible) {
        draw(performance.now());
        if (!reducedMotion.matches && !frame) frame = window.requestAnimationFrame(animate);
      } else {
        window.cancelAnimationFrame(frame);
        frame = 0;
      }
    });
    observer.observe(canvas);
    visibilityObserver.observe(canvas);
    resize();

    return () => {
      observer.disconnect();
      visibilityObserver.disconnect();
      window.cancelAnimationFrame(frame);
    };
  }, [spacing]);

  return <canvas ref={canvasRef} className={className} aria-hidden="true" />;
}
