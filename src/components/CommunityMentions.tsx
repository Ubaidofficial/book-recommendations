import type { BookCommunityMentions, CommunityComment } from "@/lib/data";
import { outboundLinkRel } from "@/lib/dataQuality";

// Below this many threads the signal is too thin to be worth a section.
const MIN_THREADS = 2;

const SOURCE_LABEL: Record<string, { name: string; place: (c: string) => string; vote: string }> = {
  reddit: { name: "Reddit", place: (c) => `r/${c}`, vote: "upvotes" },
  hackernews: { name: "Hacker News", place: () => "Hacker News", vote: "replies" },
};

function plainSnippet(s: string): string {
  return s
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // markdown links -> text
    .replace(/(\*\*|__|~~|\*|`)/g, "")
    .replace(/^&gt;\s?|^>\s?/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

function listCommunities(c: Record<string, number>, source: string): string {
  const names = Object.entries(c)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([k]) => SOURCE_LABEL[source]?.place(k) ?? k);
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function yearSpan(m: BookCommunityMentions): string {
  if (!m.first_year || !m.last_year) return "";
  return m.first_year === m.last_year ? `in ${m.first_year}` : `between ${m.first_year} and ${m.last_year}`;
}

function YearBars({ byYear, label }: { byYear: Record<string, number>; label: string }) {
  const years = Object.keys(byYear).map(Number).sort((a, b) => a - b);
  if (years.length < 3) return null;
  const all: number[] = [];
  for (let y = years[0]; y <= years[years.length - 1]; y++) all.push(y);
  const max = Math.max(...all.map((y) => byYear[String(y)] || 0), 1);
  return (
    <figure className="mt-4" aria-label={label}>
      <div className="flex items-end gap-1 h-10">
        {all.map((y) => {
          const v = byYear[String(y)] || 0;
          return (
            <div
              key={y}
              className="flex-1 rounded-sm bg-accent/70"
              style={{ height: `${Math.max(6, Math.round((v / max) * 100))}%`, opacity: v ? 1 : 0.15 }}
              title={`${y}: ${v} thread${v === 1 ? "" : "s"}`}
            />
          );
        })}
      </div>
      <figcaption className="mt-1 flex justify-between text-[10px] text-muted">
        <span>{all[0]}</span>
        <span>threads per year</span>
        <span>{all[all.length - 1]}</span>
      </figcaption>
    </figure>
  );
}

function CommentCard({ c, source }: { c: CommunityComment; source: string }) {
  const meta = SOURCE_LABEL[source];
  const text = plainSnippet(c.snippet);
  if (!text) return null;
  return (
    <li className="p-4 rounded-xl border border-border bg-surface">
      <blockquote className="text-sm text-ink leading-relaxed">&ldquo;{text}&rdquo;</blockquote>
      <p className="mt-2 text-xs text-muted">
        A reader on {meta?.place(c.community) ?? c.community}, {c.year}
        {c.score > 0 && <> · {c.score.toLocaleString("en-US")} {meta?.vote ?? "votes"}</>}
        {" · "}
        <a href={c.url} target="_blank" rel={outboundLinkRel(c.url)} className="underline hover:text-accent">
          read the comment
        </a>
      </p>
      {c.thread_title && (
        <p className="mt-1 text-xs text-muted truncate">in &ldquo;{c.thread_title}&rdquo;</p>
      )}
    </li>
  );
}

export function CommunityMentions({
  mentions,
  bookTitle,
}: {
  mentions: BookCommunityMentions[];
  bookTitle: string;
}) {
  const shown = mentions.filter((m) => m.thread_count >= MIN_THREADS && SOURCE_LABEL[m.source]);
  if (shown.length === 0) return null;
  const primary = shown[0];
  const others = shown.slice(1);
  const p = SOURCE_LABEL[primary.source];

  return (
    <section className="mb-14" aria-labelledby="community-mentions">
      <h2 id="community-mentions" className="text-xl font-bold text-ink mb-2 tracking-tight">
        What readers on {p.name} say about {bookTitle}
      </h2>
      <p className="text-sm text-muted mb-5 leading-relaxed">
        Recommended in <strong className="text-ink">{primary.thread_count.toLocaleString("en-US")}</strong>{" "}
        {p.name} thread{primary.thread_count === 1 ? "" : "s"} {yearSpan(primary)}
        {Object.keys(primary.communities || {}).length > 0 && primary.source === "reddit" && (
          <>, most often in {listCommunities(primary.communities, primary.source)}</>
        )}
        .
        {primary.source_rank != null && primary.source_rank <= 500 && (
          <> It ranks #{primary.source_rank} among the books we track on {p.name}.</>
        )}
        {others.map((o) => (
          <span key={o.source}>
            {" "}It also came up in {o.thread_count.toLocaleString("en-US")} {SOURCE_LABEL[o.source].name} thread
            {o.thread_count === 1 ? "" : "s"}.
          </span>
        ))}
      </p>

      {primary.top_comments?.length > 0 && (
        <ul className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {primary.top_comments.slice(0, 4).map((c) => (
            <CommentCard key={c.url} c={c} source={primary.source} />
          ))}
          {others.flatMap((o) =>
            (o.top_comments || []).slice(0, 2).map((c) => <CommentCard key={c.url} c={c} source={o.source} />)
          )}
        </ul>
      )}

      {primary.top_threads?.length > 0 && (
        <div className="mt-5">
          <h3 className="text-sm font-semibold text-ink mb-2">Threads where it was recommended</h3>
          <ul className="space-y-1.5">
            {primary.top_threads.slice(0, 5).map((t) => (
              <li key={t.url} className="text-sm">
                <a href={t.url} target="_blank" rel={outboundLinkRel(t.url)} className="text-ink hover:text-accent underline">
                  {t.title || "Untitled thread"}
                </a>{" "}
                <span className="text-xs text-muted">
                  {p.place(t.community)}, {t.year}
                  {t.comments ? ` · ${t.comments.toLocaleString("en-US")} comments` : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <YearBars byYear={primary.by_year || {}} label={`${p.name} threads recommending ${bookTitle}, per year`} />

      <p className="mt-4 text-xs text-muted leading-relaxed">
        From public {shown.map((m) => SOURCE_LABEL[m.source].name).join(" and ")}{" "}
        replies to &ldquo;what should I read&rdquo; threads since 2015, matched to this book automatically. A book counts once per thread. Quotes are
        short excerpts linked to the original comment; usernames are not shown.
      </p>
    </section>
  );
}
