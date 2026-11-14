import { SafeImage } from "@/components/SafeImage";
import { spineColour } from "@/lib/spinePalette";

/**
 * A strip of the person's most-recommended covers across the top of their
 * page, printed into the person's book-cloth colour as a duotone and faded
 * into the page below. Purely decorative (aria-hidden, empty alts): the same
 * books are listed, linked and described further down the page.
 *
 * Static: no script, no animation. Every cover is lazy, so the strip never
 * competes with the heading or portrait for the first paint. With fewer than
 * five covers a strip would look sparse, so nothing renders.
 */
const MIN_COVERS = 5;
const MAX_COVERS = 14;

export function PersonCoverBanner({ slug, covers }: { slug: string; covers: string[] }) {
  const row = covers.filter(Boolean).slice(0, MAX_COVERS);
  if (row.length < MIN_COVERS) return null;
  const { cloth } = spineColour(slug);

  return (
    <div className="person-banner" style={{ "--cloth": cloth } as React.CSSProperties} aria-hidden="true">
      <div className="person-banner-row">
        {row.map((src, i) => (
          <SafeImage
            key={`${src}-${i}`}
            src={src}
            alt=""
            width={112}
            height={168}
            className="person-banner-cover"
            fallback={<span className="person-banner-cover person-banner-blank" />}
          />
        ))}
      </div>
    </div>
  );
}
