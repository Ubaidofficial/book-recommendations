"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";

export interface ReviewItem {
  id: string;
  slug: string;
  title: string;
  author: string;
  recs: number;
  summary: string;
  bestFor: string[];
  notFor: string[];
  themes: string[];
  status: string; // draft | approved | rejected | ...
  reviewedAt: string | null;
}

type Action = "approve" | "reject" | "draft";
type Filter = "todo" | "approved" | "rejected" | "all";

// The key lives only in this tab (sessionStorage), never in a cookie or the URL.
const KEY_STORE = "bm-review-key";

function readKey(): string {
  try {
    return sessionStorage.getItem(KEY_STORE) || "";
  } catch {
    return "";
  }
}

const lines = (s: string) => s.split("\n").map((l) => l.trim()).filter(Boolean);
const same = (a: string[], b: string[]) => a.length === b.length && a.every((v, i) => v === b[i]);

const STATUS_STYLE: Record<string, string> = {
  approved: "bg-emerald-50 text-emerald-800 border-emerald-200",
  rejected: "bg-red-50 text-red-800 border-red-200",
  draft: "bg-amber-50 text-amber-800 border-amber-200",
};

function KeyGate({ onOk }: { onOk: (key: string) => void }) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function check(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    const { data, error } = await supabase().rpc("editorial_review_key_ok", { p_key: value.trim() });
    setBusy(false);
    if (error) return setErr(error.message);
    if (data !== true) return setErr("That review key is not valid.");
    try {
      sessionStorage.setItem(KEY_STORE, value.trim());
    } catch {
      /* the key then lasts only for this page view */
    }
    onOk(value.trim());
  }
  return (
    <form onSubmit={check} className="rounded-2xl border border-border bg-surface p-5 max-w-lg">
      <label htmlFor="review-key" className="block text-sm font-medium text-ink mb-2">
        Review key
      </label>
      <input
        id="review-key"
        type="password"
        autoComplete="off"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="w-full rounded-xl border border-border bg-white px-3 py-2 text-sm"
      />
      {err && <p className="mt-2 text-sm text-red-700">{err}</p>}
      <button
        type="submit"
        disabled={busy || !value.trim()}
        className="mt-3 rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {busy ? "Checking…" : "Unlock"}
      </button>
    </form>
  );
}

