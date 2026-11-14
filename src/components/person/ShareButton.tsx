"use client";

import { useState } from "react";

/**
 * Share this page: the device's share sheet where there is one (phones), else
 * copy the address. Both paths are guarded, since either can be refused or
 * missing, and the button says what happened.
 */
export function ShareButton({ title, className = "" }: { title: string; className?: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  const share = async () => {
    const url = window.location.href.split("#")[0];
    try {
      if (typeof navigator.share === "function") {
        await navigator.share({ title, url });
        return;
      }
    } catch (e) {
      // Dismissing the share sheet rejects with AbortError: not a failure.
      if (e instanceof DOMException && e.name === "AbortError") return;
      // Anything else (blocked, unsupported data): fall through and copy.
    }
    try {
      await navigator.clipboard.writeText(url);
      setState("copied");
    } catch {
      setState("failed");
    }
    setTimeout(() => setState("idle"), 2200);
  };

  return (
    <button
      type="button"
      onClick={share}
      className={`inline-flex items-center gap-1.5 min-h-9 px-3 rounded-full border border-border bg-surface text-xs font-semibold text-ink hover:border-accent/40 hover:text-accent transition-colors ${className}`}
    >
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 12v7a1 1 0 001 1h14a1 1 0 001-1v-7M16 6l-4-4-4 4M12 2v13" />
      </svg>
      <span aria-live="polite">{state === "copied" ? "Link copied" : state === "failed" ? "Couldn’t copy" : "Share"}</span>
    </button>
  );
}
