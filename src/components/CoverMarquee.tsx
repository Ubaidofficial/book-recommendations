/**
 * Two slow, offset rows of a list's covers drifting in opposite directions.
 * Decorative only (aria-hidden, empty alts): the same books are listed,
 * linked and ranked below, so nothing here carries information or a link.
 *
 * Server-rendered, no script. Each row holds its covers twice so the loop is
 * seamless (the track slides by exactly half its width). Every image is lazy.
 * With prefers-reduced-motion the rows stop and sit still. With fewer than 12
 * covers there is not enough to fill two rows, so nothing renders.
 */
const MIN_COVERS = 12;
const PER_ROW = 14;

export function CoverMarquee({ covers }: { covers: string[] }) {
  const unique = Array.from(new Set(covers.filter(Boolean)));
  if (unique.length < MIN_COVERS) return null;
  const rows = [
    unique.filter((_, i) => i % 2 === 0).slice(0, PER_ROW),
    unique.filter((_, i) => i % 2 === 1).slice(0, PER_ROW),
  ];

  return (
    <div className="cover-marquee" aria-hidden="true">
      {rows.map((row, r) => (
        <div key={r} className={`cover-marquee-row${r === 1 ? " cover-marquee-row-b" : ""}`}>
          {[...row, ...row].map((src, i) => (
            <span key={`${r}-${i}`} className="cover-marquee-item">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt="" width={88} height={132} loading="lazy" decoding="async" draggable={false} />
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}
