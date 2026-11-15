import { SafeImage } from "./SafeImage";

/**
 * A fan of a series' first covers for the right-hand side of the series header. Decorative (aria-hidden): the books are
 * listed, linked and ordered below. Hidden below md, where the header is a single column. Needs at least 2 covers.
 */
export function SeriesCoverFan({ covers }: { covers: string[] }) {
  const list = Array.from(new Set(covers.filter(Boolean))).slice(0, 5);
  if (list.length < 2) return null;
  const mid = (list.length - 1) / 2;
  return (
    <div className="series-fan pointer-events-none absolute right-2 top-1 hidden h-[210px] md:block" style={{ width: 120 + (list.length - 1) * 58 }} aria-hidden="true">
      {list.map((src, i) => (
        <span
          key={src}
          className="series-fan-cover absolute bottom-0 block h-[180px] w-[120px] overflow-hidden rounded-[3px] border border-border bg-subtle shadow-[0_18px_30px_-14px_rgba(58,40,28,0.55)]"
          style={{ left: i * 58, zIndex: list.length - Math.abs(i - mid) * 1, rotate: `${(i - mid) * 5}deg`, translate: `0 ${Math.abs(i - mid) * 7}px`, animationDelay: `${i * 90}ms` }}
        >
          <SafeImage src={src} alt="" className="h-full w-full object-cover" width={120} height={180} />
        </span>
      ))}
    </div>
  );
}
