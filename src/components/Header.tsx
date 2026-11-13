"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { NavBook, NavList, NavPerson, SiteNav } from "@/lib/siteNav";
import { spineColour } from "@/lib/spinePalette";
import { GlobalSearch } from "./GlobalSearch";
import { SafeImage } from "./SafeImage";

type MenuId = "books" | "people" | "lists";

const FOCUS_RING = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40";

/** "1,234 books" — never "0 books" (hidden instead). */
function countLabel(n: number, one: string, many: string): string | null {
  if (!n || n <= 0) return null;
  return `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter((p) => /[a-z]/i.test(p));
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

function MiniCover({ book }: { book: NavBook }) {
  const c = spineColour(book.slug);
  const stand = (
    <span className="mega-mini-cover" style={{ background: c.cloth }} aria-hidden="true" />
  );
  if (!book.cover) return stand;
  return (
    <SafeImage
      src={book.cover}
      alt=""
      className="mega-mini-cover object-cover"
      width={34}
      height={50}
      fallback={stand}
    />
  );
}

function MiniAvatar({ person }: { person: NavPerson }) {
  const c = spineColour(person.slug);
  const initials = (
    <span
      className="w-9 h-9 rounded-full shrink-0 flex items-center justify-center text-[11px] font-bold"
      style={{ background: c.cloth, color: c.ink }}
      aria-hidden="true"
    >
      {initialsOf(person.name)}
    </span>
  );
  if (!person.avatar) return initials;
  return (
    <SafeImage
      src={person.avatar}
      alt=""
      className="w-9 h-9 rounded-full object-cover shrink-0 bg-subtle"
      width={36}
      height={36}
      fallback={initials}
    />
  );
}

function PanelFoot({ note, href, label, onNavigate }: { note: string; href: string; label: string; onNavigate: () => void }) {
  return (
    <div className="col-span-full border-t border-border pt-3.5 flex flex-wrap items-center justify-between gap-2 text-sm">
      <span className="text-muted">{note}</span>
      <Link href={href} onClick={onNavigate} className={`font-semibold text-accent hover:text-accent-hover rounded px-1 -mx-1 ${FOCUS_RING}`}>
        {label}
      </Link>
    </div>
  );
}

function PanelHeading({ children }: { children: ReactNode }) {
  return <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">{children}</p>;
}

function ChipLinks({ lists, onNavigate, showCount }: { lists: NavList[]; onNavigate: () => void; showCount?: boolean }) {
  return (
    <ul className="flex flex-wrap gap-1.5">
      {lists.map((l) => {
        const n = showCount ? countLabel(l.count, "book", "books") : null;
        return (
          <li key={l.slug}>
            <Link
              href={`/lists/${l.slug}`}
              onClick={onNavigate}
              className={`inline-flex items-baseline gap-1.5 rounded-lg border border-border px-2.5 py-1 text-[13px] text-ink hover:border-accent hover:text-accent transition-colors ${FOCUS_RING}`}
            >
              {l.title}
              {n && <span className="text-xs text-muted">{n}</span>}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function BooksPanel({ nav, onNavigate }: { nav: SiteNav; onNavigate: () => void }) {
  return (
    <>
      <div className="min-w-0">
        <PanelHeading>Most recommended books</PanelHeading>
        <ul className="grid grid-cols-2 gap-x-4 gap-y-1.5">
          {nav.books.slice(0, 8).map((b) => {
            const n = countLabel(b.count, "rec", "recs");
            return (
              <li key={b.slug} className="min-w-0">
                <Link
                  href={`/books/${b.slug}`}
                  onClick={onNavigate}
                  className={`grid grid-cols-[34px_minmax(0,1fr)] items-center gap-2.5 rounded-lg p-1 hover:bg-subtle transition-colors ${FOCUS_RING}`}
                >
                  <MiniCover book={b} />
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-semibold text-ink leading-snug">{b.title}</span>
                    <span className="block truncate text-xs text-muted">
                      {[b.author, n].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
      <div className="min-w-0">
        <PanelHeading>Topics</PanelHeading>
        <ChipLinks lists={nav.topics} onNavigate={onNavigate} />
      </div>
      <PanelFoot note="Ranked by how many people recommend each book" href="/books" label="All books →" onNavigate={onNavigate} />
    </>
  );
}

function PeoplePanel({ nav, onNavigate }: { nav: SiteNav; onNavigate: () => void }) {
  return (
    <>
      <div className="col-span-full min-w-0">
        <PanelHeading>People with the most recommendations</PanelHeading>
        <ul className="grid grid-cols-3 gap-x-4 gap-y-1">
          {nav.people.slice(0, 12).map((p) => {
            const n = countLabel(p.count, "book", "books");
            return (
              <li key={p.slug} className="min-w-0">
                <Link
                  href={`/people/${p.slug}`}
                  onClick={onNavigate}
                  className={`flex items-center gap-2.5 rounded-lg p-1 hover:bg-subtle transition-colors ${FOCUS_RING}`}
                >
                  <MiniAvatar person={p} />
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-semibold text-ink">{p.name}</span>
                    {n && <span className="block text-xs text-muted">{n}</span>}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
      <PanelFoot note="Founders, investors, writers and scientists" href="/people" label="All people →" onNavigate={onNavigate} />
    </>
  );
}

function ListsPanel({ nav, onNavigate }: { nav: SiteNav; onNavigate: () => void }) {
  return (
    <>
      <div className="min-w-0">
        <PanelHeading>Reading lists by person and role</PanelHeading>
        <ul className="grid grid-cols-1 gap-y-1">
          {nav.recommendedBy.slice(0, 12).map((l) => {
            const n = countLabel(l.count, "book", "books");
            return (
              <li key={l.slug}>
                <Link
                  href={`/lists/${l.slug}`}
                  onClick={onNavigate}
                  className={`flex items-baseline justify-between gap-3 rounded-lg px-1.5 py-1 text-[13px] text-ink hover:bg-subtle hover:text-accent transition-colors ${FOCUS_RING}`}
                >
                  <span className="truncate">{l.title}</span>
                  {n && <span className="shrink-0 text-xs text-muted">{n}</span>}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
      <div className="min-w-0">
        <PanelHeading>Popular lists</PanelHeading>
        <ChipLinks lists={nav.popularLists} onNavigate={onNavigate} showCount />
      </div>
      <PanelFoot note="Each list is ranked by how often its books are recommended" href="/lists" label="All lists →" onNavigate={onNavigate} />
    </>
  );
}

const MENUS: Array<{ id: MenuId; label: string }> = [
  { id: "books", label: "Books" },
  { id: "people", label: "People" },
  { id: "lists", label: "Lists" },
];

export function Header({ nav }: { nav: SiteNav }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [openMenu, setOpenMenu] = useState<MenuId | null>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const buttonRefs = useRef<Partial<Record<MenuId, HTMLButtonElement | null>>>({});
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The menu a mouse hover just opened. The click that usually follows the
  // hover must not toggle it straight back shut.
  const hoverOpened = useRef<MenuId | null>(null);
  const pathname = usePathname();

  const cancelClose = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  };
  const close = useCallback(() => {
    cancelClose();
    setOpenMenu(null);
  }, []);
  const closeMobile = () => setMenuOpen(false);

  // A route change (client navigation) closes everything.
  useEffect(() => {
    setOpenMenu(null);
    setMenuOpen(false);
  }, [pathname]);

  // Escape closes and hands focus back to the button; a press outside closes.
  useEffect(() => {
    if (!openMenu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const btn = buttonRefs.current[openMenu];
      close();
      btn?.focus();
    };
    const onPointer = (e: PointerEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) close();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [openMenu, close]);

  useEffect(() => () => cancelClose(), []);

  const panels: Record<MenuId, ReactNode> = {
    books: <BooksPanel nav={nav} onNavigate={close} />,
    people: <PeoplePanel nav={nav} onNavigate={close} />,
    lists: <ListsPanel nav={nav} onNavigate={close} />,
  };

  return (
    <header className="border-b border-border bg-surface sticky top-0 z-50">
      <div ref={barRef} className="relative max-w-7xl mx-auto px-4 md:px-6 h-16 flex items-center gap-4 lg:gap-6">
        <Link href="/" className="flex items-center gap-2 text-lg font-bold tracking-tight text-ink shrink-0">
          <img
            src="/bookmentions-logo.png"
            alt="BookMentions"
            className="h-8 w-8 rounded-full object-cover"
            // Intrinsic size reserves the box before the file lands, so the
            // header does not shift the page under it on first paint.
            width={32}
            height={32}
          />
          <span>BookMentions</span>
        </Link>

        {/* Mega menus. Every panel is in the server HTML (toggled with the
            hidden attribute, never fetched on open), so its links are
            crawlable and work before hydration via the mobile fallback. */}
        <nav aria-label="Main" className="hidden lg:flex items-center gap-1 text-sm font-medium">
          {MENUS.map(({ id, label }) => {
            const open = openMenu === id;
            return (
              <div
                key={id}
                onPointerEnter={(e) => {
                  if (e.pointerType !== "mouse") return;
                  cancelClose();
                  if (openMenu !== id) hoverOpened.current = id;
                  setOpenMenu(id);
                }}
                onPointerLeave={(e) => {
                  if (e.pointerType !== "mouse") return;
                  cancelClose();
                  closeTimer.current = setTimeout(() => setOpenMenu((cur) => (cur === id ? null : cur)), 180);
                }}
                onBlur={(e) => {
                  // Tabbing out of the button and its panel closes it.
                  if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                    setOpenMenu((cur) => (cur === id ? null : cur));
                  }
                }}
              >
                <button
                  ref={(el) => {
                    buttonRefs.current[id] = el;
                  }}
                  type="button"
                  aria-expanded={open}
                  aria-controls={`mega-${id}`}
                  onClick={() => {
                    cancelClose();
                    if (open && hoverOpened.current === id) {
                      hoverOpened.current = null;
                      return;
                    }
                    hoverOpened.current = null;
                    setOpenMenu(open ? null : id);
                  }}
                  className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 transition-colors ${FOCUS_RING} ${
                    open ? "bg-accent-light text-accent" : "text-muted hover:text-ink"
                  }`}
                >
                  {label}
                  <svg className={`w-3 h-3 transition-transform ${open ? "rotate-180" : ""}`} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={1.6} aria-hidden="true">
                    <path d="M3 4.5 6 7.5 9 4.5" />
                  </svg>
                </button>
                <div
                  id={`mega-${id}`}
                  hidden={!open}
                  className="mega-panel absolute left-4 md:left-6 top-full mt-2 w-[min(780px,calc(100vw-32px))] rounded-2xl border border-border bg-surface p-5 shadow-[0_30px_60px_-24px_rgba(58,40,28,0.35)] grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] gap-x-7 gap-y-4"
                >
                  {panels[id]}
                </div>
              </div>
            );
          })}
          <Link href="/series" className={`rounded-lg px-2.5 py-1.5 text-muted hover:text-ink transition-colors ${FOCUS_RING}`}>Series</Link>
          <Link href="/about" className={`rounded-lg px-2.5 py-1.5 text-muted hover:text-ink transition-colors ${FOCUS_RING}`}>About</Link>
        </nav>

        <div className="hidden lg:flex flex-1 max-w-md ml-auto">
          <GlobalSearch compact placeholder="Search books, lists, authors…" />
        </div>

        <button
          className={`lg:hidden ml-auto p-2 rounded-md hover:bg-subtle transition-colors ${FOCUS_RING}`}
          onClick={() => setMenuOpen(!menuOpen)}
          aria-label="Toggle menu"
          aria-expanded={menuOpen}
          aria-controls="mobile-menu"
        >
          <svg className="w-5 h-5 text-ink" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            {menuOpen ? (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            )}
          </svg>
        </button>
      </div>

      {menuOpen && (
        <div id="mobile-menu" className="lg:hidden border-t border-border bg-surface px-4 py-4 max-h-[calc(100dvh-4rem)] overflow-y-auto overscroll-contain">
          <GlobalSearch compact placeholder="Search books, lists, authors…" className="mb-3" />
          <nav aria-label="Main" className="flex flex-col text-sm font-medium">
            <MobileGroup label="Books">
              {nav.books.slice(0, 8).map((b) => (
                <MobileLink key={b.slug} href={`/books/${b.slug}`} onNavigate={closeMobile} note={b.author}>{b.title}</MobileLink>
              ))}
              <MobileSubhead>Topics</MobileSubhead>
              {nav.topics.slice(0, 8).map((l) => (
                <MobileLink key={l.slug} href={`/lists/${l.slug}`} onNavigate={closeMobile}>{l.title}</MobileLink>
              ))}
              <MobileLink href="/books" onNavigate={closeMobile} strong>All books →</MobileLink>
            </MobileGroup>
            <MobileGroup label="People">
              {nav.people.slice(0, 12).map((p) => (
                <MobileLink key={p.slug} href={`/people/${p.slug}`} onNavigate={closeMobile} note={countLabel(p.count, "book", "books")}>{p.name}</MobileLink>
              ))}
              <MobileLink href="/people" onNavigate={closeMobile} strong>All people →</MobileLink>
            </MobileGroup>
            <MobileGroup label="Lists">
              {nav.recommendedBy.slice(0, 8).map((l) => (
                <MobileLink key={l.slug} href={`/lists/${l.slug}`} onNavigate={closeMobile}>{l.title}</MobileLink>
              ))}
              <MobileSubhead>Popular lists</MobileSubhead>
              {nav.popularLists.slice(0, 6).map((l) => (
                <MobileLink key={l.slug} href={`/lists/${l.slug}`} onNavigate={closeMobile}>{l.title}</MobileLink>
              ))}
              <MobileLink href="/lists" onNavigate={closeMobile} strong>All lists →</MobileLink>
            </MobileGroup>
            <Link href="/series" className={`py-2.5 text-muted hover:text-ink transition-colors rounded px-1 ${FOCUS_RING}`} onClick={closeMobile}>Series</Link>
            <Link href="/about" className={`py-2.5 text-muted hover:text-ink transition-colors rounded px-1 ${FOCUS_RING}`} onClick={closeMobile}>About</Link>
          </nav>
        </div>
      )}
    </header>
  );
}

function MobileGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <details className="mobile-group border-b border-border/70">
      <summary className={`flex items-center justify-between py-2.5 px-1 text-muted hover:text-ink cursor-pointer list-none rounded ${FOCUS_RING}`}>
        {label}
        <svg className="mobile-group-chev w-3.5 h-3.5 transition-transform" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={1.6} aria-hidden="true">
          <path d="M3 4.5 6 7.5 9 4.5" />
        </svg>
      </summary>
      <div className="flex flex-col pb-3 pl-2">{children}</div>
    </details>
  );
}

function MobileSubhead({ children }: { children: ReactNode }) {
  return <p className="mt-2 mb-1 px-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">{children}</p>;
}

function MobileLink({
  href,
  children,
  onNavigate,
  note,
  strong,
}: {
  href: string;
  children: ReactNode;
  onNavigate: () => void;
  note?: string | null;
  strong?: boolean;
}) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      className={`flex items-baseline justify-between gap-3 py-1.5 px-1 rounded transition-colors ${FOCUS_RING} ${
        strong ? "mt-1 font-semibold text-accent" : "font-normal text-ink hover:text-accent"
      }`}
    >
      <span className="min-w-0 truncate">{children}</span>
      {note && <span className="shrink-0 text-xs text-muted truncate max-w-[45%]">{note}</span>}
    </Link>
  );
}
