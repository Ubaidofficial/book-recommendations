"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

interface Book3DProps {
  /** Cover image URL. Empty/invalid → `fallback` is drawn on the front face. */
  src: string;
  alt: string;
  /** Rendered on the front face when there is no cover, or it fails to load. */
  fallback: ReactNode;
  /** Front-face width in px. */
  width: number;
  /**
   * Front-face width below the `lg` breakpoint (1024px). Lets one instance
   * (and one <img>, eager for LCP) serve both layouts.
   */
  mobileWidth?: number;
  /** Real page count, when known — sets how thick the book looks. */
  pageCount?: number | null;
  /**
   * Cover height / width, when known. Otherwise 1.5 until the image loads,
   * then the image's own ratio. Clamped to 1.36–1.62.
   */
  aspectRatio?: number | null;
  /** "eager" for the page's own hero cover (it is the LCP element). */
  loading?: "lazy" | "eager";
  className?: string;
  /** Back-cover text. With none of these the back shows the darkened cover only. */
  backTitle?: string;
  backAuthor?: string;
  /** e.g. "Recommended by 88 people". */
  backNote?: string;
  /** Click / Enter / Space turns the book over; drag turns it freely. Default true. */
  flippable?: boolean;
}

// Resting pose: turned slightly so the spine (left) and the page block both
// read as volume without hiding much of the cover art.
const REST_X = 4; // deg, tipped back a little
const REST_Y = 20; // deg, spine toward the reader
// How far the mouse can swing the book from rest. Asymmetric on Y because
// rest already favours the spine.
const RANGE_X = 10;
const RANGE_Y_SPINE = 26;
const RANGE_Y_PAGES = 46;
/** Degrees of turn per stage-width of horizontal drag. */
const DRAG_DEG_PER_WIDTH = 200;
/** Pointer travel (px) before a press becomes a drag instead of a click. */
const DRAG_THRESHOLD = 6;

const AR_MIN = 1.36;
const AR_MAX = 1.62;
const clampAr = (n: number) => Math.min(AR_MAX, Math.max(AR_MIN, n));

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
 * and bottom edges, and a back cover, assembled with CSS 3D transforms (no
 * WebGL, no extra dependency).
 *
 * - Server-rendered in its resting pose with a real <img> on the front face,
 *   so the cover is in the initial HTML for LCP and image search, and the
 *   server and client markup are identical.
 * - Mouse hover tilts it. Click (without dragging) turns it over to the back
 *   cover and back again; Enter/Space do the same when it has focus, Escape
 *   returns to the front. Press and drag past a few pixels turns it freely,
 *   and on release it settles on whichever cover is nearer the reader.
 * - Motion runs in one rAF loop that writes CSS custom properties; React never
 *   re-renders while it moves.
 * - The height follows the cover's real aspect ratio, so tall and squat
 *   editions are not stretched.
 * - prefers-reduced-motion: no tilt, drag, float or entrance; a click or key
 *   still shows the back, without animating the turn.
 */
