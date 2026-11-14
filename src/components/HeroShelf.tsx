import Link from "next/link";
import type { CSSProperties } from "react";
import type { NavBook } from "@/lib/siteNav";
import { spineColour } from "@/lib/spinePalette";

/**
 * "Top recommended books": the five most-recommended books standing on a
 * shelf plank as 3D objects, ranked 1-5 on the plank face.
 *
 * Server-rendered, no script: the same box geometry as Book3D (front, spine,
 * page block, top edge) written as plain CSS, so five of them cost no
 * hydration. Hover lifts and straightens a book. Each column is one real link
 * whose visible text (title, author, count) is the accessible name; the
 * drawn book is decorative. Needs three covers or it renders nothing.
 */
const COUNT = 5;

/** Same curve as Book3D's bookDepthRatio (that module is client-only). */
function depthRatio(pageCount: number | null): number {
  if (!pageCount || pageCount < 60) return 0.13;
  return Math.min(0.22, Math.max(0.06, 0.045 + pageCount / 3000));
}

export function HeroShelf({ books }: { books: NavBook[] }) {
  const shelf = books.filter((b) => b.cover && b.count > 0).slice(0, COUNT);
  if (shelf.length < 3) return null;

  return (
    <section aria-labelledby="hero-shelf-h" className="px-4 pb-6 md:pb-10">
      <div className="max-w-7xl mx-auto">
        <div className="mb-2 max-w-2xl">
          <p className="eyebrow text-accent mb-2">Top recommended</p>
          <h2 id="hero-shelf-h" className="type-h2 text-ink">The {shelf.length} books people recommend most</h2>
          <p className="mt-2 text-sm md:text-base text-muted leading-relaxed">
            Ranked by how many people on BookMentions recommend each one.
          </p>
        </div>

        <div className="hshelf-scroll">
          <ol className="hshelf-inner" aria-label="Most recommended books, ranked">
            {shelf.map((b, i) => {
              const c = spineColour(b.slug);
              const style = { "--depth": depthRatio(b.pageCount), "--cloth": c.cloth } as CSSProperties;
              const recs = `${b.count.toLocaleString("en-US")} ${b.count === 1 ? "person recommends" : "people recommend"} it`;
              return (
                <li key={b.slug} className="hshelf-item" style={style}>
                  <Link href={`/books/${b.slug}`} className="hshelf-link">
                    <span className="hshelf-stage" aria-hidden="true">
                      <span className="hshelf-book">
                        <span className="hshelf-face hshelf-pages-right" />
                        <span className="hshelf-face hshelf-pages-top" />
                        <span className="hshelf-face hshelf-spine" />
                        <span className="hshelf-face hshelf-front">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={b.cover} alt="" width={120} height={180} loading="lazy" decoding="async" draggable={false} />
                          <span className="hshelf-hinge" />
                        </span>
                      </span>
                      <span className="hshelf-shadow" />
                    </span>
                    <span className="hshelf-num" aria-hidden="true">{i + 1}</span>
                    <span className="hshelf-label">
                      <span className="hshelf-title">{b.title}</span>
                      {b.author && <span className="hshelf-author">{b.author}</span>}
                      <span className="hshelf-recs">{recs}</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    </section>
  );
}
