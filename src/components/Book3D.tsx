"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

interface Book3DProps {
  /** Cover image URL. Empty/invalid → `fallback` is drawn on the front face. */
  src: string;
  alt: string;
  /** Rendered on the front face when there is no cover, or it fails to load. */
  fallback: ReactNode;
  /** Front-face width in px. Height is always 1.5× (2:3 cover). */
  width: number;
  /** Real page count, when known — sets how thick the book looks. */
  pageCount?: number | null;
  /** "eager" for the page's own hero cover (it is the LCP element). */
  loading?: "lazy" | "eager";
  className?: string;
}

// Resting pose: turned slightly so the spine (left) and the page block both
// read as volume without hiding much of the cover art.
const REST_X = 4; // deg, tipped back a little
const REST_Y = 20; // deg, spine toward the reader
// How far the pointer can swing the book from rest. Asymmetric on Y because
// rest already favours the spine: pointer-left opens the spine further,
// pointer-right has to travel past square-on to show the page block.
const RANGE_X = 10;
const RANGE_Y_SPINE = 26;
const RANGE_Y_PAGES = 46;

/**
 * Spine thickness as a fraction of cover width, from the page count.
 *
 * A 300-page trade paperback is roughly 13cm wide and 2cm thick (~0.15). The
 * curve is clamped so a 40-page picture book still has a visible spine and a
 * 1,200-page doorstop does not turn into a cube. Unknown → a mid-size book.
 */
export function bookDepthRatio(pageCount?: number | null): number {
  if (!pageCount || !Number.isFinite(pageCount) || pageCount <= 0) return 0.13;
  return Math.min(0.22, Math.max(0.06, 0.045 + pageCount / 3000));
}

/**
 * A book cover drawn as a real object: front cover, spine, page block, top
 * and bottom edges, and back cover, assembled with CSS 3D transforms (no
 * WebGL, no extra dependency).
 *
 * - Server-rendered in its resting pose, so there is no layout shift and the
 *   cover <img> is in the initial HTML for LCP and image search.
 * - The pointer tilts it (mouse hover, or a horizontal drag on touch, which
 *   leaves vertical scrolling alone). Motion is eased in a rAF loop that
 *   writes two CSS custom properties — React never re-renders on move.
 * - The spine reuses the cover image's left edge, so its colour matches the
 *   book without a canvas colour-extraction pass (which would need CORS).
 * - prefers-reduced-motion: static pose, no tilt, float or entrance.
 */
export function Book3D({
  src,
  alt,
  fallback,
  width,
  pageCount,
  loading = "lazy",
  className = "",
}: Book3DProps) {
  const [failed, setFailed] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const bookRef = useRef<HTMLDivElement>(null);
  const hasCover = Boolean(src) && !failed;

  useEffect(() => {
    const stage = stageRef.current;
    const book = bookRef.current;
    if (!stage || !book) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    let target = { x: 0, y: 0 }; // -1..1 offsets from rest
    let current = { x: 0, y: 0 };
    let raf = 0;
    let dragging = false;
    let dragStartX = 0;

    const write = () => {
      book.style.setProperty("--tilt-x", `${(REST_X - current.y * RANGE_X).toFixed(2)}deg`);
      const y = REST_Y - current.x * (current.x < 0 ? RANGE_Y_SPINE : RANGE_Y_PAGES);
      book.style.setProperty("--tilt-y", `${y.toFixed(2)}deg`);
      // Glare and floor shadow follow the same offset.
      stage.style.setProperty("--glare-x", `${(50 + current.x * 40).toFixed(1)}%`);
      stage.style.setProperty("--shadow-shift", current.x.toFixed(3));
    };

    const tick = () => {
      // Critically-damped-ish ease toward the target.
      current.x += (target.x - current.x) * 0.12;
      current.y += (target.y - current.y) * 0.12;
      write();
      if (Math.abs(target.x - current.x) > 0.001 || Math.abs(target.y - current.y) > 0.001) {
        raf = requestAnimationFrame(tick);
      } else {
        current = { ...target };
        write();
        raf = 0;
      }
    };
    const kick = () => {
      if (!raf) raf = requestAnimationFrame(tick);
    };

    const clamp = (n: number) => Math.max(-1, Math.min(1, n));

    const onMove = (e: PointerEvent) => {
      if (reduce.matches) return;
      const r = stage.getBoundingClientRect();
      if (e.pointerType === "mouse") {
        target = {
          x: clamp(((e.clientX - r.left) / r.width) * 2 - 1),
          y: clamp(((e.clientY - r.top) / r.height) * 2 - 1),
        };
        kick();
      } else if (dragging) {
        // Touch/pen: horizontal drag spins the book; 1 stage-width = full range.
        target = { x: clamp(((e.clientX - dragStartX) / r.width) * 2), y: 0 };
        kick();
      }
    };
    const onDown = (e: PointerEvent) => {
      if (reduce.matches || e.pointerType === "mouse") return;
      dragging = true;
      dragStartX = e.clientX;
    };
    const reset = () => {
      dragging = false;
      target = { x: 0, y: 0 };
      kick();
    };

    stage.addEventListener("pointermove", onMove);
    stage.addEventListener("pointerdown", onDown);
    stage.addEventListener("pointerleave", reset);
    stage.addEventListener("pointerup", reset);
    stage.addEventListener("pointercancel", reset);
    return () => {
      cancelAnimationFrame(raf);
      stage.removeEventListener("pointermove", onMove);
      stage.removeEventListener("pointerdown", onDown);
      stage.removeEventListener("pointerleave", reset);
      stage.removeEventListener("pointerup", reset);
      stage.removeEventListener("pointercancel", reset);
    };
  }, []);

  const depth = bookDepthRatio(pageCount);
  const coverBg = hasCover ? `url("${src.replace(/"/g, "%22")}")` : "none";

  return (
    <div
      ref={stageRef}
      className={`book3d-stage ${className}`}
      style={
        {
          "--book-w": `${width}px`,
          "--book-depth": depth,
          "--cover-bg": coverBg,
        } as CSSProperties
      }
    >
      <div className="book3d-float">
        <div className="book3d-enter">
          <div ref={bookRef} className="book3d">
            <div className="book3d-face book3d-back" aria-hidden="true" />
            <div className="book3d-face book3d-pages book3d-pages-right" aria-hidden="true" />
            <div className="book3d-face book3d-pages book3d-pages-top" aria-hidden="true" />
            <div className="book3d-face book3d-pages book3d-pages-bottom" aria-hidden="true" />
            <div
              className={`book3d-face book3d-spine${hasCover ? "" : " book3d-spine-plain"}`}
              aria-hidden="true"
            />
            <div className="book3d-face book3d-front">
              {hasCover ? (
                <img
                  src={src}
                  alt={alt}
                  width={width}
                  height={Math.round(width * 1.5)}
                  loading={loading}
                  decoding="async"
                  fetchPriority={loading === "eager" ? "high" : undefined}
                  draggable={false}
                  onError={() => setFailed(true)}
                />
              ) : (
                fallback
              )}
              <span className="book3d-hinge" aria-hidden="true" />
              <span className="book3d-glare" aria-hidden="true" />
            </div>
          </div>
        </div>
      </div>
      <div className="book3d-shadow" aria-hidden="true" />
    </div>
  );
}
