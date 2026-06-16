import Link from "next/link";

export function Footer() {
  return (
    <footer className="border-t border-border bg-subtle mt-20">
      <div className="max-w-7xl mx-auto px-4 md:px-6 py-12">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
          <div>
            <h4 className="font-semibold text-ink mb-4 text-sm tracking-tight">Discover</h4>
            <nav className="flex flex-col gap-2.5 text-sm text-muted">
              <Link href="/books" className="hover:text-ink transition-colors">Books</Link>
              <Link href="/people" className="hover:text-ink transition-colors">People</Link>
              <Link href="/lists" className="hover:text-ink transition-colors">Lists</Link>
              <Link href="/series" className="hover:text-ink transition-colors">Series</Link>
            </nav>
          </div>
          <div>
            <h4 className="font-semibold text-ink mb-4 text-sm tracking-tight">Info</h4>
            <nav className="flex flex-col gap-2.5 text-sm text-muted">
              <Link href="/about" className="hover:text-ink transition-colors">About</Link>
              <Link href="/methodology" className="hover:text-ink transition-colors">Methodology</Link>
            </nav>
          </div>
          <div>
            <h4 className="font-semibold text-ink mb-4 text-sm tracking-tight">Legal</h4>
            <nav className="flex flex-col gap-2.5 text-sm text-muted">
              <Link href="/privacy" className="hover:text-ink transition-colors">Privacy</Link>
              <Link href="/terms" className="hover:text-ink transition-colors">Terms</Link>
            </nav>
          </div>
          <div>
            <h4 className="font-semibold text-ink mb-4 text-sm tracking-tight">Help</h4>
            <nav className="flex flex-col gap-2.5 text-sm text-muted">
              <Link href="/report-issue" className="hover:text-ink transition-colors">Report an issue</Link>
            </nav>
          </div>
        </div>
        <div className="mt-10 pt-6 border-t border-border text-xs text-muted">
          BookMentions is an independent book discovery platform. Recommendations are sourced from publicly available data.
        </div>
      </div>
      <p className="mt-2 text-xs text-muted">
    As an Amazon Associate I earn from qualifying purchases.
  </p>
</footer>
  );
}
