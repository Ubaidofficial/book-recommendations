/**
 * Which /compare/<a>-vs-<b> pages are offered to Google (sitemap, `index` robots, followed links).
 *
 * 2026-11-15: of 53 compare pages, 15 were indexed by Google and 38 were not (crawled/discovered, never shown). The rest are thin by
 * nature (a pair of shelves, ~470 words), so only the 15 Google already indexes stay indexable; every other pair still renders for a
 * reader who follows a link, but answers `noindex` and is left out of the sitemap. The pairs are slugs in alphabetical order, the
 * canonical form (comparePairSlug). The daily indexing-gated task may add a pair here when Search Console shows demand for it.
 */
export const COMPARE_INDEX_ALLOWLIST: ReadonlySet<string> = new Set([
  "barack-obama-vs-bill-gates",
  "barack-obama-vs-sarah-jessica-parker",
  "bill-gates-vs-derek-sivers",
  "bill-gates-vs-mark-zuckerberg",
  "bill-gates-vs-michael-mauboussin",
  "bill-gates-vs-nat-eliason",
  "bill-gates-vs-naval-ravikant",
  "bill-gates-vs-sophie-bakalar",
  "bill-gates-vs-vinod-khosla",
  "derek-sivers-vs-james-clear",
  "derek-sivers-vs-naval-ravikant",
  "elon-musk-vs-jeff-bezos",
  "james-clear-vs-nat-eliason",
  "james-clear-vs-naval-ravikant",
  "keith-rabois-vs-vinod-khosla",
]);

export function isCompareIndexable(slugA: string, slugB: string): boolean {
  const [a, b] = [slugA, slugB].sort();
  return COMPARE_INDEX_ALLOWLIST.has(`${a}-vs-${b}`);
}
