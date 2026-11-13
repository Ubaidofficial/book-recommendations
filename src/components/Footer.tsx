import Link from "next/link";
import type { SiteNav } from "@/lib/siteNav";

const LINK =
  "hover:text-ink transition-colors focus-visible:outline-none focus-visible:text-ink focus-visible:ring-2 focus-visible:ring-accent/40 rounded px-1 -mx-1";

function Column({
  title,
  links,
  className = "",
}: {
  title: string;
  links: Array<{ href: string; label: string }>;
  className?: string;
}) {
  if (links.length === 0) return null;
  return (
    <div className={`min-w-0 ${className}`}>
      <h2 className="eyebrow text-ink mb-4">{title}</h2>
      <ul className="flex flex-col gap-2.5 text-sm text-muted">
        {links.map((l) => (
          <li key={l.href} className="min-w-0">
            <Link href={l.href} className={`${LINK} inline-block max-w-full`}>
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Link-rich footer: the most-recommended books, people and topics are linked
 * from every page, which gives each of them a crawl path from anywhere on the
 * site. Data comes from the same cached read as the header (with a static
 * snapshot when the database is down), so it always renders.
 */
export function Footer({ nav }: { nav: SiteNav }) {
  return (
    <footer className="border-t border-border bg-subtle mt-20">
      <div className="max-w-7xl mx-auto px-4 md:px-6 py-12">
        <div className="grid grid-cols-2 lg:grid-cols-[1.2fr_1.3fr_1fr_1fr] gap-x-8 gap-y-10">
          <div className="col-span-2 lg:col-span-1 max-w-sm">
            <Link href="/" className="inline-flex items-center gap-2.5 font-serif text-xl font-semibold tracking-[-0.015em] text-ink">
              <img src="/bookmentions-logo.png" alt="" className="h-7 w-7 rounded-full object-cover" width={28} height={28} loading="lazy" />
              BookMentions
            </Link>
            <p className="mt-3 font-serif text-lg leading-snug text-muted-strong">
              Books recommended by people you trust, with the source behind each pick when we have it.
            </p>
          </div>
          <Column
            title="Most recommended books"
            className="col-span-2 sm:col-span-1"
            links={nav.books.slice(0, 8).map((b) => ({ href: `/books/${b.slug}`, label: b.title }))}
          />
          <Column
            title="People"
            links={nav.people.slice(0, 8).map((p) => ({ href: `/people/${p.slug}`, label: p.name }))}
          />
          <Column
            title="Topics"
            links={nav.topics.slice(0, 8).map((l) => ({ href: `/lists/${l.slug}`, label: l.title }))}
          />
        </div>

        <div className="mt-10 pt-8 border-t border-border grid grid-cols-2 sm:grid-cols-4 gap-8">
          <Column
            title="Discover"
            links={[
              { href: "/books", label: "All books" },
              { href: "/people", label: "All people" },
              { href: "/lists", label: "Reading lists" },
              { href: "/series", label: "Book series" },
            ]}
          />
          <Column
            title="Info"
            links={[
              { href: "/about", label: "About" },
              { href: "/methodology", label: "Methodology" },
            ]}
          />
          <Column
            title="Legal"
            links={[
              { href: "/privacy", label: "Privacy" },
              { href: "/terms", label: "Terms" },
            ]}
          />
          <Column title="Help" links={[{ href: "/report-issue", label: "Report an issue" }]} />
        </div>

        <div className="mt-10 pt-6 border-t border-border text-xs text-muted">
          <p className="mb-2">
            BookMentions is an independent book discovery platform. Recommendations are sourced from publicly available data.
          </p>
          <p>As an Amazon Associate I earn from qualifying purchases.</p>
        </div>
      </div>
    </footer>
  );
}