function Card({ item, reviewKey, onDone }: { item: ReviewItem; reviewKey: string; onDone: (next: ReviewItem) => void }) {
  const [summary, setSummary] = useState(item.summary);
  const [bestFor, setBestFor] = useState(item.bestFor.join("\n"));
  const [notFor, setNotFor] = useState(item.notFor.join("\n"));
  const [themes, setThemes] = useState(item.themes.join("\n"));
  const [busy, setBusy] = useState<Action | null>(null);
  const [msg, setMsg] = useState("");

  const edited =
    summary.trim() !== item.summary.trim() ||
    !same(lines(bestFor), item.bestFor) ||
    !same(lines(notFor), item.notFor) ||
    !same(lines(themes), item.themes);

  async function send(action: Action) {
    setBusy(action);
    setMsg("");
    const args: Record<string, unknown> = { p_key: reviewKey, p_book_id: item.id, p_action: action };
    if (action === "approve" && edited) {
      args.p_summary = summary.trim();
      args.p_best_for = lines(bestFor);
      args.p_not_for = lines(notFor);
      args.p_key_themes = lines(themes);
    }
    const { data, error } = await supabase().rpc("review_book_notes", args);
    setBusy(null);
    if (error) return setMsg(`Not saved: ${error.message}`);
    const row = data as { ai_quality_status: string; ai_reviewed_at: string | null };
    onDone({
      ...item,
      summary: action === "approve" && edited ? summary.trim() : item.summary,
      bestFor: action === "approve" && edited ? lines(bestFor) : item.bestFor,
      notFor: action === "approve" && edited ? lines(notFor) : item.notFor,
      themes: action === "approve" && edited ? lines(themes) : item.themes,
      status: row.ai_quality_status,
      reviewedAt: row.ai_reviewed_at,
    });
    setMsg(action === "approve" ? (edited ? "Saved and approved." : "Approved.") : action === "reject" ? "Rejected: notes are hidden." : "Back to draft.");
  }

  const area = "w-full rounded-xl border border-border bg-white px-3 py-2 text-sm leading-relaxed";
  return (
    <article className="rounded-2xl border border-border bg-surface p-5">
      <header className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
        <div>
          <a href={`/books/${item.slug}`} target="_blank" rel="noopener" className="font-semibold text-ink hover:text-accent">
            {item.title}
          </a>
          <span className="text-sm text-muted"> · {item.author} · {item.recs} recs</span>
        </div>
        <span className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLE[item.status] || STATUS_STYLE.draft}`}>
          {item.status}
          {item.reviewedAt ? ` · ${new Date(item.reviewedAt).toLocaleDateString("en-GB")}` : ""}
        </span>
      </header>

      <label className="block text-xs font-semibold uppercase tracking-wide text-muted mb-1">Summary</label>
      <textarea className={area} rows={4} value={summary} onChange={(e) => setSummary(e.target.value)} />

      <div className="grid gap-3 sm:grid-cols-2 mt-3">
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wide text-muted mb-1">Read it if (one per line)</label>
          <textarea className={area} rows={6} value={bestFor} onChange={(e) => setBestFor(e.target.value)} />
        </div>
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wide text-muted mb-1">Skip it if (one per line)</label>
          <textarea className={area} rows={6} value={notFor} onChange={(e) => setNotFor(e.target.value)} />
        </div>
      </div>
      <label className="block text-xs font-semibold uppercase tracking-wide text-muted mb-1 mt-3">Key themes (one per line)</label>
      <textarea className={area} rows={3} value={themes} onChange={(e) => setThemes(e.target.value)} />

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => send("approve")}
          disabled={!!busy}
          className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy === "approve" ? "Saving…" : edited ? "Save edits & approve" : "Approve"}
        </button>
        <button
          type="button"
          onClick={() => send("reject")}
          disabled={!!busy}
          className="rounded-xl border border-red-300 px-4 py-2 text-sm font-medium text-red-800 disabled:opacity-50"
        >
          {busy === "reject" ? "Saving…" : "Reject (hide notes)"}
        </button>
        {item.status !== "draft" && (
          <button
            type="button"
            onClick={() => send("draft")}
            disabled={!!busy}
            className="rounded-xl border border-border px-4 py-2 text-sm text-muted disabled:opacity-50"
          >
            Back to draft
          </button>
        )}
        {edited && <span className="text-xs text-amber-800">Unsaved edits. Rejecting discards them.</span>}
        {msg && <span className="text-sm text-muted">{msg}</span>}
      </div>
    </article>
  );
}

export function ReviewQueue({ items: initial }: { items: ReviewItem[] }) {
  const [reviewKey, setReviewKey] = useState("");
  const [items, setItems] = useState(initial);
  const [filter, setFilter] = useState<Filter>("todo");

  useEffect(() => {
    setReviewKey(readKey());
  }, []);

  const counts = useMemo(() => {
    const c = { todo: 0, approved: 0, rejected: 0, all: items.length };
    for (const i of items) {
      if (i.status === "approved") c.approved++;
      else if (i.status === "rejected") c.rejected++;
      else c.todo++;
    }
    return c;
  }, [items]);

  const shown = items.filter((i) =>
    filter === "all" ? true : filter === "todo" ? i.status !== "approved" && i.status !== "rejected" : i.status === filter,
  );

  if (!reviewKey) return <KeyGate onOk={setReviewKey} />;

  const tab = (f: Filter, label: string) => (
    <button
      key={f}
      type="button"
      onClick={() => setFilter(f)}
      className={`rounded-full px-3 py-1 text-sm ${filter === f ? "bg-accent text-white" : "bg-surface border border-border text-muted"}`}
    >
      {label} ({counts[f]})
    </button>
  );

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-5">
        {tab("todo", "To review")}
        {tab("approved", "Approved")}
        {tab("rejected", "Rejected")}
        {tab("all", "All")}
        <button
          type="button"
          onClick={() => {
            try {
              sessionStorage.removeItem(KEY_STORE);
            } catch {
              /* nothing stored */
            }
            setReviewKey("");
          }}
          className="ml-auto text-sm text-muted underline"
        >
          Lock
        </button>
      </div>
      {shown.length === 0 ? (
        <p className="text-sm text-muted">Nothing here.</p>
      ) : (
        <div className="space-y-5">
          {shown.map((item) => (
            <Card
              key={item.id}
              item={item}
              reviewKey={reviewKey}
              onDone={(next) => setItems((all) => all.map((i) => (i.id === next.id ? next : i)))}
            />
          ))}
        </div>
      )}
    </div>
  );
}
