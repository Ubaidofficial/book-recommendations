import { Avatar } from "./Avatar";
import { SafeImage } from "./SafeImage";
import { CategoryIcon } from "./CategoryIcon";
import type { CollectionVisual } from "@/lib/collectionVisuals";

type Size = "sm" | "md" | "lg";

// Pixel sizes: one cover (w x h), the sideways step between fanned covers, the box height, and the
// avatar / icon-tile size. The box is always cover + 2 steps wide, so the text beside it never meets a cover.
const DIMS: Record<Size, { cw: number; ch: number; step: number; h: number; avatar: string; text: string; icon: number }> = {
  sm: { cw: 24, ch: 36, step: 11, h: 44, avatar: "w-11 h-11", text: "text-sm", icon: 18 },
  md: { cw: 36, ch: 54, step: 14, h: 64, avatar: "w-14 h-14", text: "text-base", icon: 24 },
  lg: { cw: 44, ch: 66, step: 18, h: 80, avatar: "w-20 h-20", text: "text-xl", icon: 32 },
};

/**
 * Decorative thumbnail for a list or series card: a portrait for a person's list, else up to three
 * overlapping covers, else a subject icon on a tinted tile. It is aria-hidden: the card's title already
 * names the destination, so the picture adds nothing for a screen reader. Every variant has the same
 * box, so the text beside it lines up whichever one a card gets.
 */
export function CollectionThumb({
  visual,
  slug,
  size = "md",
  className = "",
}: {
  visual?: CollectionVisual | null;
  slug: string;
  size?: Size;
  className?: string;
}) {
  const d = DIMS[size];
  const box = { width: d.cw + 2 * d.step, height: d.h };
  if (visual?.person) {
    return (
      <span className={`inline-flex shrink-0 items-center justify-center ${className}`} style={box} aria-hidden="true">
        <Avatar name={visual.person.name} slug={visual.person.slug} avatarUrl={visual.person.avatar} sizeClass={d.avatar} textClass={d.text} alt="" />
      </span>
    );
  }
  const covers = visual?.covers || [];
  if (covers.length > 0) {
    return (
      <span className={`relative shrink-0 ${className}`} style={box} aria-hidden="true">
        {covers.map((src, i) => (
          <span
            key={src}
            className="absolute bottom-0 overflow-hidden rounded-[3px] border border-border bg-subtle shadow-sm"
            style={{ left: i * d.step, width: d.cw, height: d.ch, zIndex: covers.length - i }}
          >
            <SafeImage src={src} alt="" className="h-full w-full object-cover" width={d.cw} height={d.ch} />
          </span>
        ))}
      </span>
    );
  }
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-xl bg-accent-light text-accent ${className}`}
      style={{ width: d.cw + 2 * d.step, height: d.h }}
      aria-hidden="true"
    >
      <CategoryIcon slug={slug} size={d.icon} />
    </span>
  );
}
