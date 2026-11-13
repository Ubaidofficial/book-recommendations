import type { ReactNode } from "react";
import { AMAZON_ASSOCIATE_TAG, isAmazonUrl } from "@/lib/dataQuality";

interface AmazonCoverLinkProps {
  /** Must be a URL from `amazonCtaUrl()` / `normalizeAmazonUrl()`, i.e. already tagged. */
  href: string | null | undefined;
  title: string;
  slug: string;
  /** Analytics section, e.g. "book-cover". */
  section: string;
  className?: string;
  children: ReactNode;
}

/**
 * True only for an Amazon URL carrying exactly one `tag`, and that tag is ours.
 * The cover link is the one place a click can start from an image rather than a
 * button, so it re-checks instead of trusting the caller.
 */
function isOurTaggedAmazonUrl(href: string): boolean {
  if (!isAmazonUrl(href)) return false;
  try {
    const tags = new URL(href).searchParams.getAll("tag");
    return tags.length === 1 && tags[0] === AMAZON_ASSOCIATE_TAG;
  } catch {
    return false;
  }
}

/**
 * Wraps a book cover so clicking the image opens the book on Amazon with our
 * Associates tag. Fails safe: with no URL, or a URL that is not tagged with
 * `bookmention09-20`, it renders the cover with no link rather than emit an
 * untagged Amazon link.
 */
export function AmazonCoverLink({ href, title, slug, section, className, children }: AmazonCoverLinkProps) {
  if (!href || !isOurTaggedAmazonUrl(href)) return <>{children}</>;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer nofollow sponsored"
      aria-label={`View ${title} on Amazon`}
      data-track-slug={slug}
      data-track-section={section}
      data-track-label="Cover on Amazon"
      className={className ?? "block w-full h-full"}
    >
      {children}
    </a>
  );
}
