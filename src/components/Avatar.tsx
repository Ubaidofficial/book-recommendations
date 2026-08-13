import { SafeImage } from "./SafeImage";

/**
 * Circular person avatar with a real fallback.
 *
 * Ten published recommenders have no free-licensed portrait available, and a
 * remote URL can rot at any time (three Wikimedia links had already 404'd), so
 * the initials state is a designed state rather than an accident: a raw <img>
 * on a dead URL renders the browser's broken-image glyph, which reads as a
 * bug. Going through SafeImage means a failed load degrades to the same
 * initials a missing URL shows.
 *
 * The tint is derived from the slug so a given person keeps one colour across
 * every surface — recognisable, and stable between renders.
 */
const TINTS = [
  "bg-amber-100 text-amber-800",
  "bg-sky-100 text-sky-800",
  "bg-emerald-100 text-emerald-800",
  "bg-violet-100 text-violet-800",
  "bg-rose-100 text-rose-800",
  "bg-teal-100 text-teal-800",
];

function tintFor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return TINTS[h % TINTS.length];
}

/** "Marc Andreessen" -> "MA"; single-word names keep one letter. */
function initialsOf(name: string): string {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter((p) => /[a-z]/i.test(p));
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

interface AvatarProps {
  name: string;
  slug: string;
  avatarUrl?: string | null;
  /** Tailwind sizing for the circle, e.g. "w-14 h-14". */
  sizeClass?: string;
  /** Tailwind text size for the initials fallback. */
  textClass?: string;
  className?: string;
  /**
   * Extra context for the alt text. A bare name is a weak alt on a page that
   * is already headed by that name; "Bill Gates, book recommender" describes
   * the image's role.
   */
  alt?: string;
}

export function Avatar({
  name,
  slug,
  avatarUrl,
  sizeClass = "w-14 h-14",
  textClass = "text-lg",
  className = "",
  alt,
}: AvatarProps) {
  const usable = avatarUrl && /^https?:\/\//i.test(avatarUrl) ? avatarUrl : "";
  const initials = (
    <span className={`${textClass} font-bold leading-none select-none`} aria-hidden="true">
      {initialsOf(name)}
    </span>
  );

  return (
    <div
      className={`${sizeClass} ${usable ? "bg-subtle" : tintFor(slug || name)} rounded-full overflow-hidden shrink-0 flex items-center justify-center ${className}`}
      // Without a real image the circle still needs an accessible name; the
      // initials themselves are decorative.
      {...(usable ? {} : { role: "img", "aria-label": name })}
    >
      {usable ? (
        <SafeImage
          src={usable}
          alt={alt || `${name}, book recommender`}
          className="w-full h-full object-cover"
          fallback={initials}
        />
      ) : (
        initials
      )}
    </div>
  );
}