export function Book3D({
  src,
  alt,
  fallback,
  width,
  mobileWidth,
  pageCount,
  aspectRatio,
  loading = "lazy",
  className = "",
  backTitle,
  backAuthor,
  backNote,
  flippable = true,
}: Book3DProps) {
  const [failed, setFailed] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const bookRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const hasCover = Boolean(src) && !failed;
  const initialAr = aspectRatio && Number.isFinite(aspectRatio) ? clampAr(aspectRatio) : 1.5;

  // Real cover proportions, once the image has its natural size. Written
  // straight to the stage so it costs no render. Covers the case where the
  // image finished loading before hydration (onLoad would not fire again).
  useEffect(() => {
    if (aspectRatio) return;
    const img = imgRef.current;
    const stage = stageRef.current;
    if (!img || !stage) return;
    const apply = () => {
      if (img.naturalWidth > 0 && img.naturalHeight > 0) {
        stage.style.setProperty("--book-ar", clampAr(img.naturalHeight / img.naturalWidth).toFixed(3));
      }
    };
    if (img.complete) apply();
    img.addEventListener("load", apply);
    return () => img.removeEventListener("load", apply);
  }, [aspectRatio, hasCover]);

  useEffect(() => {
    const stage = stageRef.current;
    const book = bookRef.current;
    if (!stage || !book) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");

    // Hover offset (-1..1 from rest), eased.
    let hover = { x: 0, y: 0 };
    let hoverCur = { x: 0, y: 0 };
    // Free turn from a drag (deg), eased toward the pointer.
    let drag = 0;
    let dragCur = 0;
    let tiltYDrag = 0; // vertical drag, -1.4..1.4
    // Turn-over angle (deg, multiple of 180 at rest), sprung.
    let flip = 0;
    let flipCur = 0;
    let flipVel = 0;

    let raf = 0;
    let press: { x: number; y: number; id: number } | null = null;
    let dragging = false;

    const hoverY = (x: number) => x * (x < 0 ? RANGE_Y_SPINE : RANGE_Y_PAGES);
    const facingBack = () => Math.round(flip / 180) % 2 !== 0;

    const write = () => {
      const tiltX = REST_X - (hoverCur.y + tiltYDrag) * RANGE_X;
      const tiltY = REST_Y - hoverY(hoverCur.x) + dragCur + flipCur;
      book.style.setProperty("--tilt-x", `${tiltX.toFixed(2)}deg`);
      book.style.setProperty("--tilt-y", `${tiltY.toFixed(2)}deg`);
      // Glare and floor shadow follow the hover offset.
      stage.style.setProperty("--glare-x", `${(50 + hoverCur.x * 40).toFixed(1)}%`);
      stage.style.setProperty("--shadow-shift", hoverCur.x.toFixed(3));
    };

    const settled = () =>
      Math.abs(hover.x - hoverCur.x) < 0.001 &&
      Math.abs(hover.y - hoverCur.y) < 0.001 &&
      Math.abs(drag - dragCur) < 0.05 &&
      Math.abs(flip - flipCur) < 0.05 &&
      Math.abs(flipVel) < 0.05 &&
      (dragging || Math.abs(tiltYDrag) < 0.001);

    const tick = () => {
      hoverCur.x += (hover.x - hoverCur.x) * 0.12;
      hoverCur.y += (hover.y - hoverCur.y) * 0.12;
      dragCur += (drag - dragCur) * 0.35;
      if (!dragging) tiltYDrag *= 0.85;
      // Spring with a little overshoot, like a book landing on its board.
      flipVel += (flip - flipCur) * 0.09;
      flipVel *= 0.74;
      flipCur += flipVel;
      write();
      if (!settled()) {
        raf = requestAnimationFrame(tick);
      } else {
        hoverCur = { ...hover };
        dragCur = drag;
        flipCur = flip;
        flipVel = 0;
        if (!dragging) tiltYDrag = 0;
        write();
        raf = 0;
      }
    };
    const kick = () => {
      if (reduce.matches) {
        // No animation: jump straight to the end state.
        hoverCur = { ...hover };
        dragCur = drag;
        flipCur = flip;
        flipVel = 0;
        write();
        return;
      }
      if (!raf) raf = requestAnimationFrame(tick);
    };

    const setPressed = () => stage.setAttribute("aria-pressed", facingBack() ? "true" : "false");
    const turnOver = () => {
      flip += facingBack() ? -180 : 180;
      setPressed();
      kick();
    };
    const toFront = () => {
      if (!facingBack()) return;
      flip -= 180;
      setPressed();
      kick();
    };
    /** Fold the drag into the turn angle, then settle on the nearer cover. */
    const snap = () => {
      flipCur += dragCur - hoverY(hoverCur.x);
      flip = flipCur;
      drag = dragCur = 0;
      hover = { x: 0, y: 0 };
      hoverCur = { x: 0, y: 0 };
      flip = Math.round(flip / 180) * 180;
      setPressed();
      kick();
    };

    const clamp = (n: number, m = 1) => Math.max(-m, Math.min(m, n));

    const onDown = (e: PointerEvent) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      press = { x: e.clientX, y: e.clientY, id: e.pointerId };
    };
    const onMove = (e: PointerEvent) => {
      if (reduce.matches) return;
      const r = stage.getBoundingClientRect();
      if (press && flippable) {
        const dx = e.clientX - press.x;
        const dy = e.clientY - press.y;
        if (!dragging && Math.hypot(dx, dy) > DRAG_THRESHOLD) {
          dragging = true;
          stage.classList.add("is-dragging");
          try {
            stage.setPointerCapture(press.id);
          } catch {
            /* pointer already gone */
          }
        }
        if (dragging) {
          drag = (dx / r.width) * DRAG_DEG_PER_WIDTH;
          tiltYDrag = clamp(dy / r.height, 1.4);
          kick();
        }
        return;
      }
      if (e.pointerType === "mouse") {
        hover = {
          x: clamp(((e.clientX - r.left) / r.width) * 2 - 1),
          y: clamp(((e.clientY - r.top) / r.height) * 2 - 1),
        };
        kick();
      }
    };
    const endDrag = () => {
      dragging = false;
      stage.classList.remove("is-dragging");
      snap();
    };
    const onUp = (e: PointerEvent) => {
      if (!press) return;
      press = null;
      if (dragging) endDrag();
      else if (flippable && e.type === "pointerup") turnOver();
    };
    const onLeave = () => {
      if (dragging) return; // captured; pointerup will follow
      press = null;
      hover = { x: 0, y: 0 };
      kick();
    };
    const onKey = (e: KeyboardEvent) => {
      if (!flippable) return;
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        turnOver();
      } else if (e.key === "Escape") {
        toFront();
      }
    };

    if (flippable) setPressed();
    stage.addEventListener("pointerdown", onDown);
    stage.addEventListener("pointermove", onMove);
    stage.addEventListener("pointerup", onUp);
    stage.addEventListener("pointercancel", onUp);
    stage.addEventListener("pointerleave", onLeave);
    stage.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(raf);
      stage.removeEventListener("pointerdown", onDown);
      stage.removeEventListener("pointermove", onMove);
      stage.removeEventListener("pointerup", onUp);
      stage.removeEventListener("pointercancel", onUp);
      stage.removeEventListener("pointerleave", onLeave);
      stage.removeEventListener("keydown", onKey);
    };
  }, [flippable]);

  const depth = bookDepthRatio(pageCount);
  const coverBg = hasCover ? `url("${src.replace(/"/g, "%22")}")` : "none";
  const hasBackInfo = Boolean(backTitle || backAuthor || backNote);

  return (
    <div
      ref={stageRef}
      className={`book3d-stage${flippable ? " book3d-flippable" : ""}${mobileWidth ? " book3d-has-sm" : ""} ${className}`}
      style={
        {
          "--book-w": `${width}px`,
          ...(mobileWidth ? { "--book-w-sm": `${mobileWidth}px` } : {}),
          "--book-depth": depth,
          "--book-ar": initialAr,
          "--cover-bg": coverBg,
        } as CSSProperties
      }
      {...(flippable
        ? {
            tabIndex: 0,
            role: "button",
            "aria-label": `${alt}. Turn the book over to see the back cover.`,
          }
        : {})}
    >
      <div className="book3d-float">
        <div className="book3d-enter">
          <div ref={bookRef} className="book3d">
            <div className="book3d-face book3d-back" aria-hidden="true">
              <span className="book3d-grain book3d-grain-back" />
              {hasBackInfo && (
                <span className="book3d-back-info">
                  {backTitle && <span className="book3d-back-title">{backTitle}</span>}
                  {backAuthor && <span className="book3d-back-author">{backAuthor}</span>}
                  {backNote && <span className="book3d-back-note">{backNote}</span>}
                  <span className="book3d-back-mark">BookMentions</span>
                </span>
              )}
            </div>
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
                  ref={imgRef}
                  src={src}
                  alt={alt}
                  width={width}
                  height={Math.round(width * initialAr)}
                  loading={loading}
                  decoding="async"
                  fetchPriority={loading === "eager" ? "high" : undefined}
                  draggable={false}
                  onError={() => setFailed(true)}
                />
              ) : (
                fallback
              )}
              <span className="book3d-grain" aria-hidden="true" />
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
