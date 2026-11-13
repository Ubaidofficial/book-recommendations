import { isValidHttpUrl } from "./dataQuality";

/** Friendly names for the hosts our portraits come from. */
const HOST_NAMES: Record<string, string> = {
  "flickr.com": "Flickr",
  "commons.wikimedia.org": "Wikimedia Commons",
  "upload.wikimedia.org": "Wikimedia Commons",
  "wikipedia.org": "Wikipedia",
  "youtube.com": "YouTube",
  "europa.eu": "European Union",
};

function hostLabel(url: string): string {
  let host: string;
  try {
    host = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
  for (const [suffix, name] of Object.entries(HOST_NAMES)) {
    if (host === suffix || host.endsWith(`.${suffix}`)) return name;
  }
  return host;
}

export interface PhotoCredit {
  /** Short visible line, e.g. "Photo: kris krüg, Flickr · CC BY-SA 2.0". */
  text: string;
  /** Where the credit links: the original source, else the Commons file page. */
  href: string | null;
  /** The full attribution as stored, for the title tooltip. */
  full: string;
}

/**
 * A clean licence credit for a portrait. avatar_attribution is often a raw
 * source URL followed by "(licence)", which showed as a cut-off URL; this
 * names the host instead and links to it. Returns null when there is nothing
 * to credit (public-domain photos with no author or licence).
 */
export function photoCredit(p: {
  avatar_attribution?: string | null;
  avatar_author?: string | null;
  avatar_license?: string | null;
  avatar_source_url?: string | null;
}): PhotoCredit | null {
  const attr = (p.avatar_attribution || "").trim();
  let license = (p.avatar_license || "").trim();
  const author = (p.avatar_author || "").trim();

  // "https://… (CC BY-SA 2.0)" → URL + licence.
  const m = attr.match(/^(https?:\/\/\S+)\s*(?:\(([^)]+)\))?\s*$/);
  const attrUrl = m && isValidHttpUrl(m[1]) ? m[1] : null;
  if (!license && m?.[2]) license = m[2].trim();

  const commons = isValidHttpUrl(p.avatar_source_url) ? p.avatar_source_url!.trim() : null;
  const href = attrUrl || commons;
  const host = href ? hostLabel(href) : "";

  // Author names that are themselves URLs or long notes do not fit the line.
  const who = author && !/^https?:/i.test(author) && author.length <= 32 ? author : "";

  const source = [who, host].filter(Boolean).join(", ");
  if (!source && !license) {
    if (!attr) return null;
    return { text: "Photo credit", href, full: attr };
  }
  // Keep "CC BY-SA 2.0" on one line when the credit wraps.
  license = license.replace(/ /g, "\u00a0");
  const text = source ? `Photo: ${source}${license ? ` · ${license}` : ""}` : `Photo · ${license}`;
  return { text, href, full: attr || text };
}
