"use client";

import { useEffect } from "react";
import { isAmazonUrl } from "@/lib/dataQuality";

/**
 * Sends one GA4 event, `amazon_click`, whenever a visitor clicks a link to
 * Amazon. Mounted once in the root layout, so every "View on Amazon" button and
 * cover link is covered with one document-level listener and no per-link code.
 *
 * Why: Amazon Associates only reports clicks in aggregate (and with a lag), so
 * it cannot say which page or book a click came from. This can.
 *
 * Parameters sent: link_url (the tagged Amazon URL), asin (when the URL has
 * one), page_path, link_text. The event is a standard gtag `event` command put
 * on the GTM dataLayer, so the Google tag already in the GTM container
 * (GTM-N8SF996L) forwards it to GA4. Nothing is sent until GTM has loaded; if
 * it never does (blocked, offline), the push is a harmless no-op.
 *
 * The click is never delayed or cancelled: this only observes it.
 */

type DataLayer = unknown[];
declare global {
  interface Window {
    dataLayer?: DataLayer;
  }
}

function asinOf(href: string): string | undefined {
  const m = href.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?:[/?]|$)/i);
  return m ? m[1].toUpperCase() : undefined;
}

function sendAmazonClick(anchor: HTMLAnchorElement) {
  const href = anchor.href;
  const dl = (window.dataLayer = window.dataLayer || []);
  // gtag() pushes its `arguments` object, not an array; GTM only treats the
  // push as a gtag command if it is an Arguments object, so build one the
  // same way the gtag snippet does.
  (function gtag(..._args: unknown[]) {
    // eslint-disable-next-line prefer-rest-params
    dl.push(arguments);
  })("event", "amazon_click", {
    link_url: href,
    asin: asinOf(href),
    page_path: window.location.pathname,
    link_text: (anchor.textContent || anchor.getAttribute("aria-label") || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 100),
    transport_type: "beacon",
  });
}

export function AmazonClickTracker() {
  useEffect(() => {
    function onClick(e: MouseEvent) {
      // Left click and middle click (open in new tab) are both real intent.
      if (e.button > 1) return;
      const target = e.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if (!isAmazonUrl(anchor.href)) return;
      try {
        sendAmazonClick(anchor);
      } catch {
        // Analytics must never break navigation.
      }
    }
    // Capture phase, so a component that stops propagation cannot hide a click.
    // `auxclick` is what browsers fire for the middle button.
    document.addEventListener("click", onClick, true);
    document.addEventListener("auxclick", onClick, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("auxclick", onClick, true);
    };
  }, []);

  return null;
}
