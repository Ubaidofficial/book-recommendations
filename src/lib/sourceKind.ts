/**
 * What kind of place a recommendation's source URL points at, and whether it
 * demonstrably belongs to the recommender.
 *
 * Pure and dependency-free (no imports) so it can be checked with plain node:
 *   node --experimental-strip-types scripts/selfcheck_book_v4.mjs
 *
 * This only LABELS a source. Whether a source may be shown at all is decided
 * by getProofDisplaySafety() in dataQuality.ts; call this on URLs that already
 * passed that gate.
 */

export type SourceKind = "tweet" | "podcast" | "youtube" | "own_site" | "article" | "other";

export interface SourcePerson {
  slug: string;
  name: string;
  /** Own X/Twitter handle, no "@", when known. */
  twitter_handle?: string | null;
}

export interface SourceClass {
  kind: SourceKind;
  /** Short chip label, e.g. "Tweet", "Podcast episode". */
  label: string;
  /** True only when the URL is shown to be the person's own account or site. */
  own: boolean;
  /** One-line note under the name, e.g. "Their own account (@naval)". */
  note: string | null;
  /** Bare host, no "www.". */
  host: string;
}

/**
 * Domains (host, optionally with a path prefix) that belong to one person.
 * Mirrors DOMAIN_MAP in scripts/reattribute_quotes.js, which was checked by
 * hand; keep the two in step.
 */
export const OWNED_DOMAINS: Array<[string, string]> = [
  ["sivers.org", "derek-sivers"],
  ["gatesnotes.com", "bill-gates"],
  ["nav.al", "naval-ravikant"],
  ["navalmanack.com", "naval-ravikant"],
  ["virgin.com/richard-branson", "richard-branson"],
  ["jordanbpeterson.com", "jordan-peterson"],
  ["okdork.com", "noah-kagan"],
  ["berkshirehathaway.com/letters", "warren-buffett"],
  ["waitbutwhy.com", "tim-urban"],
  ["humanwhocodes.com", "nicholas-c-zakas"],
  ["blog.codinghorror.com", "jeff-atwood"],
  ["jamesclear.com", "james-clear"],
  ["santana.com", "carlos-santana"],
  ["pickuplimes.com", "sadia-badiei"],
  ["tonyrobbins.com/news/tonys-", "tony-robbins"],
  ["blog.samaltman.com", "sam-altman"],
  ["jamesaltucher.com", "james-altucher"],
  ["ryanholiday.net", "ryan-holiday"],
  ["aubreymarcus.com", "aubrey-marcus"],
  ["scottadamssays.com", "scott-adams"],
  ["jimkwik.com", "jim-kwik"],
  ["mrmoneymustache.com", "mr-money-mustache"],
  ["susanjfowler.com", "susan-j-fowler"],
  ["guykawasaki.com", "guy-kawasaki"],
  ["paulgraham.com", "paul-graham"],
  ["patrickcollison.com", "patrick-collison"],
  ["barackobama.medium.com", "barack-obama"],
  ["obamawhitehouse.archives.gov/blog/2016/08/12/presidents-summer-reading-list", "barack-obama"],
  ["neilstrauss.com", "neil-strauss"],
  ["steveblank.com", "steve-blank"],
  ["markmanson.net", "mark-manson"],
  ["gretchenrubin.com", "gretchen-rubin"],
  ["jackkornfield.com", "jack-kornfield"],
  ["bobdylan.com", "bob-dylan"],
  ["oprah.com/oprahsbookclub/oprahs-", "oprah-winfrey"],
  ["ma.tt", "matt-mullenweg"],
  ["calacanis.com", "jason-calacanis"],
  ["caterina.net", "caterina-fake"],
  ["seths.blog", "seth-godin"],
  ["bryanjohnson.co", "bryan-johnson"],
  ["stratechery.com", "ben-thompson"],
];

/** Hosts whose pages are podcast episodes or show pages. */
const PODCAST_HOSTS = [
  "tim.blog",
  "podcasts.apple.com",
  "overcast.fm",
  "pca.st",
  "pocketcasts.com",
  "podbay.fm",
  "castbox.fm",
  "podcasts.google.com",
  "stitcher.com",
  "lexfridman.com",
  "joincolossus.com",
  "investorfieldguide.com",
  "hubermanlab.com",
  "peterattiamd.com",
  "jrelibrary.com",
  "podscripts.co",
  "happyscribe.com",
];

const YOUTUBE_HOSTS = ["youtube.com", "youtu.be", "m.youtube.com"];

/** Reference/social pages that are neither the person's words nor an interview. */
const OTHER_HOSTS = [
  "wikipedia.org",
  "wikiquote.org",
  "instagram.com",
  "facebook.com",
  "reddit.com",
  "quora.com",
  "pinterest.com",
  "tiktok.com",
];

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

