"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

/**
 * Scroll reveals for the whole site: one IntersectionObserver per page,
 * mounted once in the root layout. Markup opts in with attributes:
 *
 *   data-reveal          a block fades in and rises 14px
 *   data-reveal-stagger  each direct child does, left to right along its row
 *   data-reveal-shelf    a shelf's spines rise in sequence, once
 *
 * Nothing is hidden by the server HTML. The <head> script sets html.js-reveal
 * (not under reduced motion), and only then does this arm elements, and only
 * ones still below the viewport, so the first screen and the LCP element never
 * animate and content is complete without JavaScript. Where CSS scroll-driven
 * animations exist, data-reveal blocks are handed to `animation-timeline:
 * view()` and never observed; grids and shelves keep the timed stagger.
 * The motion itself is in globals.css ("Scroll reveals").
 */
const seen = new WeakSet<Element>();
let io: IntersectionObserver | null = null;

function reveal(entries: IntersectionObserverEntry[]) {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    const el = e.target as HTMLElement;
    io!.unobserve(el);
    el.dataset.rv = "in";
    // Drop the attribute once the motion is over so nothing lingers.
    setTimeout(() => el.removeAttribute("data-rv"), 1600);
  }
}

function arm(el: HTMLElement, mode: "armed" | "sd", delay = 0) {
  // Not laid out yet (a streamed segment still parked in a hidden div): try
  // again on the next scan.
  if (seen.has(el) || !el.getClientRects().length) return;
  seen.add(el);
  // Already on screen (or scrolled past): leave it exactly as painted.
  if (el.getBoundingClientRect().top < innerHeight) return;
  if (delay) el.style.setProperty("--rd", `${delay}ms`);
  el.dataset.rv = mode;
  if (mode === "armed") io!.observe(el);
}

function scan() {
  const sd = CSS.supports?.("animation-timeline: view()");
  document.querySelectorAll<HTMLElement>("[data-reveal]").forEach((el) => arm(el, sd ? "sd" : "armed"));
  document.querySelectorAll<HTMLElement>("[data-reveal-shelf]").forEach((el) => arm(el, "armed"));
  document.querySelectorAll<HTMLElement>("[data-reveal-stagger]").forEach((grid) => {
    const kids = Array.from(grid.children) as HTMLElement[];
    // Nothing new in this grid: skip the offsetTop reads.
    if (kids.every((k) => seen.has(k))) return;
    let rowTop = -1;
    let col = 0;
    for (const child of kids) {
      const top = child.offsetTop;
      col = top === rowTop ? col + 1 : 0;
      rowTop = top;
      // 50ms a column, capped so a wide row never drags.
      arm(child, "armed", Math.min(col, 5) * 50);
    }
  });
}

export function Reveal() {
  const pathname = usePathname();
  useEffect(() => {
    (window as Window & { __reveal?: number }).__reveal = 1;
    if (!document.documentElement.classList.contains("js-reveal") || !("IntersectionObserver" in window)) return;
    io ??= new IntersectionObserver(reveal, { rootMargin: "0px 0px -6% 0px" });
    scan();
    // Pages behind a loading.tsx stream in after this has run: scan what
    // they add, once a frame at most.
    let raf = 0;
    const mo = new MutationObserver(() => {
      if (!raf) raf = requestAnimationFrame(() => ((raf = 0), scan()));
    });
    mo.observe(document.querySelector("main") || document.body, { childList: true, subtree: true });
    return () => {
      mo.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [pathname]);
  return null;
}