function hostMatches(host: string, base: string): boolean {
  return host === base || host.endsWith("." + base);
}

/** Account name from a twitter.com / x.com status URL, lower-cased; null otherwise. */
export function tweetHandle(url: string): string | null {
  const m = /^https?:\/\/(?:www\.|mobile\.)?(?:twitter|x)\.com\/([^/?#]+)\/status/i.exec(url.trim());
  return m ? m[1].toLowerCase() : null;
}

/** True when a handle plausibly is this person's: equals the known handle, or squashes to the slug. */
function handleIsPersons(handle: string, p: SourcePerson): boolean {
  const known = String(p.twitter_handle || "").trim().replace(/^@/, "").toLowerCase();
  if (known) return handle === known;
  const h = squash(handle);
  return h.length >= 4 && (h === squash(p.slug) || h === squash(p.name));
}

/** The OWNED_DOMAINS entry for this URL, if any. */
export function ownedDomainSlug(url: string): string | null {
  let host = "";
  let path = "";
  try {
    const u = new URL(url);
    host = u.hostname.replace(/^www\./, "").toLowerCase();
    path = u.pathname.toLowerCase();
  } catch {
    return null;
  }
  const hp = host + path;
  for (const [prefix, slug] of OWNED_DOMAINS) {
    if (prefix.includes("/")) {
      if (hp.startsWith(prefix)) return slug;
    } else if (hostMatches(host, prefix)) {
      return slug;
    }
  }
  return null;
}

/**
 * Whether the host carries the person's name: the full name squashed (6+
 * chars) anywhere in the host, or the surname (5+ chars) in its first label.
 * Same rule getProofDisplaySafety uses to recognise an own site.
 */
function hostCarriesName(host: string, p: SourcePerson): boolean {
  const parts = p.name.toLowerCase().split(/\s+/).filter(Boolean);
  const full = squash(parts.join(""));
  const surname = squash(parts[parts.length - 1] || "");
  const flatHost = squash(host);
  const firstLabel = squash(host.split(".")[0] || "");
  const slugSquash = squash(p.slug);
  return (
    (full.length >= 6 && flatHost.includes(full)) ||
    (slugSquash.length >= 6 && flatHost.includes(slugSquash)) ||
    (surname.length >= 5 && firstLabel.includes(surname))
  );
}

export function classifySource(url: string, person: SourcePerson): SourceClass {
  let host = "";
  let path = "";
  try {
    const u = new URL(url);
    host = u.hostname.replace(/^www\./, "").toLowerCase();
    path = u.pathname.toLowerCase();
  } catch {
    return { kind: "other", label: "Source", own: false, note: null, host: "" };
  }

  // Tweets: own only when the account is the person's.
  const handle = tweetHandle(url);
  if (handle) {
    const own = handleIsPersons(handle, person);
    return {
      kind: "tweet",
      label: "Tweet",
      own,
      note: own ? `Their own account (@${handle})` : `Posted by @${handle}`,
      host,
    };
  }

  if (YOUTUBE_HOSTS.some((h) => hostMatches(host, h))) {
    return { kind: "youtube", label: "YouTube", own: false, note: null, host };
  }

  // Own website or blog: hand-checked domain map first, then the name rule.
  const owner = ownedDomainSlug(url);
  if (owner === person.slug || (!owner && hostCarriesName(host, person))) {
    return { kind: "own_site", label: "Their own website", own: true, note: host, host };
  }

  // Medium posts under the person's own @handle.
  if (hostMatches(host, "medium.com")) {
    const m = /^\/@([^/]+)/.exec(path);
    if (m && handleIsPersons(m[1].toLowerCase(), person)) {
      return { kind: "own_site", label: "Their own blog", own: true, note: `Medium (@${m[1]})`, host };
    }
  }

  const podcastHost = PODCAST_HOSTS.some((h) => hostMatches(host, h));
  const podcastPath = /(^|[/\-_.])(podcast|podcasts|episode|episodes|ep)([/\-_.]|\d|$)/.test(path);
  const spotifyEpisode = hostMatches(host, "open.spotify.com") && /\/(episode|show)\//.test(path);
  if (podcastHost || podcastPath || /podcast/.test(host) || spotifyEpisode) {
    const note = hostMatches(host, "tim.blog") ? "The Tim Ferriss Show, episode page" : host;
    return { kind: "podcast", label: "Podcast episode", own: false, note, host };
  }

  if (OTHER_HOSTS.some((h) => hostMatches(host, h)) || /^(twitter|x)\.com$/.test(host)) {
    const reference = /(^|\.)wiki(pedia|quote)\.org$/.test(host);
    return { kind: "other", label: reference ? "Reference page" : "Other", own: false, note: host, host };
  }

  const interview = /interview/.test(path) || hostMatches(host, "fivebooks.com");
  return { kind: "article", label: interview ? "Interview" : "Article", own: false, note: host, host };
}
